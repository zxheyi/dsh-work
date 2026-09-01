const { contextBridge, ipcRenderer } = require('electron')

// Deliberately no invoke(channel), event object, path, URL, shell or file API.
contextBridge.exposeInMainWorld('dshWork', Object.freeze({
  start: () => ipcRenderer.invoke('dsh-work:start'),
  stop: () => ipcRenderer.invoke('dsh-work:stop'),
  snapshot: () => ipcRenderer.invoke('dsh-work:snapshot'),
  subscribe: listener => {
    if (typeof listener !== 'function') throw new TypeError('listener required')
    const receive = (_event, status) => listener(status)
    ipcRenderer.on('dsh-work:status', receive)
    return () => ipcRenderer.removeListener('dsh-work:status', receive)
  },
}))
