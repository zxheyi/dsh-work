import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { WORK_WHALE_DATA_URL } from './brand-assets.ts'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { UseSidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

import type { IWorks, WorkClientSnapshot } from './client-model.ts'
import type {
  WorkSessionOutputContent,
  WorkSessionOutputFile,
  WorkSessionOutputSource,
  WorkSessionOutputRevisionFailure,
  WorkSessionOutputSave,
  WorkSessionOutputVersion,
  WorkSessionOutputVersionContent,
  WorkSaveSessionOutputSpec,
} from './index.ts'
import type { WorkDeliverableContent } from './index.ts'
import {
  MAX_RECOVERY_REVISION_LEASES,
  mergeWorkRecoveryRevisionLease,
  matchesWorkRecoveryOutput,
  parseWorkRecoveryContext,
  recoverySessionDisposition,
  recoveredDraftForSession,
  serializeWorkRecoveryContext,
  workRecoveryRevisionLeaseForTurn,
  type WorkRecoveryContext,
  type WorkRecoveryOutputSelection,
} from './recovery-context.ts'
import { planTextDiff, type TextDiffPlan } from './text-diff.ts'

interface WorkSurfaceInjected {
  readonly works: IWorks
}

interface WorkSessionNavigationContext {
  readonly sessions: {
    readonly list: {
      readonly getSnapshot: () => {
        readonly current: string | undefined
        readonly byId: Readonly<Record<string, unknown>>
        readonly phase: 'pending' | 'ready'
      }
      readonly subscribe: (listener: () => void) => () => void
    }
    readonly open: (sessionId: string) => void
    readonly scope: (sessionId: string) => NativeReferenceScope | undefined
  }
}

const h = createElement
const NARROW_PREVIEW_QUERY = '(max-width: 995px)'

const narrowPreviewSnapshot = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia(NARROW_PREVIEW_QUERY).matches

const subscribeNarrowPreview = (listener: () => void): (() => void) => {
  const query = window.matchMedia(NARROW_PREVIEW_QUERY)
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

interface NativeReferenceRequest {
  readonly reference: { readonly source: string; readonly ref: string; readonly label: string; readonly appearance: 'file'; readonly clipboardText: string }
  readonly span: { readonly start: number; readonly end: number; readonly draftRev: number }
}
interface NativeReferenceScope {
  bail(scope: NativeReferenceScope, event: 'slash/input-insert-reference', request: NativeReferenceRequest): unknown
}
interface NativeResourceInput {
  readonly draft: string
  readonly phase: string
  readonly draftRev: number
  readonly occurrences: readonly { readonly offset: number; readonly length: number }[]
}
interface NativeSessionResourceProps extends WorkSurfaceInjected {
  readonly session: { readonly sessionId: string }
  readonly input: NativeResourceInput
  readonly insertResourceReference: (request: NativeReferenceRequest) => boolean
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
  readonly revisionLease?: Omit<WorkRecoveryContext['revisionLeases'][number], 'sessionId'> | null
  readonly reportRecoveryPersistence?: (persisted: boolean) => void
  readonly base?: {
    readonly path: string
    readonly ordinal: number
    readonly intent?: 'restore'
  }
}

interface SessionOutputPreviewSelection extends WorkSessionOutputFile {
  readonly throughSeq: number
  readonly open: () => void
}

export interface SessionOutputSaveTarget {
  readonly spec: WorkSaveSessionOutputSpec
  readonly ordinal: number | null
}

export function sessionOutputSaveTarget(
  selection: Pick<SessionOutputPreviewSelection, 'sessionId' | 'turn' | 'throughSeq' | 'path'>,
  version: Pick<WorkSessionOutputVersion, 'fileId' | 'versionId' | 'ordinal'> | null,
  retry?: SessionOutputSaveTarget,
): SessionOutputSaveTarget {
  if (retry) return retry
  return Object.freeze({
    spec: Object.freeze({
      sessionId: selection.sessionId,
      turn: selection.turn,
      throughSeq: selection.throughSeq,
      path: selection.path,
      ...(version ? { version: Object.freeze({
        fileId: version.fileId,
        versionId: version.versionId,
      }) } : {}),
    }),
    ordinal: version?.ordinal ?? null,
  })
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

export function matchesSessionOutputSelection(
  current: SessionOutputPreviewSelection | null,
  expected: SessionOutputPreviewSelection,
): boolean {
  return current?.sessionId === expected.sessionId
    && current.turn === expected.turn
    && current.throughSeq === expected.throughSeq
    && current.path === expected.path
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

const sessionResourceDrafts = new Map<string, string>()
const MAX_STRUCTURED_MARKDOWN_NODES = 2_000
let activeRecoveryContext: WorkRecoveryContext | null = null
let pendingRecoverySession: string | null = null
let pendingRecoveryDraft: Pick<WorkRecoveryContext, 'sessionId' | 'draft'> | null = null
let pendingRecoverySelection: WorkRecoveryOutputSelection | null = null

function clearRecoveryContext(): void {
  activeRecoveryContext = null
  pendingRecoverySession = null
  pendingRecoveryDraft = null
  pendingRecoverySelection = null
  window.name = ''
  window.dshWorkRecovery?.update('')
}

function publishRecoveryContext(
  sessionId: string,
  draft: string,
  selection: WorkRecoveryOutputSelection | null = activeRecoveryContext?.sessionId === sessionId
    ? activeRecoveryContext.selection
    : null,
  revisionLease: Omit<WorkRecoveryContext['revisionLeases'][number], 'sessionId'> | null | undefined = undefined,
): boolean {
  if (pendingRecoverySession && pendingRecoverySession !== sessionId) return false
  if (!pendingRecoverySession && pendingRecoverySelection?.sessionId !== sessionId) {
    pendingRecoverySelection = null
  }
  const retainedLeases = activeRecoveryContext?.revisionLeases ?? Object.freeze([])
  const retainedLease = retainedLeases.find(lease => lease.sessionId === sessionId)
  const revisionLeases = revisionLease === undefined
    ? retainedLeases
    : revisionLease === null
      ? Object.freeze(retainedLeases.filter(lease => lease.sessionId !== sessionId))
      : Object.freeze([
          ...retainedLeases.filter(lease => lease.sessionId !== sessionId),
          mergeWorkRecoveryRevisionLease(sessionId, retainedLease, revisionLease),
        ])
  const context: WorkRecoveryContext = Object.freeze({
    schema: 'dsh-work.recovery-context.v1',
    sessionId,
    draft,
    selection,
    revisionLeases,
  })
  const reservedContext: WorkRecoveryContext = Object.freeze({
    ...context,
    revisionLeases: Object.freeze(revisionLeases.map(lease => lease.rejected
      ? lease
      : Object.freeze({
          ...lease,
          rejected: Object.freeze({
            turn: Number.MAX_SAFE_INTEGER,
            leaseId: 'f'.repeat(32),
            expectedContentDigest: 'f'.repeat(64),
          }),
        }))),
  })
  if (revisionLeases.length > 0 && !serializeWorkRecoveryContext(reservedContext)) return false
  const serialized = serializeWorkRecoveryContext(context)
  if (!serialized) {
    if (revisionLeases.length > 0) return false
    clearRecoveryContext()
    return false
  }
  activeRecoveryContext = context
  window.name = serialized
  window.dshWorkRecovery?.update(serialized)
  return true
}

function markRecoveryRevisionConflict(
  sessionId: string,
  turn: number,
  lease: Pick<WorkRecoveryContext['revisionLeases'][number], 'leaseId' | 'expectedContentDigest'>,
): void {
  const retained = activeRecoveryContext?.revisionLeases.find(candidate => candidate.sessionId === sessionId)
  if (!retained) return
  publishRecoveryContext(
    sessionId,
    activeRecoveryContext!.draft,
    activeRecoveryContext!.selection,
    Object.freeze({
      preparedAfterTurn: retained.preparedAfterTurn,
      leaseId: retained.leaseId,
      expectedContentDigest: retained.expectedContentDigest,
      path: retained.path,
      rejected: Object.freeze({
        turn,
        leaseId: lease.leaseId,
        expectedContentDigest: lease.expectedContentDigest,
      }),
    }),
  )
}

function clearRecoveryRevisionLease(sessionId: string): void {
  if (!activeRecoveryContext?.revisionLeases.some(lease => lease.sessionId === sessionId)) return
  publishRecoveryContext(
    sessionId,
    activeRecoveryContext.draft,
    activeRecoveryContext.selection,
    null,
  )
}

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
    failed: (cause: unknown) => void,
  ): Promise<void> {
    const generation = ++this.generation
    try {
      const value = await load()
      if (generation === this.generation) ready(value)
    } catch (cause) {
      if (generation === this.generation) failed(cause)
    }
  }

  invalidate(): void {
    this.generation++
  }
}

function useWorks(works: IWorks): WorkClientSnapshot {
  const subscribe = useCallback((listener: () => void) => works.list.subscribe(listener), [works])
  const getSnapshot = useCallback(() => works.list.getSnapshot(), [works])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function resourceMention(resourcePath: string): string {
  return /\s/u.test(resourcePath) ? `@"${resourcePath}"` : `@${resourcePath}`
}

export function nextSessionResourceReference(input: NativeResourceInput): NativeReferenceRequest | null {
  if (input.phase !== 'plain') return null
  const mentions = /@"(attachment-[a-f0-9]{12}-[a-f0-9]{12}-[^"\r\n]+\.(?:md|txt|csv|json))"|@(attachment-[a-f0-9]{12}-[a-f0-9]{12}-[^\s"<>]+\.(?:md|txt|csv|json))(?=\s|$)/giu
  for (const match of input.draft.matchAll(mentions)) {
    const offset = match.index
    if (input.occurrences.some(item => offset >= item.offset && offset < item.offset + item.length)) continue
    const path = match[1] ?? match[2]
    if (!path) continue
    const start = offset - input.occurrences.filter(item => item.offset < offset)
      .reduce((total, item) => total + item.length - 1, 0)
    return {
      reference: {
        source: 'reference', ref: match[0], clipboardText: match[0], appearance: 'file',
        label: path.replace(/^attachment-[a-f0-9]{12}-[a-f0-9]{12}-/iu, ''),
      },
      span: { start, end: start + match[0].length, draftRev: input.draftRev },
    }
  }
  return null
}

function remoteErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null
  const code = Reflect.get(error, 'code')
  return typeof code === 'string' ? code : null
}

// Native Harness owns picking, drag/drop, upload progress, retry and cancellation.
// This dock only restores DWork text/revision references in the native composer.
function NativeSessionResourceEntry({ session, input, inputActions, insertResourceReference }: NativeSessionResourceProps): ReactNode {
  sessionResourceDrafts.set(session.sessionId, input.draft)
  publishRecoveryContext(session.sessionId, input.draft)
  useEffect(() => {
    if (pendingRecoveryDraft?.sessionId !== session.sessionId) return
    const retained = pendingRecoveryDraft
    pendingRecoveryDraft = null
    pendingRecoverySession = null
    const draft = recoveredDraftForSession(retained, session.sessionId, input.draft)
    sessionResourceDrafts.set(session.sessionId, draft)
    publishRecoveryContext(session.sessionId, draft)
    if (draft !== input.draft) inputActions.setDraft(draft)
  }, [input.draft, inputActions, session.sessionId])

  useEffect(() => {
    const reference = nextSessionResourceReference(input)
    if (reference) insertResourceReference(reference)
  }, [input, insertResourceReference])
  useEffect(() => {
    const referenceSource = (event: Event): void => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== 'object' || !event.detail) return
      const detail = event.detail as Partial<SessionResourceReferenceDetail>
      if (detail.sessionId !== session.sessionId || typeof detail.path !== 'string') return
      const mention = resourceMention(detail.path)
      const base = typeof detail.base === 'object' && detail.base
        && typeof detail.base.path === 'string'
        && typeof detail.base.ordinal === 'number'
        && Number.isSafeInteger(detail.base.ordinal)
        && detail.base.ordinal > 0
        ? detail.base
        : null
      const insertion = base
        ? base.intent === 'restore'
          ? `使用 ${resourceMention(base.path)} （v${String(base.ordinal)}）的完整内容恢复 ${mention} ，保持字节一致`
          : `基于 ${resourceMention(base.path)}（v${String(base.ordinal)}）修改 ${mention}`
        : mention
      const current = sessionResourceDrafts.get(session.sessionId) ?? input.draft
      const separator = current.trim().length > 0 ? ' ' : ''
      const next = current.includes(insertion) ? current : `${current}${separator}${insertion} `
      const persisted = publishRecoveryContext(
        session.sessionId,
        next,
        undefined,
        detail.revisionLease,
      )
      detail.reportRecoveryPersistence?.(persisted)
      if (!persisted) return
      if (next === current) return
      sessionResourceDrafts.set(session.sessionId, next)
      inputActions.setDraft(next)
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-composer-input]')?.focus())
    }
    window.addEventListener('dsh-work:reference-session-resource', referenceSource)
    return () => window.removeEventListener('dsh-work:reference-session-resource', referenceSource)
  }, [input.draft, inputActions, session.sessionId])

  return null
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
    const retainedRevisionLease = activeRecoveryContext?.revisionLeases.find(
      lease => lease.sessionId === sessionId,
    )
    const revisionLease = workRecoveryRevisionLeaseForTurn(retainedRevisionLease, matched.turn)
    const spec = {
      sessionId,
      turn: matched.turn,
      throughSeq: matched.throughSeq,
      ...(revisionLease ? { revisionLease } : {}),
    }
    setRevisionFailure(null)
    void works.inspectSessionRevision(spec, abort.signal).then(failure => {
      if (abort.signal.aborted) return
      setRevisionFailure(failure)
      if (failure && revisionLease?.path === failure.path) {
        if (failure.reason === 'conflict') {
          markRecoveryRevisionConflict(sessionId, matched.turn, revisionLease)
        } else clearRecoveryRevisionLease(sessionId)
      }
      return works.inspectSessionOutputs(spec, abort.signal).then(nextFiles => {
        if (!abort.signal.aborted) {
          setFiles(nextFiles)
          if (revisionLease && nextFiles.some(file => file.path === revisionLease.path)) {
            clearRecoveryRevisionLease(sessionId)
          }
        }
      })
    }).catch(cause => {
      if (!abort.signal.aborted) {
        setFiles(Object.freeze([]))
        if (revisionLease && remoteErrorCode(cause) === 'work/session-output-conflict') {
          setRevisionFailure(Object.freeze({
            sessionId,
            turn: matched.turn,
            name: revisionLease.path.split('/').at(-1) ?? revisionLease.path,
            path: revisionLease.path,
            reference: resourceMention(revisionLease.path),
            status: 'failed' as const,
            reason: 'conflict' as const,
            message: '当前文件已被另一会话或外部修改。请刷新内容后明确重试。',
          }))
          markRecoveryRevisionConflict(sessionId, matched.turn, revisionLease)
        }
      }
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

  useEffect(() => {
    const retained = pendingRecoverySelection
    if (!retained || retained.sessionId !== sessionId || retained.turn !== matched.turn
      || retained.throughSeq !== matched.throughSeq) return
    const file = files.find(candidate => matchesWorkRecoveryOutput(retained, {
      sessionId: candidate.sessionId,
      turn: candidate.turn,
      throughSeq: matched.throughSeq,
      name: candidate.name,
      path: candidate.path,
      bytes: candidate.bytes,
      mediaType: candidate.mediaType,
    }))
    if (!file) return
    pendingRecoverySelection = null
    setSelectedPath(file.path)
    const selection = new CustomEvent<SessionOutputPreviewDetail>('dsh-work:select-session-output', {
      cancelable: true,
      detail: Object.freeze({ ...retained }),
    }) as SessionOutputSelectionEvent
    Object.defineProperty(selection, SESSION_OUTPUT_OPEN, { value: () => openFile(file.path) })
    window.dispatchEvent(selection)
  }, [files, matched.throughSeq, matched.turn, openFile, sessionId])

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
  sourcePhase === 'error' ? h('span', {
    className: 'dsh-work-session-sources-error',
    role: 'status',
    'aria-live': 'polite',
  }, '资料来源暂不可用') : null,
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
      publishRecoveryContext(sessionId, sessionResourceDrafts.get(sessionId) ?? '', selection.detail)
      if (window.dispatchEvent(selection)) openFile(file.path)
    },
  },
  h('span', { className: 'dsh-work-session-output-icon', 'aria-hidden': 'true' }, '文'),
  h('span', { className: 'dsh-work-session-output-copy' },
    h('strong', null, file.name),
    h('small', null, outputSize(file.bytes))))))) : null)
}

