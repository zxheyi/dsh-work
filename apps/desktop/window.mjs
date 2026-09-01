import { BrowserWindow, ipcMain, protocol, session } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bindStatusBridge, resourceForRequest, STATUS_URL } from './security.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
export function registerDesktopScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: 'dsh-work', privileges: { standard: true, secure: true } }])
}

export async function createStatusWindow(host, { accepting = () => true } = {}) {
  const isolated = session.fromPartition('dsh-work-status')
  isolated.setPermissionRequestHandler((_contents, _permission, done) => done(false))
  isolated.setPermissionCheckHandler(() => false)
  isolated.on('will-download', event => event.preventDefault())
  isolated.protocol.handle('dsh-work', request => {
    const resource = resourceForRequest(request.url, request.method)
    if (!resource) return new Response('Not found', { status: 404 })
    const types = { 'index.html': 'text/html', 'renderer.js': 'text/javascript', 'style.css': 'text/css' }
    return new Response(fs.readFileSync(path.join(root, resource)), { headers: {
      'Content-Type': `${types[resource]}; charset=utf-8`,
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
    } })
  })
  const window = new BrowserWindow({ width: 900, height: 680, minWidth: 680, minHeight: 580,
    title: 'DSH Work · Runtime', backgroundColor: '#f5f4f0', show: false,
    webPreferences: { session: isolated, preload: path.join(root, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false,
      webSecurity: true, allowRunningInsecureContent: false, devTools: false },
  })
  window.setMenu(null)
  const contents = window.webContents
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', event => event.preventDefault())
  contents.on('will-frame-navigate', event => event.preventDefault())
  contents.on('will-attach-webview', event => event.preventDefault())
  const dispose = bindStatusBridge({ ipcMain, window, host, accepting })
  window.on('closed', () => { dispose(); isolated.protocol.unhandle('dsh-work') })
  await window.loadURL(STATUS_URL)
  window.show()
  return window
}
