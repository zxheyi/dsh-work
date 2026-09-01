import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRuntimeHost } from '../../packages/runtime-host/index.mjs'
import { createOfficialLauncher, prepareDevelopmentProfile } from '../../packages/runtime-host/official-launcher.mjs'
import { createStatusWindow, registerDesktopScheme } from './window.mjs'

registerDesktopScheme()
app.enableSandbox()
app.setName('DSH Work')
export let host, window
let quitting = false, allowQuit = false
const shutdown = async () => {
  if (quitting) return
  quitting = true
  const result = await host.stop()
  if (!result.canStart) {
    // Reaping is unconfirmed. Keep supervision and the window alive.
    quitting = false
    return
  }
  allowQuit = true
  app.quit()
}
app.on('before-quit', event => {
  if (allowQuit || !host) return
  event.preventDefault()
  void shutdown()
})
app.on('window-all-closed', () => { if (!quitting) app.quit() })

// Do not await ready at module top level: Electron waits for ESM evaluation
// before emitting ready. Consumers may await desktop after their entry returns.
export const desktop = app.whenReady().then(async () => {
  // Development-only home. Never import, overwrite or delete a user Harness home.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-development-'))
  prepareDevelopmentProfile(home)
  host = createRuntimeHost({ launch: createOfficialLauncher({ node: process.env.DSH_WORK_NODE, home }) })
  window = await createStatusWindow(host, { accepting: () => !quitting })
  window.on('close', event => {
    if (!allowQuit) { event.preventDefault(); void shutdown() }
  })
  window.webContents.on('render-process-gone', () => { void shutdown() })
  return { host, window }
}).catch(async () => {
  // No arbitrary exception or private path is printed by desktop diagnostics.
  console.error('DSH Work desktop initialization failed')
  if (host) await host.stop()
  app.exit(1)
})