function safeMarkdownContent(content: Pick<WorkSessionOutputContent, 'content'>): ReactNode {
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

export function sessionOutputVersionSummary(content: string): string {
  let offset = 0
  while (offset <= content.length) {
    const newline = content.indexOf('\n', offset)
    const end = newline < 0 ? content.length : newline
    let start = offset
    while (start < end) {
      const character = content[start]
      if (character !== ' ' && character !== '\t' && character !== '\r') break
      start++
    }
    if (start < end) {
      const sample = content.slice(start, Math.min(end, start + 256))
        .replace(/^#{1,6}\s+/u, '')
        .replace(/^[-*+]\s+/u, '')
        .replace(/^\d+[.)]\s+/u, '')
        .replace(/^>\s*/u, '')
        .trim()
      if (sample.length > 0) return sample.length > 100 ? `${sample.slice(0, 100)}…` : sample
    }
    if (newline < 0) break
    offset = newline + 1
  }
  return '该版本没有可显示的文字摘要'
}

export function matchesSessionOutputVersionSelection(
  selected: Pick<WorkSessionOutputVersion, 'fileId' | 'versionId'> | null,
  content: Pick<WorkSessionOutputVersionContent, 'fileId' | 'versionId'>,
): boolean {
  return selected?.fileId === content.fileId && selected.versionId === content.versionId
}

function sessionOutputVersionTime(createdAt: string): string {
  const instant = new Date(createdAt)
  if (!Number.isFinite(instant.valueOf())) return createdAt
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant).replaceAll('/', '-')
}

function boundedDiffLineLabel(lines: number): string {
  return lines > 2_000 ? '超过 2,000 行' : `${String(lines)} 行`
}

