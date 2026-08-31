export const STATUS_URL = 'dsh-work://status/index.html'

export function resourceForRequest(url, method) {
  if (method !== 'GET') return null
  const assets = new Map(['index.html', 'renderer.js', 'style.css'].map(file => [`dsh-work://status/${file}`, file]))
  return assets.get(url) || null
}

export function bindStatusBridge({ ipcMain, window, host, accepting = () => true }) {
  const contents = window.webContents
  const trusted = event => !window.isDestroyed() && !contents.isDestroyed() &&
    event.sender === contents && event.senderFrame === contents.mainFrame &&
    event.senderFrame?.url === STATUS_URL && contents.getURL() === STATUS_URL
  const channels = ['start', 'stop', 'snapshot']
  for (const command of channels) {
    ipcMain.handle(`dsh-work:${command}`, (event, ...args) => {
      if (!trusted(event) || args.length || !accepting()) throw new Error('Request denied')
      return host[command]()
    })
  }
  const unsubscribe = host.subscribe(value => {
    if (!contents.isDestroyed() && contents.getURL() === STATUS_URL) contents.send('dsh-work:status', value)
  })
  return () => {
    unsubscribe()
    for (const command of channels) ipcMain.removeHandler(`dsh-work:${command}`)
  }
}
