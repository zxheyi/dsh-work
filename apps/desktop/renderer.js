const labels = {
  stopped: ['已停止', '运行时尚未启动。点击启动，在隔离的开发 Profile 中运行 Harness。'],
  starting: ['正在启动', '正在启动官方 CLI，等待 Harness 完成原生插件初始化。'],
  ready: ['运行就绪', 'Harness 已确认 Ready。可以停止并再次启动，验证生命周期闭环。'],
  stopping: ['正在停止', '已发送 EOF，等待 Harness 释放插件并退出；超时将报告清理异常。'],
  failed: ['运行异常', '本次运行未能正常完成。确认资源已回收后，可以重试。'],
}
const recovery = {
  'runtime-unavailable': '未找到匹配的独立运行时。请按开发说明配置 DSH_WORK_NODE 后重启桌面。',
  'cleanup-unconfirmed': '无法确认子进程已回收，暂时禁止重启。请检查宿主进程状态。',
  'forced-stop': '停止超时，已强制结束直接子进程；这不代表完整进程树已回收。',
  'startup-timeout': '启动超时。请检查隔离 Profile 与已锁定运行时后重试。',
  'unexpected-exit': 'Harness 意外退出。待直接子进程及管道关闭后可重试；完整进程树清理尚未验证。',
  'lifecycle-disconnected': '与 Harness 的生命周期通道断开。待直接子进程关闭后可重试；完整进程树清理尚未验证。',
  'runtime-exit-failed': 'Harness 启动或退出失败。请检查隔离 Profile，待直接子进程关闭后重试。',
}
const start = document.getElementById('start'), stop = document.getElementById('stop')
const render = value => {
  const [label, detail] = labels[value.state] || labels.failed
  document.body.dataset.state = value.state
  document.getElementById('state').textContent = label
  document.getElementById('detail').textContent = recovery[value.code] || detail
  document.getElementById('indicator').dataset.state = value.state
  const diagnostic = document.getElementById('diagnostic')
  diagnostic.hidden = !value.code
  diagnostic.textContent = value.code || ''
  start.disabled = !value.canStart
  stop.disabled = !value.canStop
  start.textContent = value.state === 'failed' ? '重试启动' : '启动 Harness'
}
const disconnected = () => render({ state: 'failed', code: 'desktop-unavailable', canStart: false, canStop: false })
// Subscribe before reading initial state; command responses are intentionally
// ignored because a newer subscription event may already have arrived.
let receivedLiveStatus = false
window.dshWork.subscribe(value => { receivedLiveStatus = true; render(value) })
window.dshWork.snapshot().then(value => { if (!receivedLiveStatus) render(value) }).catch(() => {
  if (!receivedLiveStatus) disconnected()
})
start.addEventListener('click', () => { window.dshWork.start().catch(disconnected) })
stop.addEventListener('click', () => { window.dshWork.stop().catch(disconnected) })
