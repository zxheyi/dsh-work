import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

import type { IWorks, WorkClientSnapshot } from './client-model.ts'
import type {
  WorkSessionOutputContent,
  WorkSessionOutputFile,
  WorkSessionOutputSource,
  WorkSessionOutputRevisionFailure,
  WorkView,
} from './index.ts'
import type { WorkDeliverableContent } from './index.ts'

interface WorkSurfaceInjected {
  readonly works: IWorks
}

interface WorkSidebarProps extends WorkSurfaceInjected {
  readonly collapsed: boolean
  readonly width: number
}

const h = createElement
const MAX_RESOURCE_FILES = 20
const MAX_RESOURCE_FILE_BYTES = 25 * 1024 * 1024
const SUPPORTED_SESSION_RESOURCE = /\.(?:csv|json|md|txt)$/iu

interface SessionResourceEntryState {
  readonly id: string
  readonly file: File
  readonly abort: AbortController
  readonly status: 'copying' | 'ready' | 'failed'
  readonly path: string | null
  readonly mention: string | null
  readonly error: string | null
}

interface NativeSessionResourceProps extends WorkSurfaceInjected {
  readonly session: { readonly sessionId: string }
  readonly input: { readonly draft: string; readonly phase: string }
  readonly inputActions: { readonly setDraft: (text: string) => void }
}

interface SessionOutputsMatch {
  readonly turn: number
  readonly throughSeq: number
}

interface SessionOutputsOwner {
  readonly turn: { readonly turn: number }
  readonly seq: number
}

interface NativeSessionOutputsProps extends WorkSurfaceInjected {
  readonly matched: SessionOutputsMatch
  readonly sessionId: string
  readonly openFile: (path: string) => void
}

interface SessionResourceReferenceDetail {
  readonly sessionId: string
  readonly path: string
}

interface SessionOutputPreviewSelection extends WorkSessionOutputFile {
  readonly throughSeq: number
  readonly open: () => void
}

type SessionOutputPreviewDetail = Omit<SessionOutputPreviewSelection, 'open'>
const SESSION_OUTPUT_OPEN = Symbol('dsh-work.session-output.open')
type SessionOutputSelectionEvent = CustomEvent<SessionOutputPreviewDetail> & {
  readonly [SESSION_OUTPUT_OPEN]: () => void
}

interface SessionOutputPreviewStore {
  readonly getSnapshot: () => SessionOutputPreviewSelection | null
  readonly subscribe: (listener: () => void) => () => void
  readonly select: (selection: SessionOutputPreviewSelection) => void
  readonly clear: () => void
}

interface NativeSessionOutputPreviewProps extends WorkSurfaceInjected {
  readonly sessionId: string
  readonly preview: SessionOutputPreviewStore
  readonly closePreview: () => void
}

export type SafeMarkdownBlock =
  | { readonly kind: 'heading'; readonly level: number; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly items: readonly string[] }
  | { readonly kind: 'code'; readonly text: string }

export type SafeMarkdownRenderPlan =
  | { readonly mode: 'structured'; readonly blocks: readonly SafeMarkdownBlock[] }
  | { readonly mode: 'plain'; readonly content: string }

const sessionResourceEntries = new Map<string, readonly SessionResourceEntryState[]>()
const sessionResourceDrafts = new Map<string, string>()
const MAX_STRUCTURED_MARKDOWN_NODES = 2_000

function createSessionOutputPreviewStore(): SessionOutputPreviewStore {
  let snapshot: SessionOutputPreviewSelection | null = null
  const listeners = new Set<() => void>()
  const publish = (): void => {
    for (const listener of listeners) listener()
  }
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    select(selection: SessionOutputPreviewSelection) {
      snapshot = selection
      publish()
    },
    clear() {
      snapshot = null
      publish()
    },
  })
}

