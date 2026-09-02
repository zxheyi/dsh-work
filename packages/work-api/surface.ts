import {
  createElement,
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

import type { IWorks, WorkClientSnapshot } from './client-model.ts'
import type { WorkView } from './index.ts'

interface WorkSurfaceInjected {
  readonly works: IWorks
}

interface WorkSidebarProps extends WorkSurfaceInjected {
  readonly collapsed: boolean
  readonly width: number
}

const h = createElement

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

function ResourceEntry(): ReactNode {
  return h('div', { className: 'dsh-work-resource-entry' },
    h('details', { className: 'dsh-work-resource-menu' },
      h('summary', {
        className: 'dsh-work-resource-trigger',
        'aria-haspopup': 'menu',
      },
      h('span', { className: 'dsh-work-resource-plus', 'aria-hidden': 'true' }, '+'),
      h('span', null, '添加资料'),
      h('span', { className: 'dsh-work-resource-chevron', 'aria-hidden': 'true' }, '⌄')),
      h('div', { className: 'dsh-work-resource-popover', role: 'menu', 'aria-label': '添加资料方式' },
        h(DisabledResourceItem, null, '添加文件'),
        h(DisabledResourceItem, null, '添加文件夹'),
        h(DisabledResourceItem, null, '添加网页'),
        h(DisabledResourceItem, null, '粘贴内容'))),
    h('span', { className: 'dsh-work-resource-help' }, '可选，文件和文件夹即将支持'))
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

export function WorkHomeSurface({ works }: WorkSurfaceInjected): ReactNode {
  const snapshot = useWorks(works)
  const work = snapshot.items[0]
  const [goal, setGoal] = useState('')
  const [creating, setCreating] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const canSubmit = goal.trim().length > 0 && !creating
  const composerTitle = work ? '接下来想推进什么？' : '你想完成什么？'
  const composerHint = work
    ? '补充要求，继续推进同一项工作。'
    : '描述想要的结果，资料可以稍后添加。'

  const submit = useCallback(async () => {
    const instruction = goal.trim()
    if (!instruction || creating) return
    setCreating(true)
    setActionError(null)
    try {
      const target = work ?? await works.create({
        title: titleFromGoal(instruction),
        goal: instruction,
      })
      await works.dispatch({
        workId: target.workId,
        command: { type: 'submit-turn', instruction },
      })
      setGoal('')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '工作暂时无法开始，请稍后重试。')
    } finally {
      setCreating(false)
    }
  }, [creating, goal, work, works])

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
          h('label', { className: 'dsh-work-visually-hidden', htmlFor: 'dsh-work-goal' }, '工作目标'),
          h('textarea', {
            id: 'dsh-work-goal',
            'data-work-goal': true,
            value: goal,
            disabled: creating,
            placeholder: work
              ? '例如：把结论压缩成一页管理层摘要，并补充下一步建议。'
              : '描述目标，或将文件和文件夹拖到这里（即将支持）',
            onChange: (event: { currentTarget: { value: string } }) => setGoal(event.currentTarget.value),
            onKeyDown,
          }),
          actionError
            ? h('p', { className: 'dsh-work-inline-error', role: 'alert' }, actionError)
            : snapshot.state === 'error'
              ? h('p', { className: 'dsh-work-inline-error', role: 'status' }, '连接正在恢复，已有工作不会丢失。')
              : null,
          h('div', { className: 'dsh-work-composer-actions' },
            h(ResourceEntry),
            h('button', {
              className: 'dsh-work-primary',
              type: 'submit',
              disabled: !canSubmit,
            }, creating ? '正在创建' : work ? '继续工作' : '开始工作'))),
        h('section', { className: 'dsh-work-shortcuts', 'aria-labelledby': 'dsh-work-shortcuts-title' },
          h('h2', { id: 'dsh-work-shortcuts-title' }, '常见工作'),
          h('div', { className: 'dsh-work-shortcut-grid' }, shortcuts.map(shortcut =>
            h('button', {
              className: 'dsh-work-shortcut',
              type: 'button',
              key: shortcut.key,
              disabled: creating,
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
.dsh-work-composer textarea { width: 100%; height: 118px; resize: none; padding: 14px 16px; border: 1px solid var(--work-border-strong); border-radius: 10px; outline: none; color: var(--work-text); background: var(--work-surface); font: 400 15px/24px var(--work-font); }
.dsh-work-composer textarea::placeholder { color: var(--work-faint); }
.dsh-work-composer textarea:focus { border-color: var(--work-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--work-accent) 22%, transparent); }
.dsh-work-composer textarea:disabled { opacity: .72; }
.dsh-work-inline-error { margin: 8px 0 -4px; color: var(--work-danger); font-size: 12px; line-height: 18px; }
.dsh-work-composer-actions { min-height: 40px; display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 16px; }
.dsh-work-resource-entry { min-width: 0; display: flex; align-items: center; gap: 12px; }
.dsh-work-resource-menu { position: relative; flex: none; }
.dsh-work-resource-trigger { min-width: 104px; height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 0 12px; border: 1px solid var(--work-border); border-radius: 9px; color: var(--work-muted); background: var(--work-surface); cursor: pointer; list-style: none; user-select: none; font: 550 13px/18px var(--work-font); }
.dsh-work-resource-trigger::-webkit-details-marker { display: none; }
.dsh-work-resource-trigger:hover { color: var(--work-text); border-color: var(--work-border-strong); background: var(--work-surface-subtle); }
.dsh-work-resource-plus { color: var(--work-accent); font-size: 17px; font-weight: 500; }
.dsh-work-resource-chevron { margin-left: 1px; color: var(--work-faint); font-size: 13px; transition: transform 150ms ease; }
.dsh-work-resource-menu[open] .dsh-work-resource-trigger { color: var(--work-text); border-color: var(--work-border-strong); background: var(--work-surface-subtle); }
.dsh-work-resource-menu[open] .dsh-work-resource-chevron { transform: rotate(180deg); }
.dsh-work-resource-popover { position: absolute; z-index: 10; bottom: calc(100% + 8px); left: 0; width: 240px; display: grid; padding: 6px; border: 1px solid var(--work-border); border-radius: 10px; background: var(--work-surface); box-shadow: 0 14px 32px rgba(35, 50, 76, .14); }
.dsh-work-resource-item { width: 100%; height: 44px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 10px; border: 0; border-radius: 7px; color: var(--work-text); background: transparent; text-align: left; font: 550 13px/20px var(--work-font); }
.dsh-work-resource-item:disabled { opacity: 1; cursor: default; }
.dsh-work-resource-item:hover { background: var(--work-surface-subtle); }
.dsh-work-resource-item span { color: var(--work-faint); font: 400 11px/16px var(--work-font); }
.dsh-work-resource-help { min-width: 0; overflow: hidden; color: var(--work-faint); font-size: 12px; line-height: 18px; text-overflow: ellipsis; white-space: nowrap; }
.dsh-work-primary { min-width: 112px; height: 40px; padding: 0 18px; border: 0; border-radius: 10px; color: white; background: var(--work-accent); cursor: pointer; white-space: nowrap; font: 600 14px/20px var(--work-font); }
.dsh-work-primary:hover:not(:disabled) { background: var(--work-accent-hover); }
.dsh-work-primary:disabled { opacity: .42; cursor: default; }
.dsh-work-primary:active:not(:disabled), .dsh-work-shortcut:active:not(:disabled), .dsh-work-sidebar-create:active { transform: translateY(1px); }
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
  ctx.slots.inject('sidebar', () => ctx.slots.register({
    name: 'sidebar',
    priority: -100,
    inject: () => ({ works }),
  }, WorkSidebar))
  ctx.slots.inject('conversation', () => ctx.slots.register({
    name: 'conversation',
    priority: -100,
    inject: () => ({ works }),
  }, WorkHomeSurface))
  return removeStyles
}
