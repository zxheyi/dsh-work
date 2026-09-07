import { presentStartup, type PresentationStatus } from './startup-presentation.ts'

const MAX_RECOVERY_CONTEXT_BYTES = 64 * 1024

const element = <T extends HTMLElement>(id: string): T => {
  const value = document.getElementById(id)
  if (!value) throw new Error(`missing desktop element: ${id}`)
  return value as T
}

const start = element<HTMLButtonElement>('start')
const stop = element<HTMLButtonElement>('stop')
const recover = element<HTMLButtonElement>('recover')
const safeMode = element<HTMLButtonElement>('safe-mode')
const onboarding = element<HTMLElement>('onboarding')
const profileChoice = element<HTMLSelectElement>('profile-choice')
const profileOptions = element<HTMLElement>('profile-options')
const useLocal = element<HTMLButtonElement>('use-local')
const useIsolated = element<HTMLButtonElement>('use-isolated')
const retained = element<HTMLElement>('retained')
const hasRetainedContext = window.dshWork.hasRetainedContext
  || (typeof window.name === 'string' && window.name.startsWith('dsh-work-recovery:v1:')
    && window.name.length <= MAX_RECOVERY_CONTEXT_BYTES)
retained.hidden = !hasRetainedContext

const render = (value: PresentationStatus): void => {
  latestStatus = value
  const presentation = presentStartup(value, choiceRequired, hasRetainedContext)
  document.body.dataset.state = value.state
  document.body.dataset.scene = presentation.scene
  onboarding.hidden = presentation.scene !== 'profile'
  element('state').textContent = presentation.title
  element('detail').textContent = presentation.detail
  element('indicator').dataset.state = value.state
  const diagnostic = element('diagnostic')
  diagnostic.hidden = !presentation.diagnostic
  diagnostic.textContent = presentation.diagnostic ?? ''
  retained.hidden = !presentation.retained
  start.disabled = !presentation.actions.start
  stop.disabled = !presentation.actions.stop
  recover.hidden = !presentation.actions.recover
  recover.disabled = !presentation.actions.recover
  safeMode.hidden = !presentation.actions.safeMode
  safeMode.disabled = !presentation.actions.safeMode
  start.textContent = presentation.actions.recover
    ? '等待安全恢复'
    : presentation.scene === 'recovery' ? '重试打开' : '打开工作台'
}

const disconnected = (): void => render({
  state: 'failed',
  code: 'desktop-unavailable',
  canStart: false,
  canStop: false,
  canRecover: false,
})

let choiceRequired = false
let latestStatus: PresentationStatus | null = null
const finishChoice = (value: PresentationStatus): void => {
  choiceRequired = false
  useLocal.disabled = true
  useIsolated.disabled = true
  render(value)
}

const selectProfileCard = (profileId: string): void => {
  profileChoice.value = profileId
  for (const candidate of profileOptions.querySelectorAll<HTMLButtonElement>('.profile-card')) {
    const selected = candidate.dataset.profileId === profileId
    candidate.classList.toggle('is-selected', selected)
    candidate.setAttribute('aria-checked', String(selected))
  }
  useLocal.disabled = false
}

window.dshWork.startup().then(context => {
  choiceRequired = context.choiceRequired
  if (!choiceRequired) {
    if (latestStatus) render(latestStatus)
    return
  }
  profileChoice.replaceChildren()
  profileOptions.replaceChildren()
  context.profiles.forEach((profile, index) => {
    const option = document.createElement('option')
    option.value = profile.id
    option.textContent = profile.name
    profileChoice.append(option)
    const card = document.createElement('button')
    card.type = 'button'
    card.className = `profile-card${index === 0 ? ' is-selected' : ''}`
    card.dataset.profileId = profile.id
    card.setAttribute('role', 'radio')
    card.setAttribute('aria-checked', String(index === 0))
    const radio = document.createElement('span')
    radio.className = 'profile-radio'
    radio.setAttribute('aria-hidden', 'true')
    const copy = document.createElement('span')
    copy.className = 'profile-copy'
    const name = document.createElement('strong')
    name.textContent = `继续使用“${profile.name}”配置`
    const description = document.createElement('small')
    description.textContent = `沿用 ${context.homeLabel} 中已有的设置和工作记录`
    copy.append(name, description)
    const meta = document.createElement('span')
    meta.className = 'profile-meta'
    meta.textContent = index === 0 ? '建议使用' : '已有配置'
    card.append(radio, copy, meta)
    card.addEventListener('click', () => selectProfileCard(profile.id))
    profileOptions.append(card)
  })
  useLocal.disabled = context.profiles.length === 0
  start.disabled = true
  if (latestStatus) render(latestStatus)
}).catch(disconnected)

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
start.addEventListener('click', () => {
  if (!choiceRequired) window.dshWork.start().catch(disconnected)
})
stop.addEventListener('click', () => { window.dshWork.stop().catch(disconnected) })
recover.addEventListener('click', () => { window.dshWork.recover().catch(disconnected) })
safeMode.addEventListener('click', () => { window.dshWork.safeMode().catch(disconnected) })
useLocal.addEventListener('click', () => {
  const profileId = profileChoice.value
  if (!/^[a-f0-9]{24}$/u.test(profileId)) return
  useLocal.disabled = true
  useIsolated.disabled = true
  window.dshWork.selectProfile(profileId).then(finishChoice).catch(disconnected)
})
useIsolated.addEventListener('click', () => {
  useLocal.disabled = true
  useIsolated.disabled = true
  window.dshWork.selectProfile(null).then(finishChoice).catch(disconnected)
})
