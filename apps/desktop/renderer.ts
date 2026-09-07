type PresentationCode = DshWorkRuntimeCode | 'desktop-unavailable'
type PresentationStatus = Omit<DshWorkRuntimeStatus, 'code'> & { readonly code: PresentationCode | null }
const MAX_RECOVERY_CONTEXT_BYTES = 64 * 1024

const labels: Record<DshWorkRuntimeState, readonly [string, string]> = {
  stopped: ['准备开始', '工作台尚未打开，你可以重新尝试。'],
  starting: ['正在打开 DSH Work', '正在恢复最近的工作并准备你的工作台。'],
  ready: ['工作台已就绪', '正在进入工作首页。'],
  stopping: ['正在安全关闭', '正在保存当前状态，请稍候。'],
  failed: ['暂时无法打开', '你的已有工作仍会保留，请按当前可用操作重试或安全恢复。'],
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
}

const element = <T extends HTMLElement>(id: string): T => {
  const value = document.getElementById(id)
  if (!value) throw new Error(`missing desktop element: ${id}`)
  return value as T
}

const start = element<HTMLButtonElement>('start')
const stop = element<HTMLButtonElement>('stop')
const recover = element<HTMLButtonElement>('recover')
const retained = element<HTMLElement>('retained')
retained.hidden = !(window.dshWork.hasRetainedContext
  || (typeof window.name === 'string' && window.name.startsWith('dsh-work-recovery:v1:')
    && window.name.length <= MAX_RECOVERY_CONTEXT_BYTES))

const render = (value: PresentationStatus): void => {
  const [label, detail] = labels[value.state]
  document.body.dataset.state = value.state
  element('state').textContent = label
  element('detail').textContent = value.code ? recovery[value.code] ?? detail : detail
  element('indicator').dataset.state = value.state
  const diagnostic = element('diagnostic')
  diagnostic.hidden = !value.code
  diagnostic.textContent = value.code ?? ''
  start.disabled = !value.canStart
  stop.disabled = !value.canStop
  recover.hidden = !value.canRecover
  recover.disabled = !value.canRecover
  start.textContent = value.canRecover ? '等待安全恢复' : value.state === 'failed' ? '重试打开' : '打开工作台'
}

const disconnected = (): void => render({
  state: 'failed',
  code: 'desktop-unavailable',
  canStart: false,
  canStop: false,
  canRecover: false,
})

// Subscribe before reading initial state; command responses are intentionally
// ignored because a newer subscription event may already have arrived.
let receivedLiveStatus = false
window.dshWork.subscribe(value => {
  receivedLiveStatus = true
  render(value)
})
window.dshWork.snapshot().then(value => {
  if (!receivedLiveStatus) render(value)
}).catch(() => {
  if (!receivedLiveStatus) disconnected()
})
start.addEventListener('click', () => { window.dshWork.start().catch(disconnected) })
stop.addEventListener('click', () => { window.dshWork.stop().catch(disconnected) })
recover.addEventListener('click', () => { window.dshWork.recover().catch(disconnected) })
