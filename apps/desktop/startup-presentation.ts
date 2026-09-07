import type { RuntimeCode, RuntimeSnapshot } from '../../packages/runtime-contract/index.ts'

export type PresentationCode = RuntimeCode | 'desktop-unavailable'
export type PresentationStatus = Omit<RuntimeSnapshot, 'code'> & {
  readonly code: PresentationCode | null
}

export type StartupScene = 'profile' | 'preparing' | 'recovery' | 'stopped'

export interface StartupPresentation {
  readonly scene: StartupScene
  readonly title: string
  readonly detail: string
  readonly diagnostic: PresentationCode | null
  readonly retained: boolean
  readonly actions: {
    readonly start: boolean
    readonly stop: boolean
    readonly recover: boolean
    readonly safeMode: boolean
  }
}

const labels: Record<RuntimeSnapshot['state'], readonly [string, string]> = {
  stopped: ['准备开始', '工作台尚未打开，你可以重新尝试。'],
  starting: ['正在准备你的工作台', '正在恢复最近的工作并连接本机服务。'],
  ready: ['工作台已就绪', '正在进入工作首页。'],
  stopping: ['正在安全关闭', '正在保存当前状态，请稍候。'],
  failed: ['工作区服务没有正常启动', '你的已有工作仍会保留，请按当前可用操作重试或安全恢复。'],
}

const recovery: Partial<Record<PresentationCode, string>> = {
  'runtime-unavailable': '运行组件暂时不可用。请确认安装完整后重新打开 DSH Work。',
  'cleanup-unconfirmed': '上一次关闭尚未确认完成。为保护已有工作，当前不会自动重试。',
  'forced-stop': '上一次关闭超时。清理完成后可以使用安全恢复。',
  'startup-timeout': '工作台准备超时。你可以重试，已有工作不会丢失。',
  'unexpected-exit': '工作台意外停止。清理完成后可以使用安全恢复，已有工作会保留。',
  'lifecycle-disconnected': '工作台连接已中断。清理完成后可以使用安全恢复，已有工作会保留。',
  'runtime-exit-failed': '工作台未能正常启动或关闭。清理完成后可以使用安全恢复。',
  'recovery-required': '上一次工作环境状态无法确认。可以安全启动一个隔离环境；原有数据不会被自动删除。',
  'guardian-unavailable': '桌面运行组件暂时不可用，请重新打开 DSH Work。',
  'desktop-unavailable': '桌面服务暂时不可用，请重新打开 DSH Work。',
}

export function presentStartup(
  status: PresentationStatus,
  choiceRequired: boolean,
  retained: boolean,
): StartupPresentation {
  const scene: StartupScene = choiceRequired
    ? 'profile'
    : status.state === 'failed'
      ? 'recovery'
      : status.state === 'stopped'
        ? 'stopped'
        : 'preparing'
  const [defaultTitle, defaultDetail] = labels[status.state]
  return Object.freeze({
    scene,
    title: scene === 'profile' ? '选择这次使用的工作环境' : defaultTitle,
    detail: status.code ? recovery[status.code] ?? defaultDetail : defaultDetail,
    diagnostic: status.code,
    retained,
    actions: Object.freeze({
      start: !choiceRequired && status.canStart,
      stop: status.canStop,
      recover: status.canRecover,
      safeMode: status.canRecover,
    }),
  })
}
