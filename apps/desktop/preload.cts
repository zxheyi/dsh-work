import electron = require('electron')

type RuntimeStatus = import('./contracts.ts').RuntimeStatus
type DesktopStartupContext = import('./contracts.ts').DesktopStartupContext

const { contextBridge, ipcRenderer } = electron
const MAX_RECOVERY_CONTEXT_BYTES = 64 * 1024

const retained = ipcRenderer.sendSync('dsh-work:recovery-context') as unknown
const boundedRetained = typeof retained === 'string'
  && retained.startsWith('dsh-work-recovery:v1:')
  && retained.length <= MAX_RECOVERY_CONTEXT_BYTES ? retained : ''

// Deliberately no invoke(channel), event object, path, URL, shell or file API.
if (globalThis.location.href === 'dsh-work://status/index.html') contextBridge.exposeInMainWorld('dshWork', Object.freeze({
  hasRetainedContext: boundedRetained.length > 0,
  start: (): Promise<RuntimeStatus> => ipcRenderer.invoke('dsh-work:start'),
  stop: (): Promise<RuntimeStatus> => ipcRenderer.invoke('dsh-work:stop'),
  recover: (): Promise<RuntimeStatus> => ipcRenderer.invoke('dsh-work:recover'),
  snapshot: (): Promise<RuntimeStatus> => ipcRenderer.invoke('dsh-work:snapshot'),
  startup: (): Promise<DesktopStartupContext> => ipcRenderer.invoke('dsh-work:startup'),
  selectProfile: (profileId: string | null): Promise<RuntimeStatus> => {
    if (profileId !== null && (typeof profileId !== 'string' || !/^[a-f0-9]{24}$/u.test(profileId))) {
      return Promise.reject(new TypeError('invalid profile choice'))
    }
    return ipcRenderer.invoke('dsh-work:select-profile', profileId)
  },
  subscribe: (listener: (status: RuntimeStatus) => void): (() => void) => {
    if (typeof listener !== 'function') throw new TypeError('listener required')
    const receive = (_event: Electron.IpcRendererEvent, status: RuntimeStatus): void => listener(status)
    ipcRenderer.on('dsh-work:status', receive)
    return () => ipcRenderer.removeListener('dsh-work:status', receive)
  },
}))
else if (globalThis.location.protocol === 'http:' && globalThis.location.hostname === '127.0.0.1'
  && globalThis.location.port !== '') contextBridge.exposeInMainWorld('dshWorkRecovery', Object.freeze({
  read: (): string => boundedRetained,
  update: (value: unknown): void => {
    if (typeof value !== 'string' || (value !== ''
      && (!value.startsWith('dsh-work-recovery:v1:') || value.length > MAX_RECOVERY_CONTEXT_BYTES))) return
    ipcRenderer.send('dsh-work:recovery-context-update', value)
  },
}))
