import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'

import { RUNTIME_COMMANDS, type RuntimeControl } from '../../packages/runtime-contract/index.ts'
import type { DesktopStartupContext, RuntimeStatus } from './contracts.ts'

export const STATUS_URL = 'dsh-work://status/index.html'
export const DESKTOP_ASSETS = ['index.html', 'renderer.js', 'style.css'] as const
export type DesktopAsset = typeof DESKTOP_ASSETS[number]

export type StatusHost = RuntimeControl

export function isAllowedDesktopNavigation(url: string, surfaceOrigin: string | null): boolean {
  if (url === STATUS_URL) return true
  if (!surfaceOrigin) return false
  try {
    const target = new URL(url)
    const allowed = new URL(surfaceOrigin)
    return allowed.href === allowed.origin + '/' && allowed.protocol === 'http:' &&
      allowed.hostname === '127.0.0.1' && allowed.port !== '' &&
      target.origin === allowed.origin && target.username === '' && target.password === ''
  } catch {
    return false
  }
}

interface StatusBridgeOptions {
  readonly ipcMain: IpcMain
  readonly window: BrowserWindow
  readonly host: StatusHost
  readonly accepting?: () => boolean
  readonly startup?: {
    snapshot(): DesktopStartupContext
    select(profileId: string | null): Promise<RuntimeStatus>
  }
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
  startup,
}: StatusBridgeOptions): () => void {
  const contents = window.webContents
  const trusted = (event: IpcMainInvokeEvent): boolean =>
    !window.isDestroyed() && !contents.isDestroyed() && event.sender === contents &&
    event.senderFrame === contents.mainFrame && event.senderFrame?.url === STATUS_URL &&
    contents.getURL() === STATUS_URL
  for (const command of RUNTIME_COMMANDS) {
    ipcMain.handle(`dsh-work:${command}`, (event, ...args) => {
      if (!trusted(event) || args.length || !accepting()
        || (command === 'start' && startup?.snapshot().choiceRequired)) throw new Error('Request denied')
      return host[command]()
    })
  }
  ipcMain.handle('dsh-work:startup', (event, ...args) => {
    if (!trusted(event) || args.length || !accepting() || !startup) throw new Error('Request denied')
    return startup.snapshot()
  })
  ipcMain.handle('dsh-work:select-profile', (event, profileId: unknown, ...args) => {
    if (!trusted(event) || args.length || !accepting() || !startup
      || (profileId !== null && (typeof profileId !== 'string' || !/^[a-f0-9]{24}$/u.test(profileId)))) {
      throw new Error('Request denied')
    }
    return startup.select(profileId)
  })
  const unsubscribe = host.subscribe(value => {
    if (!contents.isDestroyed() && contents.getURL() === STATUS_URL) {
      contents.send('dsh-work:status', value)
    }
  })
  return () => {
    unsubscribe()
    for (const command of RUNTIME_COMMANDS) ipcMain.removeHandler(`dsh-work:${command}`)
    ipcMain.removeHandler('dsh-work:startup')
    ipcMain.removeHandler('dsh-work:select-profile')
  }
}
