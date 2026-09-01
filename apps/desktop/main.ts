import { app, type BrowserWindow } from 'electron'

import { createGuardianClient, type GuardianClient } from '../../packages/runtime-guardian/client.ts'
import type { GuardianSnapshot } from '../../packages/runtime-guardian/protocol.ts'
import { createStatusWindow, registerDesktopScheme } from './window.ts'

registerDesktopScheme()
app.enableSandbox()
app.setName('DSH Work')

export let host: GuardianClient | undefined
export let window: BrowserWindow | undefined
let quitting = false
let allowQuit = false

const unavailableHost = (): GuardianClient => {
  let status: GuardianSnapshot = Object.freeze({
    state: 'stopped',
    code: null,
    canStart: true,
    canStop: false,
    canRecover: false,
  })
  const listeners = new Set<(snapshot: GuardianSnapshot) => void>()
  const publishUnavailable = async (): Promise<GuardianSnapshot> => {
    status = Object.freeze({
      state: 'failed',
      code: 'runtime-unavailable',
      canStart: true,
      canStop: false,
      canRecover: false,
    })
    for (const listener of [...listeners]) {
      try { listener(status) } catch {}
    }
    return status
  }
  return Object.freeze({
    start: publishUnavailable,
    stop: async () => status,
    recover: async () => status,
    snapshot: () => status,
    subscribe(listener: (snapshot: GuardianSnapshot) => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose: async () => true,
  })
}

const shutdown = async (): Promise<void> => {
  if (quitting) return
  quitting = true
  try { await host?.stop() } catch {}
  // IPC disconnect transfers the remaining bounded cleanup to the external
  // guardian, so Electron may exit even if its short acknowledgement wait ends.
  try { await host?.dispose() } catch {}
  allowQuit = true
  app.quit()
}

app.on('before-quit', event => {
  if (allowQuit || !host) return
  event.preventDefault()
  void shutdown()
})
app.on('window-all-closed', () => {
  if (!quitting) app.quit()
})

const primary = app.requestSingleInstanceLock()
if (!primary) app.quit()

// Do not await ready at module top level: Electron waits for ESM evaluation
// before emitting ready. Consumers may await desktop after their entry returns.
export const desktop = (primary ? app.whenReady().then(async () => {
  try {
    host = await createGuardianClient({
      node: process.env.DSH_WORK_NODE ?? '',
      productRoot: app.getPath('userData'),
    })
  } catch {
    host = unavailableHost()
  }
  window = await createStatusWindow(host, { accepting: () => !quitting })
  window.on('close', event => {
    if (!allowQuit) {
      event.preventDefault()
      void shutdown()
    }
  })
  window.webContents.on('render-process-gone', () => { void shutdown() })
  return { host, window }
}) : Promise.resolve({ host: null, window: null, secondary: true })).catch(async () => {
  // No arbitrary exception or private path is printed by desktop diagnostics.
  console.error('DSH Work desktop initialization failed')
  if (host) {
    await host.stop()
    await host.dispose()
  }
  app.exit(1)
})