function NativeSessionOutputPreview({
  closePreview,
  preview,
  sessionId,
  works,
}: NativeSessionOutputPreviewProps): ReactNode {
  const closeButton = useRef<HTMLButtonElement>(null)
  const narrow = useSyncExternalStore(subscribeNarrowPreview, narrowPreviewSnapshot, () => false)
  const selection = useSyncExternalStore(preview.subscribe, preview.getSnapshot, preview.getSnapshot)
  const [tab, setTab] = useState<'content' | 'sources' | 'versions'>('content')
  const [retry, setRetry] = useState(0)
  const request = useMemo(() => new LatestPreviewRequest(), [])
  const versionRequest = useMemo(() => new LatestPreviewRequest(), [])
  const compareRequest = useMemo(() => new LatestPreviewRequest(), [])
  const revisionRequest = useMemo(() => new LatestPreviewRequest(), [])
  const adoptionRequest = useMemo(() => new LatestPreviewRequest(), [])
  const revisionAbort = useRef<AbortController | null>(null)
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
  const [versionState, setVersionState] = useState<
    | { readonly phase: 'idle' | 'loading' | 'error' }
    | { readonly phase: 'ready'; readonly versions: readonly WorkSessionOutputVersion[] }
  >({ phase: 'idle' })
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [versionContentState, setVersionContentState] = useState<
    | { readonly phase: 'idle' | 'loading' | 'error' }
    | { readonly phase: 'ready'; readonly content: WorkSessionOutputVersionContent }
  >({ phase: 'idle' })
  const [compareFromId, setCompareFromId] = useState<string | null>(null)
  const [compareToId, setCompareToId] = useState<string | null>(null)
  const [compareState, setCompareState] = useState<
    | { readonly phase: 'idle' | 'loading' | 'error' }
    | {
      readonly phase: 'ready'
      readonly fromVersionId: string
      readonly toVersionId: string
      readonly plan: TextDiffPlan
    }
  >({ phase: 'idle' })
  const [versionRetry, setVersionRetry] = useState(0)
  const [revisionPhase, setRevisionPhase] = useState<'idle' | 'preparing' | 'error'>('idle')
  const [revisionError, setRevisionError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<
    | { readonly phase: 'idle' }
    | {
      readonly phase: 'saving' | 'error'
      readonly target: {
        readonly spec: WorkSaveSessionOutputSpec
        readonly ordinal: number | null
      }
    }
    | { readonly phase: 'saved'; readonly value: WorkSessionOutputSave }
  >({ phase: 'idle' })
  const [saveOpenError, setSaveOpenError] = useState(false)
  const [adoptionPhase, setAdoptionPhase] = useState<'idle' | 'adopting' | 'error'>('idle')

  useEffect(() => {
    revisionAbort.current?.abort()
    revisionAbort.current = null
    revisionRequest.invalidate()
    adoptionRequest.invalidate()
    setTab('content')
    setRevisionPhase('idle')
    setRevisionError(null)
    setSaveState({ phase: 'idle' })
    setSaveOpenError(false)
    setAdoptionPhase('idle')
    setVersionState({ phase: 'idle' })
    setSelectedVersionId(null)
    setVersionContentState({ phase: 'idle' })
    setCompareFromId(null)
    setCompareToId(null)
    setCompareState({ phase: 'idle' })
  }, [adoptionRequest, revisionRequest, selection?.path, selection?.sessionId, selection?.throughSeq, selection?.turn])

  useEffect(() => () => revisionAbort.current?.abort(), [])

  useEffect(() => {
    revisionAbort.current?.abort()
    revisionAbort.current = null
    revisionRequest.invalidate()
    adoptionRequest.invalidate()
    setRevisionPhase('idle')
    setRevisionError(null)
    setAdoptionPhase('idle')
  }, [adoptionRequest, revisionRequest, selectedVersionId, tab])

  useEffect(() => {
    if (!selection || !narrow) return
    requestAnimationFrame(() => closeButton.current?.focus())
  }, [narrow, selection])

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
    if (!selection || selection.sessionId !== sessionId) {
      setVersionState({ phase: 'idle' })
      setSelectedVersionId(null)
      return
    }
    if (tab !== 'versions') return
    const abort = new AbortController()
    setVersionState({ phase: 'loading' })
    void works.listSessionOutputVersions({
      sessionId: selection.sessionId,
      path: selection.path,
    }, abort.signal).then(versions => {
      if (abort.signal.aborted) return
      setVersionState({ phase: 'ready', versions })
      setSelectedVersionId(current => versions.some(version => version.versionId === current)
        ? current
        : versions.at(-1)?.versionId ?? null)
      setCompareFromId(current => versions.some(version => version.versionId === current)
        ? current
        : versions.at(-2)?.versionId ?? versions[0]?.versionId ?? null)
      setCompareToId(current => versions.some(version => version.versionId === current)
        ? current
        : versions.at(-1)?.versionId ?? null)
    }).catch(() => {
      if (!abort.signal.aborted) setVersionState({ phase: 'error' })
    })
    return () => abort.abort()
  }, [selection, sessionId, tab, versionRetry, works])

  useEffect(() => {
    if (tab !== 'versions' || versionState.phase !== 'ready' || !selectedVersionId) {
      setVersionContentState({ phase: 'idle' })
      versionRequest.invalidate()
      return
    }
    const selected = versionState.versions.find(version => version.versionId === selectedVersionId)
    if (!selected) {
      setVersionContentState({ phase: 'idle' })
      return
    }
    const abort = new AbortController()
    setVersionContentState({ phase: 'loading' })
    void versionRequest.run(
      () => works.readSessionOutputVersion({
        fileId: selected.fileId,
        versionId: selected.versionId,
      }, abort.signal),
      content => setVersionContentState({ phase: 'ready', content }),
      () => setVersionContentState({ phase: 'error' }),
    )
    return () => {
      versionRequest.invalidate()
      abort.abort()
    }
  }, [selectedVersionId, tab, versionRequest, versionRetry, versionState, works])

  useEffect(() => {
    if (tab !== 'versions' || versionState.phase !== 'ready' || !compareFromId || !compareToId) {
      setCompareState({ phase: 'idle' })
      compareRequest.invalidate()
      return
    }
    const from = versionState.versions.find(version => version.versionId === compareFromId)
    const to = versionState.versions.find(version => version.versionId === compareToId)
    if (!from || !to) {
      setCompareState({ phase: 'idle' })
      return
    }
    const abort = new AbortController()
    setCompareState({ phase: 'loading' })
    void compareRequest.run(
      async () => Promise.all([
        works.readSessionOutputVersion({ fileId: from.fileId, versionId: from.versionId }, abort.signal),
        works.readSessionOutputVersion({ fileId: to.fileId, versionId: to.versionId }, abort.signal),
      ]),
      ([fromContent, toContent]) => {
        if (!matchesSessionOutputVersionSelection(from, fromContent)
          || !matchesSessionOutputVersionSelection(to, toContent)) {
          setCompareState({ phase: 'error' })
          return
        }
        setCompareState({
          phase: 'ready',
          fromVersionId: fromContent.versionId,
          toVersionId: toContent.versionId,
          plan: planTextDiff(fromContent.content, toContent.content),
        })
      },
      () => setCompareState({ phase: 'error' }),
    )
    return () => {
      compareRequest.invalidate()
      abort.abort()
    }
  }, [compareFromId, compareRequest, compareToId, tab, versionState, works])

  useEffect(() => {
    if (selection && selection.sessionId !== sessionId) closePreview()
  }, [closePreview, selection, sessionId])

  if (!selection) return null
  const unsupported = selection.mediaType !== 'text/markdown'
  const previewSources = sourceState.phase === 'ready' ? sourceState.sources : Object.freeze([])
  const versions = versionState.phase === 'ready' ? versionState.versions : Object.freeze([])
  const selectedVersion = versions.find(version => version.versionId === selectedVersionId) ?? null
  const newestVersionId = versions.at(-1)?.versionId ?? null
  const revisionBase = tab === 'versions' ? selectedVersion : null
  const selectedVersionContent = versionContentState.phase === 'ready'
    && matchesSessionOutputVersionSelection(selectedVersion, versionContentState.content)
    ? versionContentState.content
    : null
  const selectedComparePlan = compareState.phase === 'ready'
    && compareState.fromVersionId === compareFromId
    && compareState.toVersionId === compareToId
    ? compareState.plan
    : null
  const comparisonPanel = versions.length < 2
    ? null
    : h('section', { className: 'dsh-work-output-preview-comparison', 'aria-label': '比较版本' },
      h('div', { className: 'dsh-work-output-preview-compare-controls' },
        h('strong', null, '比较版本'),
        h('select', {
          'aria-label': '比较起点版本',
          value: compareFromId ?? '',
          onChange: (event: ChangeEvent<HTMLSelectElement>) => setCompareFromId(event.currentTarget.value),
        }, ...versions.map(version => h('option', { key: version.versionId, value: version.versionId },
          `v${String(version.ordinal)}`))),
        h('span', { 'aria-hidden': 'true' }, '→'),
        h('select', {
          'aria-label': '比较终点版本',
          value: compareToId ?? '',
          onChange: (event: ChangeEvent<HTMLSelectElement>) => setCompareToId(event.currentTarget.value),
        }, ...versions.map(version => h('option', { key: version.versionId, value: version.versionId },
          `v${String(version.ordinal)}`)))),
      compareState.phase === 'error'
        ? h('div', { className: 'dsh-work-output-preview-compare-empty', role: 'alert' }, '暂时无法比较所选版本。')
        : !selectedComparePlan
          ? h('div', { className: 'dsh-work-output-preview-compare-empty', role: 'status', 'aria-live': 'polite' }, '正在比较版本…')
          : selectedComparePlan.mode === 'unchanged'
            ? h('div', { className: 'dsh-work-output-preview-compare-empty', 'data-work-output-diff': 'unchanged' }, '两个版本内容相同，没有变化。')
            : selectedComparePlan.mode === 'bounded'
              ? h('div', { className: 'dsh-work-output-preview-compare-empty', 'data-work-output-diff': 'bounded' },
                `文件较大，已停止逐行比较（起点 ${boundedDiffLineLabel(selectedComparePlan.fromLines)}，终点 ${boundedDiffLineLabel(selectedComparePlan.toLines)}）。`)
              : h('div', { className: 'dsh-work-output-preview-diff' },
                ...selectedComparePlan.blocks.filter(block => block.kind !== 'equal').map((block, index) => h('article', {
                  key: index,
                  className: `is-${block.kind}`,
                  'data-work-output-diff': block.kind,
                },
                h('strong', null, block.kind === 'removed'
                  ? `− v${String(versions.find(version => version.versionId === compareFromId)?.ordinal ?? '')} 删除`
                  : `+ v${String(versions.find(version => version.versionId === compareToId)?.ordinal ?? '')} 新增`),
                h('pre', null, block.lines.join('\n'))))))
  const changeTab = (next: 'content' | 'sources' | 'versions'): void => {
    revisionAbort.current?.abort()
    revisionAbort.current = null
    revisionRequest.invalidate()
    setRevisionPhase('idle')
    setRevisionError(null)
    setTab(next)
  }
  const changeVersion = (versionId: string): void => {
    revisionAbort.current?.abort()
    revisionAbort.current = null
    revisionRequest.invalidate()
    setRevisionPhase('idle')
    setRevisionError(null)
    setSelectedVersionId(versionId)
  }
  const prepareRevision = (intent: 'modify' | 'restore'): void => {
    const target = selection
    const base = revisionBase
    if (intent === 'restore' && !base) return
    const retainedLeases = activeRecoveryContext?.revisionLeases ?? Object.freeze([])
    if (!retainedLeases.some(lease => lease.sessionId === target.sessionId)
      && retainedLeases.length >= MAX_RECOVERY_REVISION_LEASES) {
      setRevisionError('当前有过多未完成的文件修改。请先完成或重试已有修改。')
      setRevisionPhase('error')
      return
    }
    revisionAbort.current?.abort()
    const abort = new AbortController()
    revisionAbort.current = abort
    setRevisionPhase('preparing')
    setRevisionError(null)
    void revisionRequest.run(
      () => works.prepareSessionOutputRevision({
        sessionId: target.sessionId,
        turn: target.turn,
        throughSeq: target.throughSeq,
        path: target.path,
        ...(base ? { baseVersion: { fileId: base.fileId, versionId: base.versionId } } : {}),
        ...(intent === 'restore' ? { intent: 'restore' as const } : {}),
      }, abort.signal),
      revision => {
        revisionAbort.current = null
        if (!matchesSessionOutputSelection(preview.getSnapshot(), target)
          || sessionId !== target.sessionId) return
        let recoveryPersisted = false
        window.dispatchEvent(new CustomEvent<SessionResourceReferenceDetail>(
          'dsh-work:reference-session-resource',
          { detail: Object.freeze({
            sessionId: revision.sessionId,
            path: revision.path,
            reportRecoveryPersistence: (persisted: boolean) => { recoveryPersisted = persisted },
            revisionLease: Object.freeze({
              ...revision.revisionLease,
              preparedAfterTurn: revision.preparedAfterTurn,
              rejected: null,
            }),
            ...(revision.baseVersion ? { base: Object.freeze({
              path: revision.baseVersion.path,
              ordinal: revision.baseVersion.ordinal,
              ...(revision.intent === 'restore' ? { intent: 'restore' as const } : {}),
            }) } : {}),
          }) },
        ))
        if (!recoveryPersisted) {
          setRevisionPhase('error')
          setRevisionError('当前草稿过长，无法安全保留文件修改状态。请缩短草稿后重试。')
          return
        }
        setRevisionPhase('idle')
        setRevisionError(null)
        if (narrow) closePreview()
      },
      cause => {
        revisionAbort.current = null
        if (!matchesSessionOutputSelection(preview.getSnapshot(), target)) return
        setRevisionError(intent === 'restore' && remoteErrorCode(cause) === 'work/session-output-conflict'
          ? '当前文件已在工作区发生变化。请刷新版本，确认内容后重试恢复。'
          : intent === 'restore'
            ? cause instanceof Error && cause.message.trim().length > 0
              ? cause.message
              : '暂时无法准备所选版本，请重新读取后再试。'
            : cause instanceof Error && cause.message.trim().length > 0
            ? cause.message
            : '无法保护当前文件，请重新读取后再试。')
        setRevisionPhase('error')
      },
    )
  }
  const saveOutput = (retained?: SessionOutputSaveTarget): void => {
    const target = selection
    const versionTarget = tab === 'versions' ? revisionBase : null
    const saveTarget = sessionOutputSaveTarget(target, versionTarget, retained)
    setSaveState({ phase: 'saving', target: saveTarget })
    void works.saveSessionOutput(saveTarget.spec).then(saved => {
      if (matchesSessionOutputSelection(preview.getSnapshot(), target)
        && sessionId === target.sessionId) {
        setSaveOpenError(false)
        setSaveState({ phase: 'saved', value: saved })
      }
    }).catch(() => {
      if (matchesSessionOutputSelection(preview.getSnapshot(), target)) {
        setSaveOpenError(false)
        setSaveState({ phase: 'error', target: saveTarget })
      }
    })
  }
  const versionPanel = versionState.phase === 'loading' || versionState.phase === 'idle'
    ? h('div', { className: 'dsh-work-output-preview-status', role: 'status', 'aria-live': 'polite' }, '正在读取版本记录…')
    : versionState.phase === 'error'
      ? h('div', { className: 'dsh-work-output-preview-empty', role: 'alert' },
        h('strong', null, '暂时无法读取版本记录'),
        h('p', null, '版本记录没有改变，可以重新读取。'),
        h('button', { type: 'button', onClick: () => setVersionRetry(value => value + 1) }, '重试'))
      : versions.length < 1
        ? h('div', { className: 'dsh-work-output-preview-empty' },
          h('strong', null, '还没有可查看的历史版本'),
          h('p', null, '文件在成功生成后会留下不可变版本。'))
        : h('div', { className: 'dsh-work-output-preview-versions' },
          h('div', { className: 'dsh-work-output-preview-version-list', 'aria-label': '历史版本' },
            ...[...versions].reverse().map(version => h('button', {
              type: 'button',
              key: version.versionId,
              className: version.versionId === selectedVersionId ? 'is-selected' : undefined,
              'aria-pressed': version.versionId === selectedVersionId,
              'data-work-output-version': `v${String(version.ordinal)}`,
              onClick: () => changeVersion(version.versionId),
            },
            h('span', { className: 'dsh-work-output-preview-version-title' },
              h('strong', null, `v${String(version.ordinal)}`),
              version.versionId === newestVersionId
                ? h('small', { className: 'is-current' }, '当前版')
                : null,
              version.adoption
                ? h('small', { className: 'is-adopted', 'data-work-output-adopted': true }, '已采用')
                : null),
            h('span', { className: 'dsh-work-output-preview-version-meta', title: version.createdAt },
              version.turn === null ? '既有成果基线' : `第 ${String(version.turn)} 回合`,
              ' · ', sessionOutputVersionTime(version.createdAt),
              ' · ', outputSize(version.bytes))))),
          h('div', {
            className: 'dsh-work-output-preview-version-detail',
            'data-work-output-version-detail': selectedVersion ? `v${String(selectedVersion.ordinal)}` : undefined,
          }, versionContentState.phase === 'error'
              ? h('div', { className: 'dsh-work-output-preview-empty', role: 'alert' },
                h('strong', null, '暂时无法读取所选版本'),
                h('p', null, '版本记录没有改变，可以重新读取。'),
                h('button', { type: 'button', onClick: () => setVersionRetry(value => value + 1) }, '重试'))
              : !selectedVersionContent
                ? h('div', { className: 'dsh-work-output-preview-status', role: 'status', 'aria-live': 'polite' }, '正在读取所选版本…')
                : h('div', null,
                h('div', { className: 'dsh-work-output-preview-version-summary' },
                  h('span', null, '内容摘要'),
                  h('strong', null, sessionOutputVersionSummary(selectedVersionContent.content)),
                  h('small', null,
                    `SHA-256 ${selectedVersionContent.contentDigest.slice(0, 12)} · `,
                    selectedVersionContent.sources.length > 0
                      ? `${String(selectedVersionContent.sources.length)} 个来源`
                      : '无明确来源')),
                comparisonPanel,
                safeMarkdownContent(selectedVersionContent))))
  return h('section', {
    className: 'dsh-work-output-preview',
    'data-work-output-preview': selection.path,
    'aria-label': `${selection.name} 预览`,
    role: narrow ? 'dialog' : 'region',
    'aria-modal': narrow || undefined,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (!narrow) return
      if (event.key === 'Escape') {
        event.preventDefault()
        closePreview()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not(:disabled), select:not(:disabled)',
      )).filter(button => button.tabIndex >= 0)
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    },
  },
  h('header', { className: 'dsh-work-output-preview-header' },
    h('span', { className: 'dsh-work-output-preview-file-icon', 'aria-hidden': 'true' }, '文'),
    h('strong', { title: selection.path }, selection.name),
    h('button', {
      ref: closeButton,
      type: 'button',
      className: 'dsh-work-output-preview-close',
      'aria-label': '返回会话并关闭文件预览',
      onClick: closePreview,
    },
    h('span', { className: 'dsh-work-output-preview-close-wide', 'aria-hidden': true }, '×'),
    h('span', { className: 'dsh-work-output-preview-close-narrow', 'aria-hidden': true }, '←'),
    h('span', { className: 'dsh-work-output-preview-close-label' }, '返回会话'))),
  h('div', { className: 'dsh-work-output-preview-tabs', role: 'tablist', 'aria-label': '文件详情' },
    h('button', {
      type: 'button',
      role: 'tab',
      'aria-selected': tab === 'content',
      onClick: () => changeTab('content'),
    }, '内容'),
    h('button', {
      type: 'button',
      role: 'tab',
      'aria-selected': tab === 'sources',
      onClick: () => changeTab('sources'),
    }, `来源${previewSources.length > 0 ? ` ${String(previewSources.length)}` : ''}`),
    h('button', {
      type: 'button',
      role: 'tab',
      'aria-selected': tab === 'versions',
      onClick: () => changeTab('versions'),
    }, `版本${versions.length > 0 ? ` ${String(versions.length)}` : ''}`)),
  h('div', { className: 'dsh-work-output-preview-meta' },
    h('span', null, tab === 'versions' && selectedVersion
      ? selectedVersion.turn === null ? '既有成果基线' : `第 ${String(selectedVersion.turn)} 回合生成`
      : `第 ${String(selection.turn)} 回合生成`),
    h('span', null, outputSize(tab === 'versions' && selectedVersion
      ? selectedVersion.bytes
      : selection.bytes))),
  h('div', { className: 'dsh-work-output-preview-body' },
    tab === 'versions'
      ? versionPanel
      : tab === 'sources'
      ? sourceState.phase === 'loading' || sourceState.phase === 'idle'
        ? h('div', { className: 'dsh-work-output-preview-status', role: 'status', 'aria-live': 'polite' }, '正在核对资料来源…')
        : sourceState.phase === 'error'
          ? h('div', { className: 'dsh-work-output-preview-empty', role: 'status', 'aria-live': 'polite' },
            h('strong', null, '暂时无法核对资料来源'),
            h('p', null, '重新打开文件后可以再次核对。'))
          : previewSources.length < 1
            ? h('div', { className: 'dsh-work-output-preview-empty' },
              h('strong', null, '没有可核对的资料来源'),
              h('p', null, '这里只显示本回合明确引用或实际读取的资料文件。'))
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
              h('span', null, '资料文件'),
              h('span', { className: `is-${source.status}` }, sourceStatusLabel(source.status)),
              source.bytes === null ? null : h('span', null, outputSize(source.bytes))),
            h('button', {
              type: 'button',
              disabled: source.status !== 'verified' && source.status !== 'unverified',
              onClick: () => {
                window.dispatchEvent(new CustomEvent<SessionResourceReferenceDetail>(
                  'dsh-work:reference-session-resource',
                  { detail: Object.freeze({ sessionId: source.sessionId, path: source.path }) },
                ))
                if (narrow) closePreview()
              },
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
  h('footer', {
    className: `dsh-work-output-preview-actions${tab === 'versions' ? ' is-versions' : ''}`,
  },
    h('span', {
      role: saveState.phase === 'error' || saveOpenError || revisionPhase === 'error'
        || adoptionPhase === 'error' ? 'alert' : 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
      title: saveState.phase === 'saved' ? saveState.value.location : undefined,
    }, adoptionPhase === 'error'
      ? '采用结果尚未确认，请重试。'
      : revisionPhase === 'error'
      ? revisionError ?? '无法保护当前文件，请重新读取后再试。'
      : saveState.phase === 'saved'
      ? saveOpenError
        ? `${saveState.value.sourceVersion ? `v${String(saveState.value.sourceVersion.ordinal)} ` : ''}副本已保存到 ${saveState.value.location}，但暂时无法打开位置。`
        : `已保存${saveState.value.sourceVersion ? ` v${String(saveState.value.sourceVersion.ordinal)} ` : ''}到 ${saveState.value.location}`
      : saveState.phase === 'error'
        ? `${saveState.target.ordinal ? `v${String(saveState.target.ordinal)} ` : ''}副本保存结果尚未确认，请重试。`
        : unsupported
            ? '保存会复制当前文件到受管位置'
            : tab === 'versions'
              ? selectedVersion?.adoption
                ? `已采用 v${String(selectedVersion.ordinal)}：${selectedVersion.adoption.summary}`
                : '查看历史版本不会改变当前文件'
              : '保存和修改互不影响'),
    h('div', { className: 'dsh-work-output-preview-action-buttons' },
      saveState.phase === 'saved' ? h('button', {
        type: 'button',
        className: 'is-secondary',
        onClick: () => {
          const saved = saveState.value
          const target = selection
          setSaveOpenError(false)
          void works.showSessionOutputSave({
            saveId: saved.saveId,
            fileName: saved.fileName,
            contentDigest: saved.contentDigest,
          }).catch(() => {
            if (matchesSessionOutputSelection(preview.getSnapshot(), target)) setSaveOpenError(true)
          })
        },
      }, '打开位置') : null,
      h('button', {
        type: 'button',
        className: 'is-secondary',
        disabled: saveState.phase === 'saving'
          || (saveState.phase !== 'error'
            && tab === 'versions' && (!revisionBase || !selectedVersionContent)),
        onClick: () => saveOutput(saveState.phase === 'error' ? saveState.target : undefined),
      }, saveState.phase === 'saving'
        ? `正在保存${saveState.target.ordinal ? ` v${String(saveState.target.ordinal)}` : ''}…`
        : saveState.phase === 'error'
          ? `重试保存${saveState.target.ordinal ? ` v${String(saveState.target.ordinal)}` : ''}`
          : revisionBase
            ? `保存 v${String(revisionBase.ordinal)} 副本`
            : '保存副本'),
      !unsupported && revisionBase ? h('button', {
        type: 'button',
        className: 'is-secondary',
        disabled: adoptionPhase === 'adopting' || !selectedVersionContent || Boolean(revisionBase.adoption),
        'data-work-output-adopt': `v${String(revisionBase.ordinal)}`,
        onClick: () => {
          const target = revisionBase
          setAdoptionPhase('adopting')
          void adoptionRequest.run(
            () => works.adoptSessionOutputVersion({
              fileId: target.fileId,
              versionId: target.versionId,
            }),
            adoption => {
              if (!matchesSessionOutputVersionSelection(target, adoption)
                || !matchesSessionOutputSelection(preview.getSnapshot(), selection)) return
              setVersionState(current => current.phase === 'ready'
                ? { phase: 'ready', versions: Object.freeze(current.versions.map(version =>
                  version.fileId === adoption.fileId && version.versionId === adoption.versionId
                    ? Object.freeze({ ...version, adoption })
                    : version)) }
                : current)
              setVersionContentState(current => current.phase === 'ready'
                && matchesSessionOutputVersionSelection(target, current.content)
                ? { phase: 'ready', content: Object.freeze({ ...current.content, adoption }) }
                : current)
              setAdoptionPhase('idle')
            },
            () => {
              if (matchesSessionOutputSelection(preview.getSnapshot(), selection)) {
                setAdoptionPhase('error')
              }
            },
          )
        },
      }, revisionBase.adoption
        ? `已采用 v${String(revisionBase.ordinal)}`
        : adoptionPhase === 'adopting'
          ? '正在采用…'
          : `采用 v${String(revisionBase.ordinal)}`) : null,
      !unsupported && revisionBase ? h('button', {
        type: 'button',
        className: 'is-secondary',
        disabled: revisionPhase === 'preparing' || !selectedVersionContent,
        onClick: () => prepareRevision('restore'),
      }, revisionPhase === 'preparing'
        ? '正在准备…'
        : `恢复 v${String(revisionBase.ordinal)}`) : null,
      !unsupported ? h('button', {
        type: 'button',
        disabled: revisionPhase === 'preparing'
          || (tab === 'versions'
            ? !revisionBase || !selectedVersionContent
            : state.phase !== 'ready'),
        onClick: () => prepareRevision('modify'),
      }, revisionPhase === 'preparing'
        ? '正在准备…'
        : revisionBase
          ? `基于 v${String(revisionBase.ordinal)} 修改`
          : '要求修改') : null)))
}