export function parseSafeMarkdown(source: string): readonly SafeMarkdownBlock[] {
  const lines = source.replace(/\r\n?/gu, '\n').split('\n')
  const blocks: SafeMarkdownBlock[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.trim().length === 0) {
      index++
      continue
    }
    if (/^\s*```/u.test(line)) {
      const code: string[] = []
      index++
      while (index < lines.length && !/^\s*```/u.test(lines[index] ?? '')) {
        code.push(lines[index] ?? '')
        index++
      }
      if (index < lines.length) index++
      blocks.push(Object.freeze({ kind: 'code', text: code.join('\n') }))
      continue
    }
    const heading = /^(#{1,6})\s+(.+)$/u.exec(line)
    if (heading) {
      blocks.push(Object.freeze({
        kind: 'heading',
        level: heading[1]?.length ?? 1,
        text: heading[2] ?? '',
      }))
      index++
      continue
    }
    const listItem = /^\s*(?:(\d+)\.|([-+*]))\s+(.+)$/u.exec(line)
    if (listItem) {
      const ordered = listItem[1] !== undefined
      const items: string[] = []
      while (index < lines.length) {
        const item = /^\s*(?:(\d+)\.|([-+*]))\s+(.+)$/u.exec(lines[index] ?? '')
        if (!item || (item[1] !== undefined) !== ordered) break
        items.push(item[3] ?? '')
        index++
      }
      blocks.push(Object.freeze({ kind: 'list', ordered, items: Object.freeze(items) }))
      continue
    }
    const paragraph: string[] = []
    while (index < lines.length) {
      const next = lines[index] ?? ''
      if (next.trim().length === 0
        || /^\s*```/u.test(next)
        || /^(#{1,6})\s+(.+)$/u.test(next)
        || /^\s*(?:(\d+)\.|([-+*]))\s+(.+)$/u.test(next)) break
      paragraph.push(next.trim())
      index++
    }
    blocks.push(Object.freeze({ kind: 'paragraph', text: paragraph.join(' ') }))
  }
  return Object.freeze(blocks)
}

export function planSafeMarkdownRender(source: string): SafeMarkdownRenderPlan {
  const blocks = parseSafeMarkdown(source)
  let nodes = 0
  for (const block of blocks) {
    nodes += block.kind === 'list' ? block.items.length + 1 : 1
    if (nodes > MAX_STRUCTURED_MARKDOWN_NODES) {
      return Object.freeze({ mode: 'plain', content: source })
    }
  }
  return Object.freeze({ mode: 'structured', blocks })
}

export class LatestPreviewRequest {
  private generation = 0

  async run<Value>(
    load: () => Promise<Value>,
    ready: (value: Value) => void,
    failed: () => void,
  ): Promise<void> {
    const generation = ++this.generation
    try {
      const value = await load()
      if (generation === this.generation) ready(value)
    } catch {
      if (generation === this.generation) failed()
    }
  }

  invalidate(): void {
    this.generation++
  }
}

const shortcuts = Object.freeze([
  Object.freeze({
    key: 'document',
    token: '文',
    title: '处理文档',
    detail: '撰写、总结、改写和翻译',
    goal: '根据我提供的资料整理并撰写一份结构清晰、可以直接使用的文档。',
  }),
  Object.freeze({
    key: 'sheet',
    token: '表',
    title: '分析表格',
    detail: '整理数据、发现趋势和制作图表',
    goal: '分析我提供的表格，找出主要变化和异常，并形成清晰的结论。',
  }),
  Object.freeze({
    key: 'slides',
    token: '演',
    title: '制作演示',
    detail: '从主题或资料形成汇报结构',
    goal: '根据我提供的主题和资料制作一份重点清楚、适合汇报的演示稿。',
  }),
  Object.freeze({
    key: 'research',
    token: '研',
    title: '调研报告',
    detail: '搜索、核验、比较并附上来源',
    goal: '围绕我提供的问题进行调研、核验和比较，并形成带来源的报告。',
  }),
])

function useWorks(works: IWorks): WorkClientSnapshot {
  const subscribe = useCallback((listener: () => void) => works.list.subscribe(listener), [works])
  const getSnapshot = useCallback(() => works.list.getSnapshot(), [works])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function workStatus(work: WorkView): { readonly label: string; readonly tone: string } {
  if (work.execution === 'failed') return { label: '需要处理', tone: 'danger' }
  if (work.status === 'awaiting-review') return { label: '待审核', tone: 'warning' }
  if (work.status === 'completed') return { label: '已完成', tone: 'success' }
  if (work.status === 'delivered') return { label: '已交付', tone: 'neutral' }
  return { label: '进行中', tone: 'accent' }
}

function titleFromGoal(goal: string): string {
  const firstLine = goal.trim().split(/[。！？\n]/u, 1)[0]?.trim() ?? ''
  if (firstLine.length <= 20) return firstLine || '新的工作'
  return `${firstLine.slice(0, 20)}…`
}

function focusGoal(): void {
  document.querySelector<HTMLTextAreaElement>('[data-work-goal]')?.focus()
}

function sidebarRow(label: string, count: number, selected = false): ReactNode {
  return h('button', {
    className: `dsh-work-sidebar-row${selected ? ' is-selected' : ''}`,
    type: 'button',
    onClick: focusGoal,
  }, h('span', null, label), h('span', { className: 'dsh-work-sidebar-count' }, String(count)))
}

export function WorkSidebar({ collapsed, works }: WorkSidebarProps): ReactNode {
  const snapshot = useWorks(works)
  const work = snapshot.items[0]
  const status = work ? workStatus(work) : null
  if (collapsed) {
    return h('aside', { className: 'dsh-work-sidebar is-collapsed', 'aria-label': '工作导航' },
      h('div', { className: 'dsh-work-sidebar-mark', 'aria-label': 'DSH Work' }, 'W'),
      h('button', {
        className: 'dsh-work-sidebar-create-compact',
        type: 'button',
        title: '开始新工作',
        onClick: focusGoal,
      }, '+'))
  }
  const workingCount = work && work.status === 'working' ? 1 : 0
  const reviewCount = work && work.status === 'awaiting-review' ? 1 : 0
  const completedCount = work && (work.status === 'completed' || work.status === 'delivered') ? 1 : 0
  return h('aside', { className: 'dsh-work-sidebar', 'aria-label': '工作导航' },
    h('div', { className: 'dsh-work-sidebar-brand' },
      h('span', { className: 'dsh-work-sidebar-mark', 'aria-hidden': 'true' }, 'W'),
      h('strong', null, 'DSH Work')),
    h('button', { className: 'dsh-work-sidebar-create', type: 'button', onClick: focusGoal },
      h('span', { 'aria-hidden': 'true' }, '+'), '开始新工作'),
    h('nav', { className: 'dsh-work-sidebar-nav', 'aria-label': '工作状态' },
      sidebarRow('最近', snapshot.items.length, true),
      sidebarRow('进行中', workingCount),
      sidebarRow('待审核', reviewCount),
      sidebarRow('已完成', completedCount)),
    h('div', { className: 'dsh-work-sidebar-section' },
      h('div', { className: 'dsh-work-sidebar-heading' }, '最近工作'),
      snapshot.phase === 'pending'
        ? h('div', { className: 'dsh-work-sidebar-skeleton', 'aria-label': '正在加载工作' })
        : work
          ? h('button', { className: 'dsh-work-sidebar-work', type: 'button', onClick: focusGoal },
            h('strong', null, work.title),
            h('span', null, status?.label))
          : h('p', { className: 'dsh-work-sidebar-empty' }, '还没有工作')),
    h('div', { className: 'dsh-work-sidebar-foot' },
      h('span', { className: 'dsh-work-runtime-indicator', 'aria-hidden': 'true' }),
      h('span', null, '运行就绪')))
}

function DisabledResourceItem({ children }: { readonly children: ReactNode }): ReactNode {
  return h('button', {
    className: 'dsh-work-resource-item',
    type: 'button',
    disabled: true,
    title: '即将支持',
  }, children, h('span', null, '即将支持'))
}

interface ResourceEntryProps {
  readonly disabled: boolean
  readonly onFiles: (files: readonly File[]) => void
  readonly remaining: number
}

function ResourceEntry({ disabled, onFiles, remaining }: ResourceEntryProps): ReactNode {
  const input = useRef<HTMLInputElement>(null)
  return h('div', { className: 'dsh-work-resource-entry' },
    h('input', {
      ref: input,
      className: 'dsh-work-file-input',
      type: 'file',
      multiple: true,
      disabled: disabled || remaining < 1,
      onChange: (event: { currentTarget: HTMLInputElement }) => {
        const files = Array.from(event.currentTarget.files ?? [])
        event.currentTarget.value = ''
        if (files.length > 0) onFiles(files)
      },
    }),
    h('details', { className: 'dsh-work-resource-menu' },
      h('summary', {
        className: 'dsh-work-resource-trigger',
        'aria-haspopup': 'menu',
      },
      h('span', { className: 'dsh-work-resource-plus', 'aria-hidden': 'true' }, '+'),
      h('span', null, '添加资料'),
      h('span', { className: 'dsh-work-resource-chevron', 'aria-hidden': 'true' }, '⌄')),
      h('div', { className: 'dsh-work-resource-popover', role: 'menu', 'aria-label': '添加资料方式' },
        h('button', {
          className: 'dsh-work-resource-item',
          type: 'button',
          disabled: disabled || remaining < 1,
          onClick: (event: { currentTarget: HTMLButtonElement }) => {
            const details = event.currentTarget.closest('details')
            if (details instanceof HTMLDetailsElement) details.open = false
            input.current?.click()
          },
        }, '添加文件', h('span', null, remaining > 0 ? `还可添加 ${remaining} 个` : '已达上限')),
        h(DisabledResourceItem, null, '添加文件夹'),
        h(DisabledResourceItem, null, '添加网页'),
        h(DisabledResourceItem, null, '粘贴内容'))),
    h('span', { className: 'dsh-work-resource-help' }, '单个文件不能超过 25 MiB'))
}

async function fileBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function resourceMention(resourcePath: string): string {
  return /\s/u.test(resourcePath) ? `@"${resourcePath}"` : `@${resourcePath}`
}

function resourceErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = Reflect.get(error, 'message')
    if (typeof message === 'string' && message.length > 0) return message
  }
  return '资料复制失败，请重试。'
}

function NativeSessionResourceEntry({
  works,
  session,
  input,
  inputActions,
}: NativeSessionResourceProps): ReactNode {
  const picker = useRef<HTMLInputElement>(null)
  const activeSessionId = useRef(session.sessionId)
  const previousDraft = useRef(input.draft)
  const [entries, setEntries] = useState<readonly SessionResourceEntryState[]>(
    () => sessionResourceEntries.get(session.sessionId) ?? Object.freeze([]),
  )
  const [dropActive, setDropActive] = useState(false)
  activeSessionId.current = session.sessionId
  sessionResourceDrafts.set(session.sessionId, input.draft)

  useEffect(() => {
    const prior = previousDraft.current
    previousDraft.current = input.draft
    if (prior.length < 1 || input.draft.length > 0) return
    const retained = (sessionResourceEntries.get(session.sessionId) ?? [])
      .filter(entry => entry.status !== 'ready' || !entry.mention || !prior.includes(entry.mention))
    if (retained.length === entries.length) return
    const next = Object.freeze(retained)
    sessionResourceEntries.set(session.sessionId, next)
    setEntries(next)
  }, [entries.length, input.draft, session.sessionId])

  useEffect(() => {
    setEntries(sessionResourceEntries.get(session.sessionId) ?? Object.freeze([]))
    setDropActive(false)
  }, [session.sessionId])

  const updateEntries = useCallback((
    targetSessionId: string,
    update: (current: readonly SessionResourceEntryState[]) => readonly SessionResourceEntryState[],
  ): void => {
    const next = Object.freeze(update(sessionResourceEntries.get(targetSessionId) ?? Object.freeze([])))
    sessionResourceEntries.set(targetSessionId, next)
    if (activeSessionId.current === targetSessionId) setEntries(next)
  }, [])

  const importFile = useCallback(async (file: File, reuseId?: string): Promise<void> => {
    const targetSessionId = session.sessionId
    const id = reuseId ?? globalThis.crypto.randomUUID()
    const abort = new AbortController()
    const failed = (message: string, replaceCurrent = false): void => updateEntries(targetSessionId, current => {
      const installed = current.find(entry => entry.id === id)
      if (!replaceCurrent && installed?.abort !== abort) return current
      return [
        ...current.filter(entry => entry.id !== id),
        Object.freeze({ id, file, abort, status: 'failed' as const, path: null, mention: null, error: message }),
      ]
    })
    if (!SUPPORTED_SESSION_RESOURCE.test(file.name)) {
      failed('当前仅支持 Markdown、TXT、CSV 和 JSON 文件。', true)
      return
    }
    if (file.size < 1 || file.size > MAX_RESOURCE_FILE_BYTES) {
      failed('文件必须非空且不能超过 25 MiB。', true)
      return
    }
    updateEntries(targetSessionId, current => [
      ...current.filter(entry => entry.id !== id),
      Object.freeze({ id, file, abort, status: 'copying' as const, path: null, mention: null, error: null }),
    ])
    try {
      const resource = await works.importSessionResource({
        sessionId: targetSessionId,
        name: file.name,
        ...(file.type ? { mediaType: file.type } : {}),
        dataBase64: await fileBase64(file),
      }, abort.signal)
      const installed = sessionResourceEntries.get(targetSessionId)?.find(entry => entry.id === id)
      if (installed?.abort !== abort || installed.status !== 'copying') return
      const mention = resourceMention(resource.path)
      updateEntries(targetSessionId, current => current.map(entry => entry.id === id
        ? Object.freeze({ ...entry, status: 'ready' as const, path: resource.path, mention })
        : entry))
      const targetDraft = sessionResourceDrafts.get(targetSessionId) ?? ''
      const separator = targetDraft.trim().length > 0 ? ' ' : ''
      const nextDraft = `${targetDraft}${separator}${mention} `
      sessionResourceDrafts.set(targetSessionId, nextDraft)
      inputActions.setDraft(nextDraft)
    } catch (error) {
      failed(resourceErrorMessage(error))
    }
  }, [inputActions, session.sessionId, updateEntries, works])

  const importFiles = useCallback((files: readonly File[]): void => {
    for (const file of files.slice(0, 10)) void importFile(file)
    const overflow = files[10]
    if (!overflow) return
    const abort = new AbortController()
    updateEntries(session.sessionId, current => [
      ...current,
      Object.freeze({
        id: globalThis.crypto.randomUUID(),
        file: overflow,
        abort,
        status: 'failed' as const,
        path: null,
        mention: null,
        error: '一次最多添加 10 个资料，其余文件未复制。',
      }),
    ])
  }, [importFile, session.sessionId, updateEntries])

  useEffect(() => {
    const nonImageItems = (event: DragEvent): readonly DataTransferItem[] =>
      Array.from(event.dataTransfer?.items ?? [])
        .filter(item => item.kind === 'file' && !item.type.startsWith('image/'))
    const claim = (event: DragEvent): boolean => {
      if (nonImageItems(event).length < 1) return false
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return true
    }
    const onDragEnter = (event: DragEvent): void => {
      if (!claim(event)) return
      setDropActive(true)
    }
    const onDragOver = (event: DragEvent): void => {
      if (!claim(event)) return
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      setDropActive(true)
    }
    const onDragLeave = (event: DragEvent): void => {
      if (event.relatedTarget === null) setDropActive(false)
    }
    const onDrop = (event: DragEvent): void => {
      const files = Array.from(event.dataTransfer?.files ?? []).filter(file => !file.type.startsWith('image/'))
      if (files.length < 1) return
      claim(event)
      setDropActive(false)
      importFiles(files)
      const images = Array.from(event.dataTransfer?.files ?? []).filter(file => file.type.startsWith('image/'))
      if (images.length > 0) {
        const transfer = new DataTransfer()
        for (const image of images) transfer.items.add(image)
        document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
      }
    }
    window.addEventListener('dragenter', onDragEnter, true)
    window.addEventListener('dragover', onDragOver, true)
    window.addEventListener('dragleave', onDragLeave, true)
    window.addEventListener('drop', onDrop, true)
    return () => {
      window.removeEventListener('dragenter', onDragEnter, true)
      window.removeEventListener('dragover', onDragOver, true)
      window.removeEventListener('dragleave', onDragLeave, true)
      window.removeEventListener('drop', onDrop, true)
    }
  }, [importFiles])

  useEffect(() => {
    const copying = (): boolean => (sessionResourceEntries.get(session.sessionId) ?? [])
      .some(entry => entry.status === 'copying')
    const blockClick = (event: MouseEvent): void => {
      if (!copying()) return
      const target = event.target instanceof Element ? event.target.closest('button') : null
      const card = target?.closest('[data-composer-card]')
      const buttons = card?.querySelectorAll('button')
      if (!target || !card || target !== buttons?.item((buttons?.length ?? 0) - 1) || !target.querySelector('svg path')) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }
    const blockKey = (event: globalThis.KeyboardEvent): void => {
      if (!copying() || event.key !== 'Enter' || event.isComposing) return
      const target = event.target instanceof Element ? event.target.closest('[data-composer-input]') : null
      if (!target) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }
    const blockSubmit = (event: SubmitEvent): void => {
      if (!copying()) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }
    window.addEventListener('click', blockClick, true)
    window.addEventListener('keydown', blockKey, true)
    window.addEventListener('submit', blockSubmit, true)
    return () => {
      window.removeEventListener('click', blockClick, true)
      window.removeEventListener('keydown', blockKey, true)
      window.removeEventListener('submit', blockSubmit, true)
    }
  }, [session.sessionId])

  useEffect(() => {
    const referenceSource = (event: Event): void => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== 'object' || !event.detail) return
      const detail = event.detail as Partial<SessionResourceReferenceDetail>
      if (detail.sessionId !== session.sessionId || typeof detail.path !== 'string') return
      const mention = resourceMention(detail.path)
      const current = sessionResourceDrafts.get(session.sessionId) ?? input.draft
      if (current.includes(mention)) return
      const separator = current.trim().length > 0 ? ' ' : ''
      const next = `${current}${separator}${mention} `
      sessionResourceDrafts.set(session.sessionId, next)
      inputActions.setDraft(next)
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-composer-input]')?.focus())
    }
    window.addEventListener('dsh-work:reference-session-resource', referenceSource)
    return () => window.removeEventListener('dsh-work:reference-session-resource', referenceSource)
  }, [input.draft, inputActions, session.sessionId])

  const remove = (entry: SessionResourceEntryState): void => {
    updateEntries(session.sessionId, current => current.filter(candidate => candidate.id !== entry.id))
    entry.abort.abort()
    if (entry.mention) {
      const next = (sessionResourceDrafts.get(session.sessionId) ?? input.draft)
        .replace(entry.mention, '').replace(/ {2,}/gu, ' ').trimStart()
      sessionResourceDrafts.set(session.sessionId, next)
      inputActions.setDraft(next)
    }
  }

  return h('div', {
    className: `dsh-work-session-resource${dropActive ? ' is-drop-active' : ''}`,
    'data-work-session-resource': session.sessionId,
  },
  h('input', {
    ref: picker,
    className: 'dsh-work-file-input',
    type: 'file',
    multiple: true,
    accept: '.md,.txt,.csv,.json,text/markdown,text/plain,text/csv,application/json',
    onChange: (event: { currentTarget: HTMLInputElement }) => {
      const files = Array.from(event.currentTarget.files ?? [])
      event.currentTarget.value = ''
      importFiles(files)
    },
  }),
  h('button', {
    className: 'dsh-work-session-resource-trigger',
    type: 'button',
    title: '添加资料（Markdown、TXT、CSV、JSON）',
    'aria-label': '添加资料',
    disabled: input.phase !== 'plain',
    onClick: () => picker.current?.click(),
  }, h('span', { 'aria-hidden': true }, '+'), '资料'),
  entries.length > 0 ? h('div', {
    className: 'dsh-work-session-resource-popover',
    role: 'status',
    'aria-label': '待发送资料',
  }, ...entries.map(entry => h('div', {
    className: `dsh-work-session-resource-row is-${entry.status}`,
    key: entry.id,
    'data-work-session-resource-name': entry.file.name,
  },
  h('span', { className: 'dsh-work-session-resource-icon', 'aria-hidden': true }, '文'),
  h('span', { className: 'dsh-work-session-resource-copy' },
    h('strong', { title: entry.path ?? entry.file.name }, entry.file.name),
    h('small', null, entry.status === 'copying'
      ? '正在复制到当前工作区…'
      : entry.status === 'ready'
        ? '已复制，发送后读取'
        : entry.error)),
  entry.status === 'failed' ? h('button', {
    type: 'button',
    onClick: () => { void importFile(entry.file, entry.id) },
  }, '重试') : null,
  h('button', {
    type: 'button',
    'aria-label': `移除 ${entry.file.name}`,
    onClick: () => remove(entry),
  }, '×')))) : null)
}

function WorkRow({ work }: { readonly work: WorkView }): ReactNode {
  const status = workStatus(work)
  return h('article', { className: 'dsh-work-row', 'data-work-id': work.workId },
    h('div', { className: 'dsh-work-row-main' },
      h('span', { className: 'dsh-work-file-token', 'aria-hidden': 'true' }, '文'),
      h('div', null, h('strong', null, work.title), h('span', null, work.goal))),
    h('span', { className: `dsh-work-status is-${status.tone}` }, status.label),
    h('span', { className: 'dsh-work-progress' }, work.turnCount > 0 ? `已推进 ${work.turnCount} 次` : '尚未开始'))
}

function LoadingHome(): ReactNode {
  return h('div', { className: 'dsh-work-home-loading', 'aria-label': '正在加载工作首页' },
    h('div', { className: 'dsh-work-skeleton is-title' }),
    h('div', { className: 'dsh-work-skeleton is-composer' }),
    h('div', { className: 'dsh-work-skeleton is-row' }))
}

function LegacyDeliverableAction({ works, wide }: WorkSurfaceInjected & { readonly wide: boolean }): ReactNode {
  const snapshot = useWorks(works)
  const work = snapshot.items.find(item => item.deliverable !== null)
  if (!work) return null
  return h('button', {
    className: 'dsh-work-legacy-deliverable-open',
    type: 'button',
    title: '查看旧成果',
    'aria-label': '查看旧成果',
    'data-work-legacy-deliverable-open': true,
    onClick: () => window.dispatchEvent(new Event('dsh-work:open-legacy-deliverable')),
  }, wide ? '旧成果' : '文')
}

function LegacyDeliverableOverlay({ works }: WorkSurfaceInjected): ReactNode {
  const snapshot = useWorks(works)
  const work = snapshot.items.find(item => item.deliverable !== null)
  const [open, setOpen] = useState(false)
  const [content, setContent] = useState<WorkDeliverableContent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  useEffect(() => {
    const show = (): void => setOpen(true)
    window.addEventListener('dsh-work:open-legacy-deliverable', show)
    return () => window.removeEventListener('dsh-work:open-legacy-deliverable', show)
  }, [])
  useEffect(() => {
    let active = true
    if (!open || !work?.deliverable) return () => { active = false }
    setContent(null)
    setError(null)
    void works.readDeliverable(work.workId).then(value => {
      if (active) setContent(value)
    }, reason => {
      if (active) setError(reason instanceof Error ? reason.message : '暂时无法读取旧成果。')
    })
    return () => { active = false }
  }, [open, work?.deliverable, work?.revision, work?.workId, works])
  if (!open || !work?.deliverable) return null
  return h('section', {
    className: 'dsh-work-legacy-deliverable-overlay',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': '旧成果',
    'data-work-legacy-deliverable-surface': true,
  }, h('div', { className: 'dsh-work-legacy-deliverable-frame' },
    h('header', null,
      h('div', null, h('strong', null, work.title), h('span', null, work.deliverable.path)),
      h('button', {
        type: 'button',
        'aria-label': '关闭旧成果',
        onClick: () => setOpen(false),
      }, '关闭')),
    error
      ? h('p', { className: 'dsh-work-inline-error', role: 'alert' }, error)
      : content
        ? h('pre', { 'data-work-legacy-deliverable-preview': true }, content.content)
        : h('p', { className: 'dsh-work-legacy-deliverable-loading' }, '正在读取旧成果…'),
    work.status === 'delivered'
      ? h('footer', null, h('button', {
        type: 'button',
        disabled: opening,
        onClick: () => {
          setOpening(true)
          setError(null)
          void works.showDelivery(work.workId).catch(reason => {
            setError(reason instanceof Error ? reason.message : '暂时无法打开导出位置。')
          }).finally(() => setOpening(false))
        },
      }, opening ? '正在打开' : '在 Finder 中显示'))
      : null))
}

export function WorkHomeSurface({ works }: WorkSurfaceInjected): ReactNode {
  const snapshot = useWorks(works)
  const work = snapshot.items[0]
  const [goal, setGoal] = useState('')
  const [creating, setCreating] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importing, setImporting] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [importTitle, setImportTitle] = useState('')
  const [importContent, setImportContent] = useState('')
  const [importSource, setImportSource] = useState<'dsh' | 'dsh-desktop' | 'other'>('dsh-desktop')
  const [pendingFiles, setPendingFiles] = useState<readonly File[]>([])
  const [deliverableContent, setDeliverableContent] = useState<WorkDeliverableContent | null>(null)
  const [deliverableError, setDeliverableError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const busy = creating || importing || finalizing
  const resourceCount = (work?.resources.length ?? 0) + pendingFiles.length
  const resourceRemaining = Math.max(0, MAX_RESOURCE_FILES - resourceCount)
  const canRevise = Boolean(work?.deliverable && work.status === 'awaiting-review')
  const canSubmit = goal.trim().length > 0 && !busy && (!work?.deliverable || canRevise)
  const canImport = importContent.trim().length > 0 && importContent.length <= 100_000 && !busy
  const composerTitle = work?.deliverable ? '审核 Markdown 成果' : work ? '接下来想推进什么？' : '你想完成什么？'
  const composerHint = work?.deliverable
    ? '在下方查看 Markdown 原文预览，然后提出修改要求。'
    : work
      ? '补充成果要求，继续推进同一项工作。'
      : '描述想要的结果，资料可以稍后添加。'

  const addFiles = useCallback((files: readonly File[]) => {
    setActionError(null)
    const accepted: File[] = []
    const known = new Set(pendingFiles.map(file => `${file.name}\0${file.size}\0${file.lastModified}`))
    for (const file of files) {
      if (accepted.length >= resourceRemaining) {
        setActionError(`每项工作最多添加 ${MAX_RESOURCE_FILES} 个文件。`)
        break
      }
      if (file.size < 1 || file.size > MAX_RESOURCE_FILE_BYTES) {
        setActionError(`“${file.name}”为空或超过 25 MiB，未添加。`)
        continue
      }
      if (file.name.length > 200 || file.name === '.' || file.name === '..' || /[\\/\u0000-\u001f\u007f]/u.test(file.name)) {
        setActionError(`“${file.name}”的文件名不可用，未添加。`)
        continue
      }
      const key = `${file.name}\0${file.size}\0${file.lastModified}`
      if (known.has(key)) continue
      known.add(key)
      accepted.push(file)
    }
    if (accepted.length > 0) setPendingFiles(current => [...current, ...accepted])
  }, [pendingFiles, resourceRemaining])

  const submit = useCallback(async () => {
    const instruction = goal.trim()
    if (!instruction || busy) return
    setCreating(true)
    setActionError(null)
    try {
      let target = work ?? await works.create({
        title: titleFromGoal(instruction),
        goal: instruction,
      })
      for (const file of pendingFiles) {
        target = await works.dispatch({
          workId: target.workId,
          command: {
            type: 'add-file-resource',
            name: file.name,
            ...(file.type ? { mediaType: file.type } : {}),
            dataBase64: await fileBase64(file),
          },
        })
      }
      await works.dispatch({
        workId: target.workId,
        command: target.deliverable
          ? { type: 'revise-markdown', instruction }
          : { type: 'produce-markdown', instruction },
      })
      setGoal('')
      setPendingFiles([])
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '工作暂时无法开始，请稍后重试。')
    } finally {
      setCreating(false)
    }
  }, [busy, goal, pendingFiles, work, works])

  useEffect(() => {
    let active = true
    if (!work?.deliverable) {
      setDeliverableContent(null)
      setDeliverableError(null)
      return () => { active = false }
    }
    setDeliverableContent(null)
    setDeliverableError(null)
    void works.readDeliverable(work.workId).then(value => {
      if (active) setDeliverableContent(value)
    }, error => {
      if (active) setDeliverableError(error instanceof Error ? error.message : '暂时无法读取成果。')
    })
    return () => { active = false }
  }, [work?.deliverable, work?.revision, work?.workId, works])

  const finalize = useCallback(async () => {
    if (!work?.deliverable || finalizing) return
    setFinalizing(true)
    setActionError(null)
    try {
      if (work.status === 'awaiting-review') {
        await works.dispatch({ workId: work.workId, command: { type: 'complete' } })
      } else if (work.status === 'completed') {
        await works.dispatch({ workId: work.workId, command: { type: 'deliver' } })
      } else if (work.status === 'delivered') {
        await works.showDelivery(work.workId)
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '成果操作暂时失败，请稍后重试。')
    } finally {
      setFinalizing(false)
    }
  }, [finalizing, work, works])

  const importConversation = useCallback(async () => {
    const content = importContent.trim()
    if (!content || content.length > 100_000 || busy || work) return
    const title = importTitle.trim() || titleFromGoal(content)
    setImporting(true)
    setActionError(null)
    try {
      await works.importConversation({
        title,
        goal: goal.trim() || `延续“${title}”中的对话，形成可以审核和交付的成果。`,
        source: { sourceSystem: importSource, content },
      })
      setImportContent('')
      setImportTitle('')
      setShowImport(false)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '已有对话暂时无法导入，请稍后重试。')
    } finally {
      setImporting(false)
    }
  }, [busy, goal, importContent, importSource, importTitle, work, works])

  const onSubmit = useCallback((event: FormEvent) => {
    event.preventDefault()
    void submit()
  }, [submit])
  const onKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void submit()
    }
  }, [submit])
  const workRows = useMemo(() => snapshot.items.map(item => h(WorkRow, {
    key: item.workId,
    work: item,
  })), [snapshot.items])

  if (snapshot.phase === 'pending') return h('main', { className: 'dsh-work-home' }, h(LoadingHome))
  return h('main', { className: 'dsh-work-home' },
    h('header', { className: 'dsh-work-topbar' },
      h('h1', null, '工作'),
      h('div', { className: 'dsh-work-runtime' },
        h('span', { 'aria-hidden': 'true' }), '运行就绪')),
    h('div', { className: 'dsh-work-home-scroll' },
      h('div', { className: 'dsh-work-home-content' },
        h('form', { className: 'dsh-work-composer', onSubmit },
          h('div', { className: 'dsh-work-composer-heading' },
            h('h2', null, composerTitle),
            h('p', null, composerHint)),
          work?.deliverable
            ? h('section', { className: 'dsh-work-markdown-preview', 'aria-label': 'Markdown 原文预览' },
              h('div', { className: 'dsh-work-markdown-preview-heading' },
                h('strong', null, 'Markdown 原文预览'),
                h('span', null, work.deliverable.path)),
              deliverableError
                ? h('p', { className: 'dsh-work-inline-error', role: 'alert' }, deliverableError)
                : deliverableContent
                  ? h('pre', { 'data-work-markdown-preview': true }, deliverableContent.content)
                  : h('div', { className: 'dsh-work-markdown-loading', 'aria-label': '正在读取成果' }, '正在读取成果…'))
            : null,
          h('label', { className: 'dsh-work-visually-hidden', htmlFor: 'dsh-work-goal' }, '工作目标'),
          h('textarea', {
            id: 'dsh-work-goal',
            'data-work-goal': true,
            value: goal,
            disabled: busy || Boolean(work?.deliverable && work.status !== 'awaiting-review'),
            placeholder: work
              ? work.deliverable
                ? '例如：把建议改得更具体，并为每个行动项补充负责人和日期。'
                : '例如：把结论压缩成一页管理层摘要，并补充下一步建议。'
              : '描述你想完成的结果；需要时可在下方添加文件。',
            onChange: (event: { currentTarget: { value: string } }) => setGoal(event.currentTarget.value),
            onKeyDown,
          }),
          work?.resources.length || pendingFiles.length
            ? h('div', { className: 'dsh-work-resource-chips', 'aria-label': '已选资料' },
              ...(work?.resources ?? []).map(resource => h('span', {
                className: 'dsh-work-resource-chip',
                key: resource.resourceId,
                'data-work-resource': resource.path,
                title: resource.path,
              }, h('span', { 'aria-hidden': 'true' }, '文'), resource.name, h('small', null, '已添加'))),
              ...pendingFiles.map(file => h('span', {
                className: 'dsh-work-resource-chip is-pending',
                key: `${file.name}-${file.size}-${file.lastModified}`,
                'data-work-pending-resource': file.name,
                title: file.name,
              }, h('span', { 'aria-hidden': 'true' }, '文'), file.name, h('small', null, '待添加'), h('button', {
                type: 'button',
                disabled: busy,
                'aria-label': `移除 ${file.name}`,
                onClick: () => setPendingFiles(current => current.filter(item => item !== file)),
              }, '×'))))
            : null,
          actionError
            ? h('p', { className: 'dsh-work-inline-error', role: 'alert' }, actionError)
            : snapshot.state === 'error'
              ? h('p', { className: 'dsh-work-inline-error', role: 'status' }, '连接正在恢复，已有工作不会丢失。')
              : null,
          showImport && !work
            ? h('section', { className: 'dsh-work-import', 'aria-labelledby': 'dsh-work-import-title' },
              h('div', { className: 'dsh-work-import-heading' },
                h('div', null,
                  h('h3', { id: 'dsh-work-import-title' }, '继续已有对话'),
                  h('p', null, '粘贴导出的可读内容，系统会复制上下文并创建新工作；原对话不会改变。')),
                h('button', {
                  type: 'button',
                  className: 'dsh-work-import-close',
                  disabled: importing,
                  'aria-label': '关闭继续已有对话',
                  onClick: () => setShowImport(false),
                }, '×')),
              h('div', { className: 'dsh-work-import-fields' },
                h('label', null, h('span', null, '来源'), h('select', {
                  value: importSource,
                  disabled: importing,
                  onChange: (event: { currentTarget: { value: 'dsh' | 'dsh-desktop' | 'other' } }) =>
                    setImportSource(event.currentTarget.value),
                },
                h('option', { value: 'dsh-desktop' }, 'DSH Desktop'),
                h('option', { value: 'dsh' }, 'DSH Web / CLI'),
                h('option', { value: 'other' }, '其他来源'))),
                h('label', null, h('span', null, '新工作名称（可选）'), h('input', {
                  value: importTitle,
                  maxLength: 200,
                  disabled: importing,
                  placeholder: '未填写时根据内容生成',
                  onChange: (event: { currentTarget: { value: string } }) => setImportTitle(event.currentTarget.value),
                }))),
              h('label', { className: 'dsh-work-import-content' },
                h('span', null, '已有对话内容'),
                h('textarea', {
                  'data-work-import-content': true,
                  value: importContent,
                  maxLength: 100_000,
                  disabled: importing,
                  placeholder: '粘贴从 DSH Desktop、DSH Web 或 CLI 导出的可读对话内容',
                  onChange: (event: { currentTarget: { value: string } }) => setImportContent(event.currentTarget.value),
                })),
              h('div', { className: 'dsh-work-import-actions' },
                h('small', null, `${importContent.length.toLocaleString()} / 100,000`),
                h('button', {
                  type: 'button',
                  className: 'dsh-work-import-submit',
                  disabled: !canImport,
                  onClick: () => { void importConversation() },
                }, importing ? '正在导入' : '创建新工作并继续')))
            : null,
          h('div', { className: 'dsh-work-composer-actions' },
            h('div', { className: 'dsh-work-secondary-actions' },
              h(ResourceEntry, { disabled: busy || Boolean(work?.deliverable), onFiles: addFiles, remaining: resourceRemaining }),
              !work ? h('button', {
                className: 'dsh-work-import-trigger',
                type: 'button',
                disabled: busy,
                onClick: () => setShowImport(value => !value),
              }, '继续已有对话') : null),
            h('button', {
              className: 'dsh-work-primary',
              type: 'submit',
              disabled: !canSubmit,
            }, creating
              ? work?.deliverable ? '正在修改成果' : '正在生成成果'
              : work?.deliverable ? '按要求修改' : work ? '生成成果' : '开始工作'))),
        work?.deliverable
          ? h('section', { className: 'dsh-work-deliverable-card', 'aria-label': 'Markdown 成果' },
            h('span', { className: 'dsh-work-deliverable-token', 'aria-hidden': 'true' }, 'MD'),
            h('div', null,
              h('strong', null, 'Markdown 成果'),
              h('span', { title: work.deliverable.path }, work.deliverable.path)),
            h('div', { className: 'dsh-work-deliverable-actions' },
              h('span', { className: `dsh-work-status is-${workStatus(work).tone}` }, workStatus(work).label),
              h('button', {
                type: 'button',
                disabled: finalizing,
                onClick: () => { void finalize() },
              }, finalizing
                ? work.status === 'awaiting-review' ? '正在完成' : work.status === 'completed' ? '正在导出' : '正在打开'
                : work.status === 'awaiting-review' ? '确认完成' : work.status === 'completed' ? '导出成果' : '在 Finder 中显示')))
          : null,
        h('section', { className: 'dsh-work-shortcuts', 'aria-labelledby': 'dsh-work-shortcuts-title' },
          h('h2', { id: 'dsh-work-shortcuts-title' }, '常见工作'),
          h('div', { className: 'dsh-work-shortcut-grid' }, shortcuts.map(shortcut =>
            h('button', {
              className: 'dsh-work-shortcut',
              type: 'button',
              key: shortcut.key,
              disabled: busy,
              onClick: () => {
                setGoal(shortcut.goal)
                requestAnimationFrame(focusGoal)
              },
            },
            h('span', { className: 'dsh-work-shortcut-token', 'aria-hidden': 'true' }, shortcut.token),
            h('span', null, h('strong', null, shortcut.title), h('small', null, shortcut.detail)))))),
        h('section', { className: 'dsh-work-recent', 'aria-labelledby': 'dsh-work-recent-title' },
          h('div', { className: 'dsh-work-section-heading' },
            h('h2', { id: 'dsh-work-recent-title' }, '最近工作'),
            h('span', null, snapshot.items.length ? `${snapshot.items.length} 项` : '暂无工作')),
          snapshot.items.length
            ? h('div', { className: 'dsh-work-list' },
              h('div', { className: 'dsh-work-list-head', 'aria-hidden': 'true' },
                h('span', null, '名称'), h('span', null, '状态'), h('span', null, '进展')),
              ...workRows)
            : h('p', { className: 'dsh-work-list-empty' }, '从上面的目标开始你的第一项工作。')))))
}

function outputSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function sourceStatusLabel(status: WorkSessionOutputSource['status']): string {
  switch (status) {
    case 'verified': return '已读取'
    case 'unverified': return '已关联，未读取'
    case 'missing': return '文件不存在'
    case 'changed': return '文件已变更'
    case 'inaccessible': return '无法访问'
  }
}

function NativeSessionOutputs({ matched, openFile, sessionId, works }: NativeSessionOutputsProps): ReactNode {
  const [files, setFiles] = useState<readonly WorkSessionOutputFile[]>(Object.freeze([]))
  const [sources, setSources] = useState<readonly WorkSessionOutputSource[]>(Object.freeze([]))
  const [sourcePhase, setSourcePhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [revisionFailure, setRevisionFailure] = useState<WorkSessionOutputRevisionFailure | null>(null)

  useEffect(() => {
    const abort = new AbortController()
    setFiles(Object.freeze([]))
    setSources(Object.freeze([]))
    setSourcePhase('loading')
    setSelectedPath(null)
    const spec = {
      sessionId,
      turn: matched.turn,
      throughSeq: matched.throughSeq,
    }
    setRevisionFailure(null)
    void works.inspectSessionRevision(spec, abort.signal).then(failure => {
      if (abort.signal.aborted) return
      setRevisionFailure(failure)
      return works.inspectSessionOutputs(spec, abort.signal).then(nextFiles => {
        if (!abort.signal.aborted) setFiles(nextFiles)
      })
    }).catch(() => {
      if (!abort.signal.aborted) setFiles(Object.freeze([]))
    })
    void works.inspectSessionOutputSources(spec, abort.signal).then(nextSources => {
      if (abort.signal.aborted) return
      setSources(nextSources)
      setSourcePhase('ready')
    }).catch(() => {
      if (!abort.signal.aborted) {
        setSources(Object.freeze([]))
        setSourcePhase('error')
      }
    })
    return () => abort.abort()
  }, [matched.throughSeq, matched.turn, sessionId, works])

  if (files.length < 1 && !revisionFailure) return null
  const verifiedCount = sources.filter(source => source.status === 'verified').length
  const sourceSummary = verifiedCount > 0
    ? `已读取 ${String(verifiedCount)} 份资料`
    : `已关联 ${String(sources.length)} 份资料`
  return h('div', {
    className: 'dsh-work-session-outputs',
    'data-work-session-outputs': true,
    'data-work-session-output-turn': String(matched.turn),
    'data-work-session-sources-phase': sourcePhase,
  },
  revisionFailure ? h('div', {
    className: 'dsh-work-session-revision-failure',
    role: 'alert',
    'data-work-session-revision-failure': revisionFailure.path,
  },
  h('span', null,
    h('strong', null, `${revisionFailure.name} 修改失败`),
    h('small', null, revisionFailure.message)),
  h('button', {
    type: 'button',
    onClick: () => window.dispatchEvent(new CustomEvent<SessionResourceReferenceDetail>(
      'dsh-work:reference-session-resource',
      { detail: Object.freeze({ sessionId: revisionFailure.sessionId, path: revisionFailure.path }) },
    )),
  }, '在原会话重试')) : null,
  sources.length > 0 ? h('div', {
    className: 'dsh-work-session-sources',
    'data-work-session-sources': true,
  },
  h('span', { className: 'dsh-work-session-sources-summary' }, sourceSummary),
  h('div', { className: 'dsh-work-session-sources-list' }, ...sources.map(source => h('span', {
    className: `dsh-work-session-source is-${source.status}`,
    key: source.path,
    title: source.path,
    'data-work-session-source': source.path,
  },
  h('strong', null, source.name),
  h('small', null, sourceStatusLabel(source.status)))))) : null,
  sourcePhase === 'error' ? h('span', { className: 'dsh-work-session-sources-error' }, '资料来源暂不可用') : null,
  files.length > 0 ? h('div', { className: 'dsh-work-session-output-group' },
  h('span', { className: 'dsh-work-session-outputs-label' }, '生成结果'),
  h('div', { className: 'dsh-work-session-outputs-row' }, ...files.map(file => h('button', {
    type: 'button',
    key: file.path,
    title: file.path,
    className: `dsh-work-session-output${selectedPath === file.path ? ' is-selected' : ''}`,
    'data-work-session-output': file.path,
    'aria-pressed': selectedPath === file.path,
    onClick: () => {
      setSelectedPath(file.path)
      const selection = new CustomEvent<SessionOutputPreviewDetail>('dsh-work:select-session-output', {
        cancelable: true,
        detail: Object.freeze({
          sessionId: file.sessionId,
          turn: file.turn,
          throughSeq: matched.throughSeq,
          name: file.name,
          path: file.path,
          bytes: file.bytes,
          mediaType: file.mediaType,
        }),
      }) as SessionOutputSelectionEvent
      Object.defineProperty(selection, SESSION_OUTPUT_OPEN, {
        value: () => openFile(file.path),
      })
      if (window.dispatchEvent(selection)) openFile(file.path)
    },
  },
  h('span', { className: 'dsh-work-session-output-icon', 'aria-hidden': 'true' }, '文'),
  h('span', { className: 'dsh-work-session-output-copy' },
    h('strong', null, file.name),
    h('small', null, outputSize(file.bytes))))))) : null)
}

function safeMarkdownContent(content: WorkSessionOutputContent): ReactNode {
  const plan = planSafeMarkdownRender(content.content)
  if (plan.mode === 'plain') {
    return h('article', {
      className: 'dsh-work-output-preview-markdown',
      'data-work-output-preview-markdown': true,
      'data-work-output-preview-mode': 'plain',
    }, [
      h('p', { className: 'dsh-work-output-preview-density', key: 'notice' },
        '内容结构较密集，已切换为纯文本阅读。'),
      h('pre', { key: 'content' }, plan.content),
    ])
  }
  return h('article', {
    className: 'dsh-work-output-preview-markdown',
    'data-work-output-preview-markdown': true,
    'data-work-output-preview-mode': 'structured',
  }, plan.blocks.map((block, index) => {
    if (block.kind === 'heading') {
      return h(`h${String(block.level)}`, { key: index }, block.text)
    }
    if (block.kind === 'list') {
      return h(block.ordered ? 'ol' : 'ul', { key: index },
        block.items.map((item, itemIndex) => h('li', { key: itemIndex }, item)))
    }
    if (block.kind === 'code') {
      return h('pre', { key: index }, h('code', null, block.text))
    }
    return h('p', { key: index }, block.text)
  }))
}

function NativeSessionOutputPreview({
  closePreview,
  preview,
  sessionId,
  works,
}: NativeSessionOutputPreviewProps): ReactNode {
  const selection = useSyncExternalStore(preview.subscribe, preview.getSnapshot, preview.getSnapshot)
  const [tab, setTab] = useState<'content' | 'sources'>('content')
  const [retry, setRetry] = useState(0)
  const request = useMemo(() => new LatestPreviewRequest(), [])
  const [state, setState] = useState<
    | { readonly phase: 'idle' }
    | { readonly phase: 'loading' }
    | { readonly phase: 'ready'; readonly content: WorkSessionOutputContent }
    | { readonly phase: 'error' }
  >({ phase: 'idle' })
  const [sourceState, setSourceState] = useState<
    | { readonly phase: 'idle' | 'loading' | 'error' }
    | { readonly phase: 'ready'; readonly sources: readonly WorkSessionOutputSource[] }
  >({ phase: 'idle' })
  const [revisionPhase, setRevisionPhase] = useState<'idle' | 'preparing' | 'error'>('idle')

  useEffect(() => {
    setTab('content')
    setRevisionPhase('idle')
  }, [selection?.path, selection?.sessionId])

  useEffect(() => {
    if (!selection || selection.sessionId !== sessionId || selection.mediaType !== 'text/markdown') {
      setState({ phase: 'idle' })
      return
    }
    const abort = new AbortController()
    setState({ phase: 'loading' })
    void request.run(
      () => works.readSessionOutput({
        sessionId: selection.sessionId,
        turn: selection.turn,
        throughSeq: selection.throughSeq,
        path: selection.path,
      }, abort.signal),
      content => setState({ phase: 'ready', content }),
      () => setState({ phase: 'error' }),
    )
    return () => {
      request.invalidate()
      abort.abort()
    }
  }, [request, retry, selection, sessionId, works])

  useEffect(() => {
    if (!selection || selection.sessionId !== sessionId) {
      setSourceState({ phase: 'idle' })
      return
    }
    const abort = new AbortController()
    setSourceState({ phase: 'loading' })
    void works.inspectSessionOutputSources({
      sessionId: selection.sessionId,
      turn: selection.turn,
      throughSeq: selection.throughSeq,
    }, abort.signal).then(sources => {
      if (abort.signal.aborted) return
      setSourceState({ phase: 'ready', sources })
    }).catch(() => {
      if (!abort.signal.aborted) setSourceState({ phase: 'error' })
    })
    return () => abort.abort()
  }, [selection, sessionId, works])

  useEffect(() => {
    if (selection && selection.sessionId !== sessionId) closePreview()
  }, [closePreview, selection, sessionId])

  if (!selection) return null
  const unsupported = selection.mediaType !== 'text/markdown'
  const previewSources = sourceState.phase === 'ready' ? sourceState.sources : Object.freeze([])
  return h('section', {
    className: 'dsh-work-output-preview',
    'data-work-output-preview': selection.path,
    'aria-label': `${selection.name} 预览`,
  },
  h('header', { className: 'dsh-work-output-preview-header' },
    h('span', { className: 'dsh-work-output-preview-file-icon', 'aria-hidden': 'true' }, '文'),
    h('strong', { title: selection.path }, selection.name),
    h('button', {
      type: 'button',
      className: 'dsh-work-output-preview-close',
      'aria-label': '关闭文件预览',
      onClick: closePreview,
    }, '×')),
  h('div', { className: 'dsh-work-output-preview-tabs', role: 'tablist', 'aria-label': '文件详情' },
    h('button', {
      type: 'button',
      role: 'tab',
      'aria-selected': tab === 'content',
      onClick: () => setTab('content'),
    }, '内容'),
    h('button', {
      type: 'button',
      role: 'tab',
      'aria-selected': tab === 'sources',
      onClick: () => setTab('sources'),
    }, `来源${previewSources.length > 0 ? ` ${String(previewSources.length)}` : ''}`)),
  h('div', { className: 'dsh-work-output-preview-meta' },
    h('span', null, `第 ${String(selection.turn)} 回合生成`),
    h('span', null, outputSize(selection.bytes))),
  h('div', { className: 'dsh-work-output-preview-body' },
    tab === 'sources'
      ? sourceState.phase === 'loading' || sourceState.phase === 'idle'
        ? h('div', { className: 'dsh-work-output-preview-status', role: 'status', 'aria-live': 'polite' }, '正在核对资料来源…')
        : sourceState.phase === 'error'
          ? h('div', { className: 'dsh-work-output-preview-empty' },
            h('strong', null, '暂时无法核对资料来源'),
            h('p', null, '重新打开文件后可以再次核对。'))
          : previewSources.length < 1
            ? h('div', { className: 'dsh-work-output-preview-empty' },
              h('strong', null, '没有可核对的资料来源'),
              h('p', null, '这里只显示本回合明确引用或实际读取的工作区资料。'))
            : h('div', { className: 'dsh-work-output-preview-sources' }, ...previewSources.map(source => h('article', {
              className: `dsh-work-output-preview-source is-${source.status}`,
              key: source.path,
              'data-work-output-preview-source': source.path,
            },
            h('div', { className: 'dsh-work-output-preview-source-main' },
              h('span', { className: 'dsh-work-output-preview-source-icon', 'aria-hidden': true }, '文'),
              h('span', { className: 'dsh-work-output-preview-source-copy' },
                h('strong', null, source.name),
                h('small', { title: source.path }, source.path))),
            h('div', { className: 'dsh-work-output-preview-source-meta' },
              h('span', null, '工作区副本'),
              h('span', { className: `is-${source.status}` }, sourceStatusLabel(source.status)),
              source.bytes === null ? null : h('span', null, outputSize(source.bytes))),
            h('button', {
              type: 'button',
              disabled: source.status !== 'verified' && source.status !== 'unverified',
              onClick: () => window.dispatchEvent(new CustomEvent<SessionResourceReferenceDetail>(
                'dsh-work:reference-session-resource',
                { detail: Object.freeze({ sessionId: source.sessionId, path: source.path }) },
              )),
            }, '在输入框引用'))))
      : unsupported
      ? h('div', { className: 'dsh-work-output-preview-empty' },
        h('strong', null, '此格式暂不支持应用内预览'),
        h('p', null, '可以使用系统应用打开这个文件。'),
        h('button', { type: 'button', onClick: selection.open }, '使用系统应用打开'))
      : state.phase === 'loading' || state.phase === 'idle'
        ? h('div', { className: 'dsh-work-output-preview-status', role: 'status', 'aria-live': 'polite' }, '正在读取文件…')
        : state.phase === 'error'
          ? h('div', { className: 'dsh-work-output-preview-empty', role: 'alert' },
            h('strong', null, '暂时无法读取文件'),
            h('p', null, '文件可能已移动、仍在写入或内容过大。'),
            h('button', { type: 'button', onClick: () => setRetry(value => value + 1) }, '重试'))
          : safeMarkdownContent(state.content)),
  !unsupported ? h('footer', { className: 'dsh-work-output-preview-actions' },
    revisionPhase === 'error'
      ? h('span', { role: 'alert' }, '无法保护当前文件，请重新读取后再试。')
      : h('span', null, '修改会继续使用当前会话'),
    h('button', {
      type: 'button',
      disabled: state.phase !== 'ready' || revisionPhase === 'preparing',
      onClick: () => {
        const target = selection
        setRevisionPhase('preparing')
        void works.prepareSessionOutputRevision({
          sessionId: target.sessionId,
          turn: target.turn,
          throughSeq: target.throughSeq,
          path: target.path,
        }).then(revision => {
          if (preview.getSnapshot()?.sessionId !== target.sessionId
            || preview.getSnapshot()?.path !== target.path
            || sessionId !== target.sessionId) return
          setRevisionPhase('idle')
          window.dispatchEvent(new CustomEvent<SessionResourceReferenceDetail>(
            'dsh-work:reference-session-resource',
            { detail: Object.freeze({ sessionId: revision.sessionId, path: revision.path }) },
          ))
        }).catch(() => {
          if (preview.getSnapshot()?.sessionId === target.sessionId
            && preview.getSnapshot()?.path === target.path) setRevisionPhase('error')
        })
      },
    }, revisionPhase === 'preparing' ? '正在准备…' : '要求修改')) : null)
}

const styles = `
:root {
  --work-bg: #f5f6f4;
  --work-sidebar: #ecefed;
  --work-surface: #ffffff;
  --work-surface-subtle: #f8f9f7;
  --work-text: #17202e;
  --work-muted: #697386;
  --work-faint: #8a93a2;
  --work-border: #dde1e7;
  --work-border-strong: #c9cfd8;
  --work-accent: #315cf4;
  --work-accent-hover: #2449ce;
  --work-accent-subtle: #e9eeff;
  --work-success: #25845b;
  --work-warning: #b96912;
  --work-danger: #b84a3a;
  --work-shadow: 0 12px 32px rgba(35, 50, 76, .08);
  --work-font: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}
body[data-ds-dark-theme] {
  --work-bg: #171a20;
  --work-sidebar: #20242b;
  --work-surface: #22262e;
  --work-surface-subtle: #292e37;
  --work-text: #eef1f5;
  --work-muted: #aeb6c3;
  --work-faint: #8993a2;
  --work-border: #343a45;
  --work-border-strong: #48505e;
  --work-accent: #7893ff;
  --work-accent-hover: #91a6ff;
  --work-accent-subtle: #29345c;
  --work-success: #62b88d;
  --work-warning: #dda25c;
  --work-danger: #dd7b6d;
  --work-shadow: 0 12px 32px rgba(0, 0, 0, .22);
}
.dsh-work-sidebar, .dsh-work-home { font-family: var(--work-font); color: var(--work-text); }
.dsh-work-native-brand-mark { width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; color: white; background: #365eca; font: 700 13px/1 var(--work-font); }
[data-approval-key] { font-family: var(--work-font); }
[data-approval-key] > div { border-color: color-mix(in srgb, var(--work-warning) 46%, var(--work-border)) !important; border-radius: 14px !important; box-shadow: var(--work-shadow) !important; }
.dsh-work-session-outputs { display: grid; gap: 10px; margin-top: 16px; color: var(--work-text); font-family: var(--work-font); }
.dsh-work-session-output-group { display: grid; grid-template-columns: max-content minmax(0, 1fr); align-items: center; gap: 8px; }
.dsh-work-session-outputs-label { color: var(--work-faint); font-size: 13px; line-height: 22px; }
.dsh-work-session-outputs-row { min-width: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.dsh-work-session-sources { display: flex; min-width: 0; align-items: center; flex-wrap: wrap; gap: 7px; }
.dsh-work-session-sources-summary { color: var(--work-muted); font-size: 12px; font-weight: 600; }
.dsh-work-session-sources-error { color: var(--work-warning); font-size: 11px; }
.dsh-work-session-sources-list { display: flex; min-width: 0; flex-wrap: wrap; gap: 6px; }
.dsh-work-session-source { display: inline-flex; min-width: 0; max-width: 220px; align-items: baseline; gap: 5px; padding: 3px 7px; border: 1px solid var(--work-border); border-radius: 7px; background: var(--work-surface-subtle); }
.dsh-work-session-source strong { overflow: hidden; color: var(--work-text); font-size: 11px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.dsh-work-session-source small { flex: 0 0 auto; color: var(--work-faint); font-size: 10px; }
.dsh-work-session-source.is-missing small, .dsh-work-session-source.is-changed small, .dsh-work-session-source.is-inaccessible small { color: var(--work-warning); }
.dsh-work-session-revision-failure { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--work-danger) 35%, var(--work-border)); border-radius: 9px; background: color-mix(in srgb, var(--work-danger) 7%, var(--work-surface)); }
.dsh-work-session-revision-failure > span { display: grid; min-width: 0; gap: 2px; }
.dsh-work-session-revision-failure strong { color: var(--work-text); font-size: 12px; }
.dsh-work-session-revision-failure small { color: var(--work-muted); font-size: 11px; }
.dsh-work-session-revision-failure button { flex: 0 0 auto; padding: 6px 9px; border: 1px solid var(--work-border-strong); border-radius: 7px; color: var(--work-text); background: var(--work-surface); cursor: pointer; font: 600 11px/1.2 var(--work-font); }
.dsh-work-session-output { min-width: 0; max-width: 260px; display: grid; grid-template-columns: 28px minmax(0, 1fr); align-items: center; gap: 8px; padding: 7px 10px 7px 8px; border: 1px solid var(--work-border); border-radius: 9px; color: var(--work-text); background: var(--work-surface); text-align: left; cursor: pointer; font-family: var(--work-font); }
.dsh-work-session-output:hover { border-color: var(--work-border-strong); background: var(--work-surface-subtle); }
.dsh-work-session-output.is-selected { border-color: var(--work-accent); box-shadow: inset 0 0 0 1px var(--work-accent); }
.dsh-work-session-output:focus-visible { outline: 2px solid var(--work-accent); outline-offset: 2px; }
.dsh-work-session-output-icon { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border-radius: 7px; color: var(--work-accent); background: var(--work-accent-subtle); font-size: 10px; font-weight: 700; }
.dsh-work-session-output-copy { min-width: 0; }
.dsh-work-session-output-copy strong, .dsh-work-session-output-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-work-session-output-copy strong { font-size: 12px; line-height: 17px; }
.dsh-work-session-output-copy small { color: var(--work-faint); font-size: 10px; line-height: 14px; }
.dsh-work-output-preview { height: 100%; min-width: 300px; display: flex; flex-direction: column; color: var(--work-text); background: var(--work-surface); font-family: var(--work-font); }
.dsh-work-output-preview-header { min-height: 64px; display: grid; grid-template-columns: 28px minmax(0, 1fr) 32px; align-items: center; gap: 10px; padding: 0 12px 0 18px; border-bottom: 1px solid var(--work-border); }
.dsh-work-output-preview-header strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; }
.dsh-work-output-preview-file-icon { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border-radius: 7px; color: var(--work-accent); background: var(--work-accent-subtle); font-size: 10px; font-weight: 700; }
.dsh-work-output-preview-close { width: 32px; height: 32px; border: 0; border-radius: 50%; color: var(--work-muted); background: transparent; cursor: pointer; font: 400 26px/30px var(--work-font); }
.dsh-work-output-preview-close:hover { color: var(--work-text); background: var(--work-surface-subtle); }
.dsh-work-output-preview-tabs { height: 50px; display: flex; align-items: stretch; padding: 0 18px; border-bottom: 1px solid var(--work-border); }
.dsh-work-output-preview-tabs button { position: relative; min-width: 54px; border: 0; color: var(--work-muted); background: transparent; cursor: pointer; font: 600 14px/50px var(--work-font); }
.dsh-work-output-preview-tabs button[aria-selected="true"] { color: var(--work-accent); }
.dsh-work-output-preview-tabs button[aria-selected="true"]::after { content: ''; position: absolute; height: 2px; left: 10px; right: 10px; bottom: 0; background: var(--work-accent); }
.dsh-work-output-preview-meta { display: flex; justify-content: space-between; gap: 12px; padding: 14px 24px 0; color: var(--work-faint); font-size: 11px; }
.dsh-work-output-preview-body { flex: 1; min-height: 0; padding: 18px 24px 96px; overflow-y: auto; }
.dsh-work-output-preview-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 18px; border-top: 1px solid var(--work-border); background: var(--work-surface); }
.dsh-work-output-preview-actions span { color: var(--work-muted); font-size: 11px; }
.dsh-work-output-preview-actions span[role="alert"] { color: var(--work-danger); }
.dsh-work-output-preview-actions button { flex: 0 0 auto; padding: 8px 14px; border: 1px solid var(--work-accent); border-radius: 8px; color: white; background: var(--work-accent); cursor: pointer; font: 600 13px/18px var(--work-font); }
.dsh-work-output-preview-actions button:disabled { cursor: default; opacity: .55; }
.dsh-work-output-preview-sources { display: grid; gap: 12px; }
.dsh-work-output-preview-source { display: grid; grid-template-columns: minmax(0, 1fr) max-content; gap: 10px 12px; padding: 14px; border: 1px solid var(--work-border); border-radius: 10px; background: var(--work-surface-subtle); }
.dsh-work-output-preview-source-main { display: flex; min-width: 0; align-items: center; gap: 10px; }
.dsh-work-output-preview-source-icon { display: grid; width: 28px; height: 32px; flex: 0 0 auto; place-items: center; border: 1px solid var(--work-border-strong); border-radius: 5px; background: var(--work-surface); color: var(--work-muted); font-size: 11px; font-weight: 700; }
.dsh-work-output-preview-source-copy { display: grid; min-width: 0; gap: 3px; }
.dsh-work-output-preview-source-copy strong, .dsh-work-output-preview-source-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-work-output-preview-source-copy strong { color: var(--work-text); font-size: 13px; }
.dsh-work-output-preview-source-copy small { color: var(--work-faint); font-size: 10px; }
.dsh-work-output-preview-source-meta { grid-column: 1 / -1; display: flex; align-items: center; flex-wrap: wrap; gap: 6px; color: var(--work-faint); font-size: 10px; }
.dsh-work-output-preview-source-meta span { padding: 2px 6px; border-radius: 999px; background: var(--work-surface); }
.dsh-work-output-preview-source-meta .is-verified { color: var(--work-success); }
.dsh-work-output-preview-source-meta .is-missing, .dsh-work-output-preview-source-meta .is-changed, .dsh-work-output-preview-source-meta .is-inaccessible { color: var(--work-warning); }
.dsh-work-output-preview-source > button { align-self: center; padding: 6px 9px; border: 1px solid var(--work-border-strong); border-radius: 7px; background: var(--work-surface); color: var(--work-text); cursor: pointer; font: 600 11px/1.2 var(--work-font); }
.dsh-work-output-preview-source > button:disabled { color: var(--work-faint); cursor: default; opacity: .65; }
.dsh-work-output-preview-status { color: var(--work-muted); padding: 16px 0; font-size: 13px; }
.dsh-work-output-preview-empty { display: grid; gap: 8px; align-content: start; padding: 28px 0; }
.dsh-work-output-preview-empty strong { font-size: 15px; }
.dsh-work-output-preview-empty p { margin: 0; color: var(--work-muted); font-size: 13px; line-height: 1.7; }
.dsh-work-output-preview-empty button { justify-self: start; margin-top: 8px; padding: 8px 14px; border: 1px solid var(--work-border-strong); border-radius: 7px; color: var(--work-text); background: var(--work-surface); cursor: pointer; font: 500 13px/18px var(--work-font); }
.dsh-work-output-preview-markdown { color: var(--work-text); overflow-wrap: anywhere; font-size: 14px; line-height: 1.8; }
.dsh-work-output-preview-markdown h1, .dsh-work-output-preview-markdown h2, .dsh-work-output-preview-markdown h3, .dsh-work-output-preview-markdown h4, .dsh-work-output-preview-markdown h5, .dsh-work-output-preview-markdown h6 { margin: 1.4em 0 .55em; line-height: 1.35; }
.dsh-work-output-preview-markdown h1:first-child, .dsh-work-output-preview-markdown h2:first-child { margin-top: 0; }
.dsh-work-output-preview-markdown h1 { font-size: 26px; }
.dsh-work-output-preview-markdown h2 { padding-bottom: 8px; border-bottom: 1px solid var(--work-border); font-size: 19px; }
.dsh-work-output-preview-markdown h3 { font-size: 16px; }
.dsh-work-output-preview-markdown h4, .dsh-work-output-preview-markdown h5, .dsh-work-output-preview-markdown h6 { font-size: 14px; }
.dsh-work-output-preview-markdown p { margin: 0 0 1em; }
.dsh-work-output-preview-markdown ul, .dsh-work-output-preview-markdown ol { margin: 0 0 1.1em; padding-left: 1.6em; }
.dsh-work-output-preview-markdown li + li { margin-top: 5px; }
.dsh-work-output-preview-markdown pre { max-width: 100%; margin: 0 0 1.1em; padding: 14px; overflow-x: auto; border-radius: 8px; color: var(--work-text); background: var(--work-surface-subtle); font: 12px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; }
.dsh-work-output-preview-density { color: var(--work-muted); font-size: 12px; }
.dsh-work-output-preview button:focus-visible { outline: 2px solid var(--work-accent); outline-offset: 2px; }
.dsh-work-legacy-deliverable-open { min-width: 30px; height: 30px; padding: 0 9px; border: 1px solid var(--work-border); border-radius: 6px; color: var(--work-muted); background: var(--work-surface); cursor: pointer; font: 550 12px/1 var(--work-font); white-space: nowrap; }
.dsh-work-legacy-deliverable-open:hover { color: var(--work-accent); border-color: var(--work-accent); }
.dsh-work-legacy-deliverable-overlay { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 28px; background: rgb(20 24 32 / .28); pointer-events: auto; }
.dsh-work-legacy-deliverable-frame { width: min(760px, calc(100vw - 56px)); max-height: min(680px, calc(100vh - 56px)); overflow: hidden; display: flex; flex-direction: column; border: 1px solid var(--work-border); border-radius: 12px; color: var(--work-text); background: var(--work-surface); box-shadow: 0 22px 70px rgb(20 24 32 / .22); font-family: var(--work-font); }
.dsh-work-legacy-deliverable-frame header { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 16px 18px; border-bottom: 1px solid var(--work-border); }
.dsh-work-legacy-deliverable-frame header div { min-width: 0; }
.dsh-work-legacy-deliverable-frame header strong, .dsh-work-legacy-deliverable-frame header span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-work-legacy-deliverable-frame header strong { font-size: 15px; line-height: 22px; }
.dsh-work-legacy-deliverable-frame header span { margin-top: 2px; color: var(--work-muted); font-size: 12px; line-height: 18px; }
.dsh-work-legacy-deliverable-frame button { height: 32px; padding: 0 12px; border: 1px solid var(--work-border-strong); border-radius: 7px; color: var(--work-text); background: var(--work-surface); cursor: pointer; font: 550 12px/1 var(--work-font); }
.dsh-work-legacy-deliverable-frame pre { min-height: 160px; margin: 0; overflow: auto; padding: 20px; white-space: pre-wrap; overflow-wrap: anywhere; font: 400 13px/21px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.dsh-work-legacy-deliverable-loading { min-height: 160px; display: grid; place-items: center; margin: 0; color: var(--work-muted); font-size: 13px; }
.dsh-work-legacy-deliverable-frame footer { display: flex; justify-content: flex-end; padding: 12px 18px; border-top: 1px solid var(--work-border); }
.dsh-work-session-resource { position: relative; display: inline-flex; align-items: center; font-family: var(--work-font); }
.dsh-work-session-resource-trigger { height: 30px; display: inline-flex; align-items: center; gap: 5px; padding: 0 8px; border: 0; border-radius: 7px; color: var(--work-muted); background: transparent; cursor: pointer; font: 500 12px/1 var(--work-font); }
.dsh-work-session-resource-trigger span { font-size: 17px; line-height: 1; }
.dsh-work-session-resource-trigger:hover:not(:disabled), .dsh-work-session-resource.is-drop-active .dsh-work-session-resource-trigger { color: var(--work-accent); background: var(--work-accent-subtle); }
.dsh-work-session-resource-trigger:disabled { opacity: .45; cursor: default; }
.dsh-work-session-resource-popover { position: absolute; left: 0; bottom: 38px; z-index: 20; width: min(360px, calc(100vw - 40px)); display: grid; gap: 5px; padding: 8px; border: 1px solid var(--work-border); border-radius: 10px; color: var(--work-text); background: var(--work-surface); box-shadow: var(--work-shadow); }
.dsh-work-session-resource-row { min-width: 0; display: flex; align-items: center; gap: 8px; padding: 7px; border-radius: 7px; background: var(--work-surface-subtle); }
.dsh-work-session-resource-row.is-failed { color: var(--work-danger); }
.dsh-work-session-resource-icon { width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; flex: none; border-radius: 6px; color: var(--work-accent); background: var(--work-accent-subtle); font-size: 10px; font-weight: 700; }
.dsh-work-session-resource-copy { min-width: 0; flex: 1; }
.dsh-work-session-resource-copy strong, .dsh-work-session-resource-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-work-session-resource-copy strong { font-size: 12px; line-height: 17px; }
.dsh-work-session-resource-copy small { color: var(--work-faint); font-size: 10px; line-height: 15px; }
.dsh-work-session-resource-row.is-failed small { color: var(--work-danger); }
.dsh-work-session-resource-row > button { flex: none; padding: 3px 6px; border: 0; border-radius: 5px; color: var(--work-muted); background: transparent; cursor: pointer; font: 500 11px/1 var(--work-font); }
.dsh-work-session-resource-row > button:hover { color: var(--work-text); background: var(--work-border); }
.dsh-work-sidebar { height: 100%; min-width: 0; display: flex; flex-direction: column; padding: 16px 20px; background: var(--work-sidebar); }
.dsh-work-sidebar.is-collapsed { align-items: center; padding: 18px 10px; gap: 18px; }
.dsh-work-sidebar-brand { height: 36px; display: flex; align-items: center; gap: 10px; font-size: 19px; letter-spacing: -.02em; }
.dsh-work-sidebar-mark { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; flex: none; border-radius: 8px; background: var(--work-accent); color: white; font-size: 15px; font-weight: 750; }
.dsh-work-sidebar-create, .dsh-work-sidebar-create-compact { border: 0; background: var(--work-accent); color: white; cursor: pointer; font: 600 14px/20px var(--work-font); }
.dsh-work-sidebar-create { width: 100%; height: 44px; display: flex; align-items: center; justify-content: center; gap: 8px; margin: 18px 0 20px; border-radius: 10px; }
.dsh-work-sidebar-create-compact { width: 36px; height: 36px; border-radius: 10px; font-size: 20px; }
.dsh-work-sidebar-create:hover, .dsh-work-sidebar-create-compact:hover { background: var(--work-accent-hover); }
.dsh-work-sidebar-nav { display: grid; gap: 4px; }
.dsh-work-sidebar-row { width: 100%; height: 40px; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; border: 0; border-radius: 10px; background: transparent; color: var(--work-muted); cursor: pointer; font: 500 14px/20px var(--work-font); }
.dsh-work-sidebar-row:hover { color: var(--work-text); background: color-mix(in srgb, var(--work-surface) 58%, transparent); }
.dsh-work-sidebar-row.is-selected { color: var(--work-accent); background: var(--work-accent-subtle); }
.dsh-work-sidebar-count { font-size: 12px; color: inherit; }
.dsh-work-sidebar-section { min-height: 0; flex: 1; margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--work-border); }
.dsh-work-sidebar-heading { margin: 0 8px 10px; color: var(--work-muted); font-size: 12px; line-height: 18px; }
.dsh-work-sidebar-work { width: 100%; display: grid; gap: 4px; padding: 10px 8px; border: 0; border-radius: 10px; background: transparent; color: var(--work-text); text-align: left; cursor: pointer; }
.dsh-work-sidebar-work:hover { background: color-mix(in srgb, var(--work-surface) 58%, transparent); }
.dsh-work-sidebar-work strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; line-height: 18px; }
.dsh-work-sidebar-work span, .dsh-work-sidebar-empty { margin: 0; color: var(--work-faint); font-size: 12px; line-height: 18px; }
.dsh-work-sidebar-skeleton { height: 52px; border-radius: 10px; background: var(--work-border); animation: dsh-work-pulse 1.3s ease-in-out infinite; }
.dsh-work-sidebar-foot { display: flex; align-items: center; gap: 8px; min-height: 34px; padding: 8px; color: var(--work-muted); border-top: 1px solid var(--work-border); font-size: 12px; }
.dsh-work-runtime-indicator, .dsh-work-runtime > span { width: 8px; height: 8px; border-radius: 50%; background: var(--work-success); }
.dsh-work-home { height: 100%; min-width: 0; display: flex; flex-direction: column; background: var(--work-bg); }
.dsh-work-topbar { height: 64px; display: flex; align-items: center; justify-content: space-between; flex: none; padding: 0 40px; border-bottom: 1px solid var(--work-border); background: var(--work-surface); }
.dsh-work-topbar h1 { margin: 0; font-size: 24px; line-height: 32px; font-weight: 650; letter-spacing: -.025em; }
.dsh-work-runtime { display: flex; align-items: center; gap: 8px; color: var(--work-muted); font-size: 13px; }
.dsh-work-home-scroll { min-height: 0; flex: 1; overflow: auto; }
.dsh-work-home-content { width: min(1120px, calc(100% - 80px)); margin: 0 auto; padding: 32px 0 44px; }
.dsh-work-composer { min-height: 286px; padding: 28px; border: 1px solid var(--work-border); border-radius: 14px; background: var(--work-surface); box-shadow: var(--work-shadow); }
.dsh-work-composer-heading h2 { margin: 0; font-size: 28px; line-height: 36px; font-weight: 650; letter-spacing: -.03em; }
.dsh-work-composer-heading p { margin: 6px 0 16px; color: var(--work-muted); font-size: 14px; line-height: 22px; }
.dsh-work-markdown-preview { margin: 0 0 14px; overflow: hidden; border: 1px solid var(--work-border); border-radius: 10px; background: var(--work-surface-subtle); }
.dsh-work-markdown-preview-heading { min-height: 38px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 8px 12px; border-bottom: 1px solid var(--work-border); background: var(--work-surface); }
.dsh-work-markdown-preview-heading strong { font-size: 12px; line-height: 18px; }
.dsh-work-markdown-preview-heading span { overflow: hidden; color: var(--work-faint); text-overflow: ellipsis; white-space: nowrap; font-size: 11px; line-height: 16px; }
.dsh-work-markdown-preview pre { max-height: 320px; margin: 0; overflow: auto; padding: 16px; color: var(--work-text); white-space: pre-wrap; overflow-wrap: anywhere; font: 400 13px/21px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.dsh-work-markdown-loading { min-height: 96px; display: flex; align-items: center; justify-content: center; color: var(--work-faint); font-size: 12px; }
.dsh-work-composer textarea { width: 100%; height: 118px; resize: none; padding: 14px 16px; border: 1px solid var(--work-border-strong); border-radius: 10px; outline: none; color: var(--work-text); background: var(--work-surface); font: 400 15px/24px var(--work-font); }
.dsh-work-composer textarea::placeholder { color: var(--work-faint); }
.dsh-work-composer textarea:focus { border-color: var(--work-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--work-accent) 22%, transparent); }
.dsh-work-composer textarea:disabled { opacity: .72; }
.dsh-work-resource-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.dsh-work-resource-chip { min-width: 0; max-width: 100%; height: 30px; display: inline-flex; align-items: center; gap: 6px; padding: 0 9px; border: 1px solid var(--work-border); border-radius: 8px; color: var(--work-text); background: var(--work-surface-subtle); font-size: 12px; line-height: 18px; }
.dsh-work-resource-chip > span { width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; flex: none; border-radius: 5px; color: var(--work-accent); background: var(--work-accent-subtle); font-size: 10px; font-weight: 700; }
.dsh-work-resource-chip small { overflow: hidden; color: var(--work-faint); text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
.dsh-work-resource-chip.is-pending { border-color: color-mix(in srgb, var(--work-accent) 28%, var(--work-border)); }
.dsh-work-resource-chip button { width: 20px; height: 20px; padding: 0; border: 0; border-radius: 5px; color: var(--work-muted); background: transparent; cursor: pointer; font: 400 16px/18px var(--work-font); }
.dsh-work-resource-chip button:hover:not(:disabled) { color: var(--work-text); background: var(--work-border); }
.dsh-work-inline-error { margin: 8px 0 -4px; color: var(--work-danger); font-size: 12px; line-height: 18px; }
.dsh-work-import { margin-top: 16px; padding: 16px; border: 1px solid var(--work-border); border-radius: 10px; background: var(--work-surface-subtle); }
.dsh-work-import-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.dsh-work-import-heading h3 { margin: 0; font-size: 15px; line-height: 22px; font-weight: 650; }
.dsh-work-import-heading p { margin: 3px 0 0; color: var(--work-muted); font-size: 12px; line-height: 18px; }
.dsh-work-import-close { width: 28px; height: 28px; flex: none; border: 0; border-radius: 7px; color: var(--work-muted); background: transparent; cursor: pointer; font: 400 20px/24px var(--work-font); }
.dsh-work-import-close:hover { color: var(--work-text); background: var(--work-border); }
.dsh-work-import-fields { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 12px; margin-top: 14px; }
.dsh-work-import label { display: grid; gap: 6px; color: var(--work-muted); font-size: 12px; line-height: 18px; }
.dsh-work-import input, .dsh-work-import select { width: 100%; height: 38px; padding: 0 10px; border: 1px solid var(--work-border-strong); border-radius: 8px; outline: none; color: var(--work-text); background: var(--work-surface); font: 400 13px/18px var(--work-font); }
.dsh-work-import input:focus, .dsh-work-import select:focus { border-color: var(--work-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--work-accent) 22%, transparent); }
.dsh-work-import-content { margin-top: 12px; }
.dsh-work-composer .dsh-work-import-content textarea { height: 104px; background: var(--work-surface); font-size: 13px; line-height: 20px; }
.dsh-work-import-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 12px; }
.dsh-work-import-actions small { color: var(--work-faint); font-size: 11px; line-height: 16px; }
.dsh-work-import-submit { min-width: 150px; height: 36px; padding: 0 14px; border: 0; border-radius: 9px; color: white; background: var(--work-accent); cursor: pointer; font: 600 13px/18px var(--work-font); }
.dsh-work-import-submit:hover:not(:disabled) { background: var(--work-accent-hover); }
.dsh-work-import-submit:disabled { opacity: .42; cursor: default; }
.dsh-work-composer-actions { min-height: 40px; display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 16px; }
.dsh-work-secondary-actions { min-width: 0; display: flex; align-items: center; gap: 12px; }
.dsh-work-resource-entry { min-width: 0; display: flex; align-items: center; gap: 12px; }
.dsh-work-file-input { position: fixed; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); opacity: 0; pointer-events: none; }
.dsh-work-resource-menu { position: relative; flex: none; }
.dsh-work-resource-trigger { min-width: 104px; height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 0 12px; border: 1px solid var(--work-border); border-radius: 9px; color: var(--work-muted); background: var(--work-surface); cursor: pointer; list-style: none; user-select: none; font: 550 13px/18px var(--work-font); }
.dsh-work-resource-trigger::-webkit-details-marker { display: none; }
.dsh-work-resource-trigger:hover { color: var(--work-text); border-color: var(--work-border-strong); background: var(--work-surface-subtle); }
.dsh-work-resource-plus { color: var(--work-accent); font-size: 17px; font-weight: 500; }
.dsh-work-resource-chevron { margin-left: 1px; color: var(--work-faint); font-size: 13px; transition: transform 150ms ease; }
.dsh-work-resource-menu[open] .dsh-work-resource-trigger { color: var(--work-text); border-color: var(--work-border-strong); background: var(--work-surface-subtle); }
.dsh-work-resource-menu[open] .dsh-work-resource-chevron { transform: rotate(180deg); }
.dsh-work-resource-popover { position: absolute; z-index: 10; bottom: calc(100% + 8px); left: 0; width: 240px; display: grid; padding: 6px; border: 1px solid var(--work-border); border-radius: 10px; background: var(--work-surface); box-shadow: 0 14px 32px rgba(35, 50, 76, .14); }
.dsh-work-resource-item { width: 100%; height: 44px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 10px; border: 0; border-radius: 7px; color: var(--work-text); background: transparent; text-align: left; cursor: pointer; font: 550 13px/20px var(--work-font); }
.dsh-work-resource-item:disabled { opacity: 1; cursor: default; }
.dsh-work-resource-item:hover { background: var(--work-surface-subtle); }
.dsh-work-resource-item span { color: var(--work-faint); font: 400 11px/16px var(--work-font); }
.dsh-work-resource-help { min-width: 0; overflow: hidden; color: var(--work-faint); font-size: 12px; line-height: 18px; text-overflow: ellipsis; white-space: nowrap; }
.dsh-work-import-trigger { height: 36px; padding: 0 12px; border: 0; border-left: 1px solid var(--work-border); color: var(--work-accent); background: transparent; cursor: pointer; white-space: nowrap; font: 550 13px/18px var(--work-font); }
.dsh-work-import-trigger:hover:not(:disabled) { color: var(--work-accent-hover); }
.dsh-work-import-trigger:disabled { opacity: .42; cursor: default; }
.dsh-work-primary { min-width: 112px; height: 40px; padding: 0 18px; border: 0; border-radius: 10px; color: white; background: var(--work-accent); cursor: pointer; white-space: nowrap; font: 600 14px/20px var(--work-font); }
.dsh-work-primary:hover:not(:disabled) { background: var(--work-accent-hover); }
.dsh-work-primary:disabled { opacity: .42; cursor: default; }
.dsh-work-primary:active:not(:disabled), .dsh-work-shortcut:active:not(:disabled), .dsh-work-sidebar-create:active { transform: translateY(1px); }
.dsh-work-deliverable-card { min-height: 72px; display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; align-items: center; gap: 12px; margin-top: 16px; padding: 14px 16px; border: 1px solid var(--work-border); border-radius: 12px; background: var(--work-surface); box-shadow: var(--work-shadow); }
.dsh-work-deliverable-token { width: 40px; height: 40px; display: inline-flex; align-items: center; justify-content: center; border-radius: 10px; color: var(--work-accent); background: var(--work-accent-subtle); font-size: 11px; font-weight: 750; }
.dsh-work-deliverable-card strong, .dsh-work-deliverable-card div > span { display: block; min-width: 0; }
.dsh-work-deliverable-card strong { font-size: 14px; line-height: 20px; }
.dsh-work-deliverable-card div > span { margin-top: 2px; overflow: hidden; color: var(--work-muted); text-overflow: ellipsis; white-space: nowrap; font-size: 12px; line-height: 18px; }
.dsh-work-deliverable-actions { display: flex; align-items: center; gap: 10px; }
.dsh-work-deliverable-actions .dsh-work-status { margin: 0; }
.dsh-work-deliverable-actions button { height: 34px; padding: 0 12px; border: 1px solid var(--work-border-strong); border-radius: 8px; color: var(--work-accent); background: var(--work-surface); cursor: pointer; white-space: nowrap; font: 600 12px/18px var(--work-font); }
.dsh-work-deliverable-actions button:hover:not(:disabled) { border-color: var(--work-accent); background: var(--work-accent-subtle); }
.dsh-work-deliverable-actions button:disabled { opacity: .5; cursor: default; }
.dsh-work-shortcuts { margin-top: 28px; }
.dsh-work-shortcuts h2, .dsh-work-section-heading h2 { margin: 0 0 12px; font-size: 18px; line-height: 26px; font-weight: 650; letter-spacing: -.015em; }
.dsh-work-shortcut-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.dsh-work-shortcut { min-width: 0; height: 88px; display: grid; grid-template-columns: 38px minmax(0, 1fr); align-items: center; gap: 12px; padding: 16px; border: 1px solid var(--work-border); border-radius: 12px; color: var(--work-text); background: var(--work-surface); text-align: left; cursor: pointer; }
.dsh-work-shortcut:hover:not(:disabled) { border-color: var(--work-border-strong); background: var(--work-surface-subtle); }
.dsh-work-shortcut-token, .dsh-work-file-token { display: inline-flex; align-items: center; justify-content: center; flex: none; border-radius: 9px; color: var(--work-accent); background: var(--work-accent-subtle); font-weight: 700; }
.dsh-work-shortcut-token { width: 38px; height: 38px; font-size: 14px; }
.dsh-work-shortcut strong, .dsh-work-shortcut small { display: block; min-width: 0; }
.dsh-work-shortcut strong { font-size: 15px; line-height: 22px; font-weight: 600; }
.dsh-work-shortcut small { margin-top: 3px; overflow: hidden; color: var(--work-muted); font-size: 12px; line-height: 18px; text-overflow: ellipsis; white-space: nowrap; }
.dsh-work-recent { margin-top: 32px; }
.dsh-work-section-heading { display: flex; align-items: baseline; justify-content: space-between; }
.dsh-work-section-heading span { color: var(--work-faint); font-size: 12px; }
.dsh-work-list { border-top: 1px solid var(--work-border); }
.dsh-work-list-head, .dsh-work-row { display: grid; grid-template-columns: minmax(320px, 1fr) 120px 140px; align-items: center; column-gap: 20px; }
.dsh-work-list-head { height: 36px; color: var(--work-faint); font-size: 12px; }
.dsh-work-row { min-height: 58px; border-bottom: 1px solid var(--work-border); }
.dsh-work-row-main { min-width: 0; display: flex; align-items: center; gap: 12px; }
.dsh-work-file-token { width: 30px; height: 30px; font-size: 12px; }
.dsh-work-row-main > div { min-width: 0; }
.dsh-work-row-main strong, .dsh-work-row-main span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-work-row-main strong { font-size: 14px; line-height: 20px; font-weight: 600; }
.dsh-work-row-main span { color: var(--work-muted); font-size: 12px; line-height: 18px; }
.dsh-work-status { width: fit-content; padding: 3px 8px; border-radius: 7px; font-size: 12px; line-height: 18px; }
.dsh-work-status.is-accent { color: var(--work-accent); background: var(--work-accent-subtle); }
.dsh-work-status.is-warning { color: var(--work-warning); background: color-mix(in srgb, var(--work-warning) 12%, transparent); }
.dsh-work-status.is-success { color: var(--work-success); background: color-mix(in srgb, var(--work-success) 12%, transparent); }
.dsh-work-status.is-danger { color: var(--work-danger); background: color-mix(in srgb, var(--work-danger) 12%, transparent); }
.dsh-work-status.is-neutral { color: var(--work-muted); background: var(--work-surface-subtle); }
.dsh-work-progress, .dsh-work-list-empty { color: var(--work-muted); font-size: 12px; line-height: 18px; }
.dsh-work-list-empty { margin: 0; padding: 24px 0; border-top: 1px solid var(--work-border); }
.dsh-work-home-loading { width: min(1120px, calc(100% - 80px)); margin: 0 auto; padding-top: 34px; }
.dsh-work-skeleton { border-radius: 12px; background: var(--work-border); animation: dsh-work-pulse 1.3s ease-in-out infinite; }
.dsh-work-skeleton.is-title { width: 120px; height: 32px; }
.dsh-work-skeleton.is-composer { height: 286px; margin-top: 22px; }
.dsh-work-skeleton.is-row { height: 58px; margin-top: 148px; }
.dsh-work-visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.dsh-work-home button:focus-visible, .dsh-work-sidebar button:focus-visible { outline: 2px solid var(--work-accent); outline-offset: 2px; }
@keyframes dsh-work-pulse { 0%, 100% { opacity: .48; } 50% { opacity: .82; } }
@media (max-width: 1180px) {
  .dsh-work-topbar { padding: 0 32px; }
  .dsh-work-home-content, .dsh-work-home-loading { width: calc(100% - 64px); }
  .dsh-work-shortcut-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 760px) {
  .dsh-work-topbar { padding: 0 24px; }
  .dsh-work-home-content, .dsh-work-home-loading { width: calc(100% - 48px); padding-top: 24px; }
  .dsh-work-composer { padding: 20px; }
  .dsh-work-composer-actions { align-items: stretch; flex-direction: column; }
  .dsh-work-secondary-actions { align-items: flex-start; flex-direction: column; }
  .dsh-work-import-fields { grid-template-columns: 1fr; }
  .dsh-work-import-actions { align-items: stretch; flex-direction: column; }
  .dsh-work-import-submit { width: 100%; }
  .dsh-work-resource-entry { flex-wrap: wrap; }
  .dsh-work-resource-popover { width: min(240px, calc(100vw - 48px)); }
  .dsh-work-primary { width: 100%; }
  .dsh-work-shortcut-grid { grid-template-columns: 1fr; }
  .dsh-work-list-head { display: none; }
  .dsh-work-row { grid-template-columns: 1fr auto; gap: 12px; padding: 10px 0; }
  .dsh-work-progress { grid-column: 1 / -1; padding-left: 42px; }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-work-sidebar *, .dsh-work-home * { transition: none !important; animation: none !important; }
}
`

function installStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  const selector = 'style[data-plugin-css="@dsh-work/work-api/home"]'
  if (document.querySelector(selector)) return () => {}
  const tag = document.createElement('style')
  tag.dataset.plugin = '@dsh-work/work-api'
  tag.dataset.pluginCss = '@dsh-work/work-api/home'
  tag.textContent = styles
  document.head.appendChild(tag)
  return () => tag.remove()
}

export function registerWorkSurface(ctx: Context, works: IWorks): () => void {
  const removeStyles = installStyles()
  const preview = createSessionOutputPreviewStore()
  let removePreview: (() => void) | null = null
  const releasePreview = (): void => {
    removePreview?.()
    removePreview = null
    preview.clear()
  }
  const closePreview = (): void => {
    const selected = preview.getSnapshot()
    ctx.layout.closeDetails()
    releasePreview()
    if (selected) {
      requestAnimationFrame(() => {
        const rows = document.querySelectorAll<HTMLElement>(
          `[data-work-session-output-turn="${String(selected.turn)}"] [data-work-session-output]`,
        )
        Array.from(rows).find(row => row.dataset.workSessionOutput === selected.path)?.focus()
      })
    }
  }
  const handOverToNativeToolSurface = (event: Event): void => {
    if (!preview.getSnapshot() || !(event.target instanceof Element)) return
    const call = event.target.closest<HTMLElement>('[data-chat-call-id]')
    const callId = call?.dataset.chatCallId
    if (!callId) return
    requestAnimationFrame(() => {
      const matching = Array.from(document.querySelectorAll<HTMLElement>('[data-chat-call-id]'))
        .find(candidate => candidate.dataset.chatCallId === callId)
      if (!matching || matching.hasAttribute('data-selected')) releasePreview()
    })
  }
  const selectOutput = (event: Event): void => {
    if (!(event instanceof CustomEvent) || typeof event.detail !== 'object' || !event.detail) return
    const detail = event.detail as Partial<SessionOutputPreviewDetail>
    const open = (event as Partial<SessionOutputSelectionEvent>)[SESSION_OUTPUT_OPEN]
    if (typeof detail.sessionId !== 'string'
      || typeof detail.name !== 'string'
      || typeof detail.path !== 'string'
      || !Number.isSafeInteger(detail.turn)
      || !Number.isSafeInteger(detail.throughSeq)
      || !Number.isSafeInteger(detail.bytes)
      || detail.bytes! < 1
      || (typeof detail.mediaType !== 'string' && detail.mediaType !== null)
      || typeof open !== 'function') return
    event.preventDefault()
    preview.select(Object.freeze({ ...detail, open } as SessionOutputPreviewSelection))
    removePreview ??= ctx.slots.register({
      name: 'details',
      priority: -100,
      inject: () => ({ works, preview, closePreview }),
    }, NativeSessionOutputPreview)
    requestAnimationFrame(() => ctx.layout.openDetails())
  }
  window.addEventListener('dsh-work:select-session-output', selectOutput)
  window.addEventListener('click', handOverToNativeToolSurface)
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({
    name: 'sidebar.brand.name',
    priority: -100,
  }, () => h('span', { 'data-dsh-work-brand': 'name' }, 'DSH Work')))
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'dsh-work-session-resource',
    order: -100,
    label: '添加资料',
    inject: () => ({ works }),
  }, NativeSessionResourceEntry))
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    priority: -100,
    select: (owner: SessionOutputsOwner) => Object.freeze({
      turn: owner.turn.turn,
      throughSeq: owner.seq,
    }),
    inject: () => ({ works }),
  }, NativeSessionOutputs))
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({
    name: 'sidebar.brand.mark',
    priority: -100,
  }, () => h('span', {
    className: 'dsh-work-native-brand-mark',
    'data-dsh-work-brand': 'mark',
    'aria-hidden': 'true',
  }, 'W')))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'dsh-work-legacy-deliverable-open',
    label: '旧成果',
    inject: () => ({ works }),
  }, LegacyDeliverableAction))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'dsh-work-legacy-deliverable-surface',
    order: 100,
    label: '旧成果',
    inject: () => ({ works }),
  }, LegacyDeliverableOverlay))
  return () => {
    window.removeEventListener('dsh-work:select-session-output', selectOutput)
    window.removeEventListener('click', handOverToNativeToolSurface)
    removePreview?.()
    preview.clear()
    removeStyles()
  }
}
