import type { RuntimeSnapshot } from '../../packages/runtime-contract/index.ts'

export interface TrayMenuEntry {
  readonly label?: string
  readonly type?: 'separator'
  readonly enabled?: boolean
  readonly click?: () => void
}

interface TraySurface {
  setToolTip(value: string): void
  setContextMenu(menu: unknown): void
  on(event: 'click', listener: () => void): void
  destroy(): void
}

interface TrayWindow {
  isDestroyed(): boolean
  show(): void
  focus(): void
}

interface TrayHost {
  snapshot(): RuntimeSnapshot
  active(): boolean
  start(): Promise<RuntimeSnapshot>
  stop(): Promise<RuntimeSnapshot>
  safeMode(): Promise<RuntimeSnapshot>
  subscribe(listener: (status: RuntimeSnapshot) => void): () => void
  subscribeActivity(listener: (active: boolean) => void): () => void
}

export interface DesktopTrayController {
  show(): void
  refresh(): void
  dispose(): void
}

interface DesktopTrayOptions {
  readonly tray: TraySurface
  readonly window: TrayWindow
  readonly host: TrayHost
  readonly buildMenu: (entries: readonly TrayMenuEntry[]) => unknown
  readonly quit: () => void
}

export function createDesktopTray({
  tray, window, host, buildMenu, quit,
}: DesktopTrayOptions): DesktopTrayController {
  let disposed = false
  const run = (operation: () => Promise<RuntimeSnapshot>): void => {
    void operation().catch(() => {})
  }
  const show = (): void => {
    if (disposed || window.isDestroyed()) return
    window.show()
    window.focus()
  }
  const refresh = (): void => {
    if (disposed) return
    const status = host.snapshot()
    const active = host.active()
    tray.setToolTip(active ? 'DSH Work · 正在工作' : 'DSH Work')
    const runtime: TrayMenuEntry = status.canStop
      ? { label: '停止工作台', click: () => run(() => host.stop()) }
      : { label: '打开工作台', enabled: status.canStart, click: () => run(() => host.start()) }
    tray.setContextMenu(buildMenu([
      { label: '显示 DSH Work', click: show },
      { type: 'separator' },
      runtime,
      { label: '使用安全模式', enabled: status.canRecover, click: () => run(() => host.safeMode()) },
      { type: 'separator' },
      { label: '退出 DSH Work', click: quit },
    ]))
  }
  const unsubscribeStatus = host.subscribe(refresh)
  const unsubscribeActivity = host.subscribeActivity(refresh)
  tray.on('click', show)
  refresh()
  return Object.freeze({
    show,
    refresh,
    dispose(): void {
      if (disposed) return
      disposed = true
      unsubscribeStatus()
      unsubscribeActivity()
      tray.destroy()
    },
  })
}