const styles = `
:root {
  --work-bg: #ffffff;
  --work-sidebar: #f5f6f8;
  --work-surface: #ffffff;
  --work-surface-subtle: #f5f7fa;
  --work-text: #111826;
  --work-muted: #657080;
  --work-faint: #929ba8;
  --work-border: #e4e8ee;
  --work-border-strong: #cbd3df;
  --work-accent: #2f63e9;
  --work-accent-hover: #2454d1;
  --work-accent-subtle: #edf3ff;
  --work-success: #24866f;
  --work-warning: #b96912;
  --work-danger: #c84a51;
  --work-shadow: 0 12px 35px rgba(26, 39, 59, .09);
  --work-font: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}
body[data-ds-dark-theme] {
  --work-bg: #15171a;
  --work-sidebar: #1b1d21;
  --work-surface: #202328;
  --work-surface-subtle: #24272c;
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
/* Product-owned artwork occupies the native brand slots without replacing navigation. */
span:has(> [data-slot="conversation.hero.brand.mark"]) { display: none !important; }
[data-composer-card] { --dsw-alias-button-info-fill: #248d78; --dsw-alias-button-info-hover: #1c7564; }
/* Slot anchors keep the upstream navigation and collapsed rail intact. */
.dsh-work-brand-whale { display: block; width: 40px; height: 40px; object-fit: contain; flex-shrink: 0; }
button:has([data-dsh-work-brand="name"]) .dsh-work-brand-whale { width: 52px; height: 52px; }
[data-dsh-work-brand="name"] { display: flex; flex-direction: column; align-items: flex-start; text-align: left; gap: 2px; color: var(--work-text); font: 600 15px/20px var(--work-font); letter-spacing: -.025em; white-space: nowrap; }
[data-dsh-work-brand="name"] small { color: var(--work-muted); font-size: 11px; font-weight: 400; line-height: 15px; letter-spacing: 0; }
button:has([data-dsh-work-brand="name"]) { padding-block: 4px; border-radius: 8px; }
button:has([data-dsh-work-brand="name"]) > span { height: 52px; gap: 5px; }
[data-slot="sidebar"] > div > div:first-child { height: 72px; }
body:has([role="dialog"], .dsh-work-output-preview, .dsh-work-legacy-deliverable-overlay) .dsh-work-window-drag { display: none; }
.dsh-work-window-drag { position: fixed; z-index: 1; top: 0; left: 90px; right: 0; height: 38px; -webkit-app-region: drag; pointer-events: none; }
html[data-dsh-work-platform="darwin"] [data-slot="sidebar"] > div { position: relative; padding-top: 48px; }
html[data-dsh-work-platform="darwin"] [data-slot="sidebar"] > div > div:first-child > button:last-child { position: absolute; z-index: 2; right: 14px; top: 10px; -webkit-app-region: no-drag; }
html[data-dsh-work-platform="darwin"] [data-sidebar-collapsed] [data-slot="sidebar"] > div > div:first-child > button:last-child { position: static; }
html[data-dsh-work-platform="darwin"] [data-sidebar-collapsed] [data-slot="sidebar"] > div > div:first-child { height: 36px; }
html[data-dsh-work-platform="darwin"] [data-slot="conversation"] > div,
html[data-dsh-work-platform="darwin"] [data-slot="rightbar"] > div { padding-top: 38px; box-sizing: border-box; }

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
.dsh-work-session-output { min-width: 0; max-width: 320px; display: grid; grid-template-columns: 38px minmax(0, 1fr); align-items: center; gap: 12px; padding: 12px 14px 12px 12px; border: 1px solid var(--work-border); border-radius: 13px; color: var(--work-text); background: var(--work-surface); text-align: left; cursor: pointer; font-family: var(--work-font); }
.dsh-work-session-output:hover { border-color: var(--work-border-strong); background: var(--work-surface-subtle); }
.dsh-work-session-output.is-selected { border-color: var(--work-accent); box-shadow: inset 0 0 0 1px var(--work-accent); }
.dsh-work-session-output:focus-visible { outline: 2px solid var(--work-accent); outline-offset: 2px; }
.dsh-work-session-output-icon { width: 38px; height: 38px; display: inline-flex; align-items: center; justify-content: center; border-radius: 10px; color: var(--work-accent); background: var(--work-accent-subtle); font-size: 11px; font-weight: 700; }
.dsh-work-session-output-copy { min-width: 0; }
.dsh-work-session-output-copy strong, .dsh-work-session-output-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-work-session-output-copy strong { font-size: 13px; line-height: 18px; }
.dsh-work-session-output-copy small { color: var(--work-faint); font-size: 10px; line-height: 15px; }
.dsh-work-output-preview { height: 100%; min-width: 300px; display: flex; flex-direction: column; color: var(--work-text); background: var(--work-surface); font-family: var(--work-font); }
.dsh-work-output-preview-header { min-height: 49px; display: grid; grid-template-columns: 27px minmax(0, 1fr) 28px; align-items: center; gap: 9px; padding: 0 10px 0 16px; border-bottom: 1px solid var(--work-border); }
.dsh-work-output-preview-header strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.dsh-work-output-preview-file-icon { width: 27px; height: 27px; display: inline-flex; align-items: center; justify-content: center; border-radius: 7px; color: var(--work-accent); background: var(--work-accent-subtle); font-size: 9px; font-weight: 700; }
.dsh-work-output-preview-close { width: 28px; height: 28px; border: 0; border-radius: 8px; color: var(--work-muted); background: transparent; cursor: pointer; font: 400 20px/26px var(--work-font); }
.dsh-work-output-preview-close-narrow, .dsh-work-output-preview-close-label { display: none; }
.dsh-work-output-preview-close:hover { color: var(--work-text); background: var(--work-surface-subtle); }
.dsh-work-output-preview-tabs { height: 42px; display: flex; align-items: stretch; padding: 0 16px; border-bottom: 1px solid var(--work-border); }
.dsh-work-output-preview-tabs button { position: relative; min-width: 48px; border: 0; color: var(--work-muted); background: transparent; cursor: pointer; font: 600 11px/40px var(--work-font); }
.dsh-work-output-preview-tabs button[aria-selected="true"] { color: var(--work-accent); }
.dsh-work-output-preview-tabs button[aria-selected="true"]::after { content: ''; position: absolute; height: 2px; left: 10px; right: 10px; bottom: 0; background: var(--work-accent); }
.dsh-work-output-preview-meta { display: flex; justify-content: space-between; gap: 12px; padding: 12px 18px 0; color: var(--work-faint); font-size: 10px; }
.dsh-work-output-preview-body { flex: 1; min-height: 0; padding: 18px; overflow-y: auto; }
.dsh-work-output-preview-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 18px; border-top: 1px solid var(--work-border); background: var(--work-surface); }
.dsh-work-output-preview-actions > span { min-width: 0; overflow: hidden; color: var(--work-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.dsh-work-output-preview-actions span[role="alert"] { color: var(--work-danger); }
.dsh-work-output-preview-action-buttons { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; }
.dsh-work-output-preview-actions.is-versions { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr); align-items: stretch; }
.dsh-work-output-preview-actions.is-versions > span { width: 100%; white-space: normal; }
.dsh-work-output-preview-actions.is-versions .dsh-work-output-preview-action-buttons { width: 100%; min-width: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.dsh-work-output-preview-actions.is-versions button { width: 100%; min-width: 0; padding-inline: 8px; }
.dsh-work-output-preview-actions button { flex: 0 0 auto; padding: 8px 14px; border: 1px solid var(--work-accent); border-radius: 8px; color: white; background: var(--work-accent); cursor: pointer; font: 600 13px/18px var(--work-font); }
.dsh-work-output-preview-actions button.is-secondary { border-color: var(--work-border-strong); color: var(--work-text); background: var(--work-surface); }
.dsh-work-output-preview-actions button:disabled { cursor: default; opacity: .55; }
.dsh-work-output-preview-versions { display: grid; grid-template-columns: minmax(0, 1fr); min-height: 100%; border: 1px solid var(--work-border); border-radius: 10px; overflow: hidden; }
.dsh-work-output-preview-version-list { display: flex; flex-direction: column; gap: 4px; padding: 8px; border-bottom: 1px solid var(--work-border); background: var(--work-surface-subtle); }
.dsh-work-output-preview-version-list > button { display: grid; gap: 4px; padding: 10px; border: 1px solid transparent; border-radius: 8px; color: var(--work-text); background: transparent; text-align: left; cursor: pointer; font-family: var(--work-font); }
.dsh-work-output-preview-version-list > button:hover { background: var(--work-surface); }
.dsh-work-output-preview-version-list > button.is-selected { border-color: var(--work-accent); background: var(--work-surface); box-shadow: inset 0 0 0 1px var(--work-accent); }
.dsh-work-output-preview-version-title { display: flex; align-items: center; gap: 6px; }
.dsh-work-output-preview-version-title strong { margin-right: auto; font-size: 13px; }
.dsh-work-output-preview-version-title small.is-current { padding: 2px 5px; border-radius: 999px; color: var(--work-accent); background: var(--work-accent-subtle); font-size: 9px; font-weight: 700; }
.dsh-work-output-preview-version-title small.is-adopted { padding: 2px 5px; border-radius: 999px; color: var(--work-success); background: color-mix(in srgb, var(--work-success) 12%, transparent); font-size: 9px; font-weight: 700; }
.dsh-work-output-preview-version-meta { color: var(--work-faint); font-size: 10px; line-height: 15px; }
.dsh-work-output-preview-version-detail { min-width: 0; padding: 18px; }
.dsh-work-output-preview-version-summary { display: grid; gap: 5px; margin-bottom: 18px; padding: 12px 14px; border: 1px solid var(--work-border); border-radius: 8px; background: var(--work-surface-subtle); }
.dsh-work-output-preview-version-summary span { color: var(--work-faint); font-size: 10px; font-weight: 700; }
.dsh-work-output-preview-version-summary strong { font-size: 12px; line-height: 18px; }
.dsh-work-output-preview-version-summary small { color: var(--work-faint); font-size: 10px; }
.dsh-work-output-preview-comparison { display: grid; gap: 12px; margin-bottom: 20px; padding: 14px; border: 1px solid var(--work-border); border-radius: 9px; }
.dsh-work-output-preview-compare-controls { display: grid; grid-template-columns: minmax(0, 1fr) max-content minmax(0, 1fr); align-items: center; gap: 8px; }
.dsh-work-output-preview-compare-controls strong { grid-column: 1 / -1; font-size: 12px; }
.dsh-work-output-preview-compare-controls select { width: 100%; min-width: 0; height: 32px; padding: 0 8px; border: 1px solid var(--work-border-strong); border-radius: 7px; color: var(--work-text); background: var(--work-surface); font: 600 12px/1 var(--work-font); }
.dsh-work-output-preview-compare-empty { padding: 12px; border-radius: 7px; color: var(--work-muted); background: var(--work-surface-subtle); font-size: 11px; line-height: 17px; }
.dsh-work-output-preview-diff { display: grid; gap: 8px; }
.dsh-work-output-preview-diff article { overflow: hidden; border: 1px solid var(--work-border); border-radius: 7px; }
.dsh-work-output-preview-diff article.is-removed { border-color: color-mix(in srgb, var(--work-danger) 34%, var(--work-border)); background: color-mix(in srgb, var(--work-danger) 7%, var(--work-surface)); }
.dsh-work-output-preview-diff article.is-added { border-color: color-mix(in srgb, var(--work-accent) 34%, var(--work-border)); background: color-mix(in srgb, var(--work-accent) 7%, var(--work-surface)); }
.dsh-work-output-preview-diff strong { display: block; padding: 7px 10px; font-size: 10px; }
.dsh-work-output-preview-diff article.is-removed strong { color: var(--work-danger); }
.dsh-work-output-preview-diff article.is-added strong { color: var(--work-accent); }
.dsh-work-output-preview-diff pre { margin: 0; padding: 8px 10px; overflow-x: auto; color: var(--work-text); background: transparent; font: 11px/18px ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
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
@media (max-width: 995px) {
  .dsh-work-output-preview { position: fixed; z-index: 30; inset: 0; width: 100vw; height: 100dvh; min-width: 0; }
  .dsh-work-output-preview-header { grid-template-columns: 28px minmax(0, 1fr) max-content; }
  .dsh-work-output-preview-close { width: auto; min-width: 44px; padding: 0 10px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; border-radius: 8px; font-size: 14px; line-height: 32px; }
  .dsh-work-output-preview-close-wide { display: none; }
  .dsh-work-output-preview-close-narrow, .dsh-work-output-preview-close-label { display: inline; }
}
@media (max-width: 480px) {
  .dsh-work-output-preview-header { min-height: 49px; padding-left: 12px; }
  .dsh-work-output-preview-tabs { height: 42px; padding: 0 10px; }
  .dsh-work-output-preview-tabs button { font-size: 11px; line-height: 40px; }
  .dsh-work-output-preview-meta { padding: 12px 16px 0; }
  .dsh-work-output-preview-body { padding: 14px 16px 24px; }
  .dsh-work-output-preview-actions { align-items: stretch; flex-direction: column; padding: 10px 12px; }
  .dsh-work-output-preview-actions > span { white-space: normal; }
  .dsh-work-output-preview-action-buttons { width: 100%; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dsh-work-output-preview-actions button { min-width: 0; padding-inline: 8px; }
  .dsh-work-output-preview-compare-controls { grid-template-columns: 1fr 1fr; }
  .dsh-work-output-preview-compare-controls > strong { grid-column: 1 / -1; }
  .dsh-work-output-preview-compare-controls > span { display: none; }
  .dsh-work-output-preview-source { grid-template-columns: 1fr; }
  .dsh-work-output-preview-source > button { justify-self: start; }
}
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
.dsh-work-inline-error { margin: 8px 0 -4px; color: var(--work-danger); font-size: 12px; line-height: 18px; }
.dsh-work-session-resource { min-width: 0; width: min(var(--dsh-composer-card-max-width, 720px), calc(100% - 32px)); margin-inline: auto; font-family: var(--work-font); }
.dsh-work-session-resource:not(:has(.dsh-work-session-resource-list)) { height: 0; }
.dsh-work-session-resource.is-drop-active { outline: 1px dashed var(--work-accent); border-radius: 10px; }
.dsh-work-file-input { position: fixed; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); opacity: 0; pointer-events: none; }
.dsh-work-session-resource-trigger { min-width: 0; max-width: 220px; height: 28px; display: inline-flex; align-items: center; gap: 4px; padding: 0 4px 0 8px; border: none; border-radius: 24px; outline: none; color: var(--dsw-alias-label-secondary); background: transparent; cursor: pointer; font: inherit; font-size: 13px; font-weight: 500; line-height: 20px; }
.dsh-work-session-resource-trigger-icon { display: inline-flex; flex: none; }
.dsh-work-session-resource-trigger-icon svg { width: 14px; height: 14px; }
.dsh-work-session-resource-trigger-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-work-session-resource-trigger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-work-session-resource-trigger:focus-visible { box-shadow: 0 0 0 2px var(--dsw-alias-border-l3); }
.dsh-work-session-resource-trigger:disabled { color: var(--dsw-alias-label-dimmed); cursor: default; }
@container (width <= 460px) { .dsh-work-session-resource-trigger-label { display: none; } }
.dsh-work-session-resource-list { display: flex; flex-wrap: wrap; gap: 6px; max-height: 100px; overflow-y: auto; margin-bottom: 4px; color: var(--work-text); }
.dsh-work-session-resource-row { min-width: 0; display: flex; align-items: center; gap: 6px; padding: 4px 7px; border-radius: 8px; background: var(--work-surface-subtle); }
[data-composer-chip="reference"] { --dsw-alias-state-business-primary: var(--work-text); --dsw-alias-interactive-bg-hover: var(--work-surface-subtle); }
[data-composer-chip="reference"] > span { height: 22px; max-width: min(320px, 100%); border-radius: 11px; font-size: 12px; line-height: 22px; }
[data-composer-chip="reference"] > span > svg { color: var(--work-accent); }
.dsh-work-session-resource-row.is-failed { color: var(--work-danger); }
.dsh-work-session-resource-icon { width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; flex: none; border-radius: 6px; color: var(--work-accent); background: var(--work-accent-subtle); font-size: 10px; font-weight: 700; }
.dsh-work-session-resource-copy { min-width: 0; flex: 1; }
.dsh-work-session-resource-copy strong, .dsh-work-session-resource-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-work-session-resource-copy strong { font-size: 12px; line-height: 17px; }
.dsh-work-session-resource-copy small { color: var(--work-faint); font-size: 10px; line-height: 15px; }
.dsh-work-session-resource-row.is-failed small { color: var(--work-danger); }
.dsh-work-session-resource-row > button { flex: none; padding: 3px 6px; border: 0; border-radius: 5px; color: var(--work-muted); background: transparent; cursor: pointer; font: 500 11px/1 var(--work-font); }
.dsh-work-session-resource-row > button:hover { color: var(--work-text); background: var(--work-border); }

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
  const sessionNavigation = (ctx as Context & WorkSessionNavigationContext).sessions
  let stopRecoveryNavigation: (() => void) | null = null
  const openRetainedSession = (retained: WorkRecoveryContext): void => {
    const settleWhenListed = (): boolean => {
      const list = sessionNavigation.list.getSnapshot()
      const disposition = recoverySessionDisposition(retained.sessionId, list)
      if (disposition === 'wait') return false
      if (disposition === 'discard') {
        clearRecoveryContext()
        return true
      }
      if (list.current !== retained.sessionId) sessionNavigation.open(retained.sessionId)
      return true
    }
    stopRecoveryNavigation?.()
    stopRecoveryNavigation = null
    if (settleWhenListed()) return
    const unsubscribe = sessionNavigation.list.subscribe(() => {
      if (!settleWhenListed()) return
      unsubscribe()
      if (stopRecoveryNavigation === unsubscribe) stopRecoveryNavigation = null
    })
    stopRecoveryNavigation = unsubscribe
  }
  const restoreContext = (): void => {
    const retained = parseWorkRecoveryContext(window.dshWorkRecovery?.read() || window.name)
    if (!retained) return
    activeRecoveryContext = retained
    pendingRecoverySession = retained.sessionId
    pendingRecoveryDraft = Object.freeze({ sessionId: retained.sessionId, draft: retained.draft })
    pendingRecoverySelection = retained.selection
    openRetainedSession(retained)
  }
  restoreContext()
  const removeStyles = installStyles()
  const previews = new Map<string, SessionOutputPreviewStore>()
  const previewFor = (sessionId: string): SessionOutputPreviewStore => {
    let preview = previews.get(sessionId)
    if (!preview) {
      preview = createSessionOutputPreviewStore()
      previews.set(sessionId, preview)
    }
    return preview
  }
  const previewKind = 'dsh-work-output'
  const previewId = '@dsh-work/work-api/output'
  const removePreviewType = ctx.sidebarRightTabs.register({
    id: previewId, kind: previewKind, title: () => '文件版本',
  })
  const closePreview = (preview: SessionOutputPreviewStore, closeTab: () => void): void => {
    const selected = preview.getSnapshot()
    const returnToComposer = window.matchMedia(NARROW_PREVIEW_QUERY).matches
    closeTab()
    preview.clear()
    if (selected && activeRecoveryContext?.sessionId === selected.sessionId) {
      publishRecoveryContext(selected.sessionId, activeRecoveryContext.draft, null)
    }
    if (selected) {
      requestAnimationFrame(() => {
        if (returnToComposer) {
          document.querySelector<HTMLElement>('[data-composer-input]')?.focus()
          return
        }
        const rows = document.querySelectorAll<HTMLElement>(
          `[data-work-session-output-turn="${String(selected.turn)}"] [data-work-session-output]`,
        )
        Array.from(rows).find(row => row.dataset.workSessionOutput === selected.path)?.focus()
      })
    }
  }
  const removePreview = ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: previewId,
    inject: (sessionId: string) => ({ works, preview: previewFor(sessionId) }),
  }, (props: Omit<NativeSessionOutputPreviewProps, 'closePreview'> & {
    readonly useTabInfo: UseSidebarRightTabInfo
  }) => {
    const info = props.useTabInfo()
    return h(NativeSessionOutputPreview, {
      ...props, closePreview: () => closePreview(props.preview, () => info.tab.actions.close()),
    })
  }))
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
    previewFor(detail.sessionId).select(Object.freeze({ ...detail, open } as SessionOutputPreviewSelection))
    ctx.sidebarRight.openTab(previewKind)
  }
  window.addEventListener('dsh-work:select-session-output', selectOutput)
  window.addEventListener('dsh-work:restore-context', restoreContext)
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({
    name: 'sidebar.brand.name',
    priority: -100,
  }, () => h('span', { 'data-dsh-work-brand': 'name', title: 'DSH Work · 基于 DeepSeek Harness 构建' },
    h('small', null, '基于'), h('span', null, 'DeepSeek Harness'))))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'dsh-work-session-resources',
    order: -100,
    inject: (sessionId: string) => ({
      works,
      insertResourceReference: (request: NativeReferenceRequest): boolean => {
        const scope = sessionNavigation.scope(sessionId)
        return scope?.bail(scope, 'slash/input-insert-reference', request) === true
      },
    }),
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
  }, () => h('img', {
    className: 'dsh-work-brand-whale',
    'data-dsh-work-brand': 'mark',
    src: WORK_WHALE_DATA_URL,
    alt: '',
    'aria-hidden': 'true',
  })))
  ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({
    name: 'conversation.hero.brand.mark',
    priority: -100,
  }, () => null))
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
    window.removeEventListener('dsh-work:restore-context', restoreContext)
    removePreview()
    removePreviewType()
    for (const preview of previews.values()) preview.clear()
    previews.clear()
    stopRecoveryNavigation?.()
    removeStyles()
  }
}
