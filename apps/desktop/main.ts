import { app, type BrowserWindow } from 'electron'

import { createGuardianClient, type GuardianClient } from '../../packages/runtime-guardian/client.ts'
import { createUnavailableGuardianClient } from '../../packages/runtime-guardian/unavailable-client.ts'
import { createStatusWindow, registerDesktopScheme } from './window.ts'

registerDesktopScheme()
app.enableSandbox()
app.setName('DSH Work')

export interface DesktopSession {
  readonly host: GuardianClient
  readonly window: BrowserWindow
}

interface SecondaryDesktopSession {
  readonly host: null
  readonly window: null
  readonly secondary: true
}

let session: DesktopSession | undefined
let quitting = false
let allowQuit = false

const shutdown = async (): Promise<void> => {
  if (quitting) return
  quitting = true
  try { await session?.host.stop() } catch {}
  // IPC disconnect transfers the remaining bounded cleanup to the external
  // guardian, so Electron may exit even if its short acknowledgement wait ends.
  try { await session?.host.dispose() } catch {}
  allowQuit = true
  app.quit()
}

app.on('before-quit', event => {
  if (allowQuit || !session) return
  event.preventDefault()
  void shutdown()
})
app.on('window-all-closed', () => {
  if (!quitting) app.quit()
})

const primary = app.requestSingleInstanceLock()
if (!primary) app.quit()

const createDesktopSession = async (): Promise<DesktopSession> => {
  let host: GuardianClient
  try {
    host = await createGuardianClient({
      node: process.env.DSH_WORK_NODE ?? '',
      productRoot: app.getPath('userData'),
    })
  } catch {
    host = createUnavailableGuardianClient()
  }
  try {
    const window = await createStatusWindow(host, { accepting: () => !quitting })
    const active = Object.freeze({ host, window })
    session = active
    window.on('close', event => {
      if (!allowQuit) {
        event.preventDefault()
        void shutdown()
      }
    })
    window.webContents.on('render-process-gone', () => { void shutdown() })
    return active
  } catch (error: unknown) {
    try { await host.stop() } catch {}
    try { await host.dispose() } catch {}
    throw error
  }
}

// Do not await ready at module top level: Electron waits for ESM evaluation
// before emitting ready. Consumers may await desktop after their entry returns.
export const desktop: Promise<DesktopSession | SecondaryDesktopSession | void> = (primary
  ? app.whenReady().then(createDesktopSession)
  : Promise.resolve(Object.freeze({ host: null, window: null, secondary: true } as const))).catch(() => {
  // No arbitrary exception or private path is printed by desktop diagnostics.
  console.error('DSH Work desktop initialization failed')
  app.exit(1)
})
