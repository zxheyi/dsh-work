import { BrowserWindow, ipcMain, protocol, session, type IpcMainEvent } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  bindStatusBridge,
  isAllowedDesktopNavigation,
  resourceForRequest,
  STATUS_URL,
  type DesktopAsset,
  type StatusHost,
} from './security.ts'
import { validDesktopSurfaceUrl } from '../../packages/runtime-host/index.ts'
import type { GuardianClient } from '../../packages/runtime-guardian/client.ts'
import {
  parseWorkRecoveryContext,
  serializeWorkRecoveryContext,
} from '../../packages/work-api/recovery-context.ts'

interface StatusWindowOptions {
  readonly accepting?: () => boolean
}

const root = path.dirname(fileURLToPath(import.meta.url))

export function registerDesktopScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: 'dsh-work',
    privileges: { standard: true, secure: true },
  }])
}

export async function createDesktopWindow(
  host: StatusHost & Pick<GuardianClient, 'subscribeSurface'>,
  { accepting = () => true }: StatusWindowOptions = {},
): Promise<BrowserWindow> {
  const isolated = session.fromPartition('dsh-work-shell')
  isolated.setPermissionRequestHandler((_contents, _permission, done) => done(false))
  isolated.setPermissionCheckHandler(() => false)
  isolated.on('will-download', event => event.preventDefault())
  isolated.protocol.handle('dsh-work', request => {
    const resource = resourceForRequest(request.url, request.method)
    if (!resource) return new Response('Not found', { status: 404 })
    const types: Record<DesktopAsset, string> = {
      'index.html': 'text/html',
      'renderer.js': 'text/javascript',
      'style.css': 'text/css',
    }
    const body = new Uint8Array(fs.readFileSync(path.join(root, resource)))
    return new Response(body, { headers: {
      'Content-Type': `${types[resource]}; charset=utf-8`,
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
    } })
  })
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 680,
    title: 'DSH Work',
    backgroundColor: '#f5f4f0',
    show: false,
    webPreferences: {
      session: isolated,
      preload: path.join(root, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: false,
    },
  })
  window.setMenu(null)
  const contents = window.webContents
  let status = host.snapshot()
  let pendingSurface: string | null = null
  let surfaceOrigin: string | null = null
  let retainedContext: string | null = null
  let navigation = 0
  const captureContext = async (): Promise<void> => {
    if (!surfaceOrigin || contents.isDestroyed()) return
    try {
      const candidate = await contents.executeJavaScript(
        'typeof window.name === "string" ? window.name : ""',
        true,
      ) as unknown
      const parsed = parseWorkRecoveryContext(candidate)
      if (parsed) retainedContext = serializeWorkRecoveryContext(parsed)
    } catch {}
  }
  const provideRecoveryContext = (event: IpcMainEvent, ...args: unknown[]): void => {
    const frame = event.senderFrame
    const url = frame?.url
    const trusted = !args.length && !contents.isDestroyed() && event.sender === contents
      && !!frame && !frame.parent
      && (url === STATUS_URL || (!!url && isAllowedDesktopNavigation(url, surfaceOrigin)))
    event.returnValue = trusted ? retainedContext ?? '' : ''
  }
  const updateRecoveryContext = (event: IpcMainEvent, candidate: unknown, ...extra: unknown[]): void => {
    const frame = event.senderFrame
    if (extra.length || contents.isDestroyed() || event.sender !== contents || !frame || frame.parent) return
    const url = frame.url
    if (!url || !isAllowedDesktopNavigation(url, surfaceOrigin)) return
    if (candidate === '') {
      retainedContext = null
      return
    }
    const parsed = parseWorkRecoveryContext(candidate)
    if (parsed) retainedContext = serializeWorkRecoveryContext(parsed)
  }
  ipcMain.on('dsh-work:recovery-context', provideRecoveryContext)
  ipcMain.on('dsh-work:recovery-context-update', updateRecoveryContext)
  const showStatus = async (): Promise<void> => {
    const sequence = ++navigation
    await captureContext()
    if (sequence !== navigation) return
    surfaceOrigin = null
    if (contents.isDestroyed() || contents.getURL() === STATUS_URL) return
    try {
      await window.loadURL(STATUS_URL)
    } catch {}
    if (sequence !== navigation) return
  }
  const showSurface = async (url: string): Promise<void> => {
    if (!validDesktopSurfaceUrl(url) || status.state !== 'ready' || !accepting()) return
    const sequence = ++navigation
    surfaceOrigin = new URL(url).origin
    try {
      await window.loadURL(url)
    } catch {
      if (sequence === navigation) await showStatus()
    }
  }
  const unsubscribeSurface = host.subscribeSurface(url => {
    if (!validDesktopSurfaceUrl(url)) return
    pendingSurface = url
    if (status.state === 'ready') void showSurface(url)
  })
  const unsubscribeStatus = host.subscribe(value => {
    status = value
    if (!accepting()) return
    if (value.state === 'ready' && pendingSurface) void showSurface(pendingSurface)
    else if (value.state === 'failed' || value.state === 'stopped') {
      pendingSurface = null
      void showStatus()
    }
  })
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedDesktopNavigation(url, surfaceOrigin)) event.preventDefault()
  })
  contents.on('will-frame-navigate', details => {
    if (!isAllowedDesktopNavigation(details.url, surfaceOrigin)) details.preventDefault()
  })
  contents.on('will-attach-webview', event => event.preventDefault())
  const dispose = bindStatusBridge({ ipcMain, window, host, accepting })
  window.on('closed', () => {
    unsubscribeSurface()
    unsubscribeStatus()
    dispose()
    ipcMain.removeListener('dsh-work:recovery-context', provideRecoveryContext)
    ipcMain.removeListener('dsh-work:recovery-context-update', updateRecoveryContext)
    isolated.protocol.unhandle('dsh-work')
  })
  await window.loadURL(STATUS_URL)
  window.show()
  return window
}
