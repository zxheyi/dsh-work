import electron = require('electron')

type RuntimeStatus = import('./contracts.ts').RuntimeStatus

const { contextBridge, ipcRenderer } = electron

const retained = ipcRenderer.sendSync('dsh-work:recovery-context') as unknown
const boundedRetained = typeof retained === 'string'
  && retained.startsWith('dsh-work-recovery:v1:')
  && retained.length <= 32 * 1024 ? retained : ''

// Deliberately no invoke(channel), event object, path, URL, shell or file API.
if (globalThis.location.href === 'dsh-work://status/index.html') contextBridge.exposeInMainWorld('dshWork', Object.freeze({
  hasRetainedContext: boundedRetained.length > 0,
  start: (): Promise<RuntimeStatus> => ipcRenderer.invoke('dsh-work:start'),
  stop: (): Promise<RuntimeStatus> => ipcRenderer.invoke('dsh-work:stop'),
  recover: (): Promise<RuntimeStatus> => ipcRenderer.invoke('dsh-work:recover'),
  snapshot: (): Promise<RuntimeStatus> => ipcRenderer.invoke('dsh-work:snapshot'),
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
      && (!value.startsWith('dsh-work-recovery:v1:') || value.length > 32 * 1024))) return
    ipcRenderer.send('dsh-work:recovery-context-update', value)
  },
}))
