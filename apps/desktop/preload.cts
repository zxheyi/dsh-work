import electron = require('electron')

type RuntimeStatus = import('./contracts.ts').RuntimeStatus

const { contextBridge, ipcRenderer } = electron

// Deliberately no invoke(channel), event object, path, URL, shell or file API.
contextBridge.exposeInMainWorld('dshWork', Object.freeze({
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
