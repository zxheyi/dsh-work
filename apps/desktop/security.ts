import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'

import type { GuardianSnapshot } from '../../packages/runtime-guardian/protocol.ts'

export const STATUS_URL = 'dsh-work://status/index.html'
export const DESKTOP_ASSETS = ['index.html', 'renderer.js', 'style.css'] as const
export type DesktopAsset = typeof DESKTOP_ASSETS[number]

export interface StatusHost {
  start(): Promise<GuardianSnapshot> | GuardianSnapshot
  stop(): Promise<GuardianSnapshot> | GuardianSnapshot
  recover(): Promise<GuardianSnapshot> | GuardianSnapshot
  snapshot(): GuardianSnapshot
  subscribe(listener: (snapshot: GuardianSnapshot) => void): () => void
}

interface StatusBridgeOptions {
  readonly ipcMain: IpcMain
  readonly window: BrowserWindow
  readonly host: StatusHost
  readonly accepting?: () => boolean
}

export function resourceForRequest(url: string, method: string): DesktopAsset | null {
  if (method !== 'GET') return null
  const assets = new Map<string, DesktopAsset>(
    DESKTOP_ASSETS.map(file => [`dsh-work://status/${file}`, file]),
  )
  return assets.get(url) ?? null
}

export function bindStatusBridge({
  ipcMain,
  window,
  host,
  accepting = () => true,
}: StatusBridgeOptions): () => void {
  const contents = window.webContents
  const trusted = (event: IpcMainInvokeEvent): boolean =>
    !window.isDestroyed() && !contents.isDestroyed() && event.sender === contents &&
    event.senderFrame === contents.mainFrame && event.senderFrame?.url === STATUS_URL &&
    contents.getURL() === STATUS_URL
  const channels = ['start', 'stop', 'recover', 'snapshot'] as const
  for (const command of channels) {
    ipcMain.handle(`dsh-work:${command}`, (event, ...args) => {
      if (!trusted(event) || args.length || !accepting()) throw new Error('Request denied')
      return host[command]()
    })
  }
  const unsubscribe = host.subscribe(value => {
    if (!contents.isDestroyed() && contents.getURL() === STATUS_URL) {
      contents.send('dsh-work:status', value)
    }
  })
  return () => {
    unsubscribe()
    for (const command of channels) ipcMain.removeHandler(`dsh-work:${command}`)
  }
}
