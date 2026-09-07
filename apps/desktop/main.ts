import { app, Menu, nativeImage, Tray, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'

import { createGuardianClient, type GuardianClient } from '../../packages/runtime-guardian/client.ts'
import { createUnavailableGuardianClient } from '../../packages/runtime-guardian/unavailable-client.ts'
import { discoverLocalProfiles, publicProfileCatalog } from '../../packages/runtime-profile/discovery.ts'
import {
  readStartupSelection,
  writeStartupSelection,
  type StartupSelection,
} from '../../packages/runtime-profile/preferences.ts'
import type { DesktopStartupContext } from './contracts.ts'
import { windowCloseAction } from './close-policy.ts'
import { resolveDesktopNodePath } from './runtime-paths.ts'
import { createDesktopTray, type DesktopTrayController } from './tray.ts'
import { createDesktopWindow, registerDesktopScheme } from './window.ts'

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
let tray: DesktopTrayController | undefined

const revealWindow = (): void => {
  const window = session?.window
  if (!window || window.isDestroyed()) return
  window.show()
  window.focus()
}

app.on('activate', revealWindow)
app.on('second-instance', revealWindow)

const shutdown = async (): Promise<void> => {
  if (quitting) return
  quitting = true
  try { await session?.host.stop() } catch {}
  // IPC disconnect transfers the remaining bounded cleanup to the external
  // guardian, so Electron may exit even if its short acknowledgement wait ends.
  try { await session?.host.dispose() } catch {}
  tray?.dispose()
  tray = undefined
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
  const productRoot = app.getPath('userData')
  const catalog = discoverLocalProfiles({ environment: process.env, userHome: app.getPath('home') })
  const publicCatalog = publicProfileCatalog(catalog)
  const persisted = readStartupSelection(productRoot)
  let selection: StartupSelection | null = persisted?.kind === 'shared'
    && !catalog.profiles.some(profile => profile.id === persisted.profileId
      && profile.name === persisted.profileName && profile.homePath === persisted.homePath)
    ? null : persisted
  if (!selection && catalog.profiles.length === 0) {
    selection = Object.freeze({ kind: 'isolated' })
    writeStartupSelection(productRoot, selection)
  }
  let host: GuardianClient
  try {
    host = await createGuardianClient({
      node: resolveDesktopNodePath({
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        platform: process.platform,
        environment: process.env,
      }),
      productRoot,
    })
  } catch {
    host = createUnavailableGuardianClient()
  }
  try {
    const startup = {
      snapshot(): DesktopStartupContext {
        return Object.freeze({
          ...publicCatalog,
          choiceRequired: selection === null,
          selected: selection?.kind === 'shared' ? selection.profileId : selection?.kind ?? null,
        })
      },
      async select(profileId: string | null) {
        if (selection || host.snapshot().state !== 'stopped') throw new Error('Startup choice unavailable')
        const next: StartupSelection = profileId === null
          ? Object.freeze({ kind: 'isolated' })
          : (() => {
            const profile = catalog.profiles.find(candidate => candidate.id === profileId)
            if (!profile) throw new Error('Startup choice unavailable')
            return Object.freeze({
              kind: 'shared' as const,
              profileId: profile.id,
              profileName: profile.name,
              homePath: profile.homePath,
            })
          })()
        writeStartupSelection(productRoot, next)
        selection = next
        return host.start()
      },
    }
    const window = await createDesktopWindow(host, { accepting: () => !quitting, startup })
    const active = Object.freeze({ host, window })
    session = active
    const icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="9" fill="#315cf4"/><path d="M8 9l4 14 4-9 4 9 4-14" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    ).toString('base64')}`)
    tray = createDesktopTray({
      tray: new Tray(icon.resize({ width: 18, height: 18 })),
      window,
      host,
      buildMenu: entries => Menu.buildFromTemplate(entries.map(entry => ({ ...entry })) as MenuItemConstructorOptions[]),
      quit: () => { void shutdown() },
    })
    window.on('close', event => {
      if (windowCloseAction(allowQuit, host.active()) === 'hide') {
        event.preventDefault()
        window.hide()
      } else if (!allowQuit) {
        event.preventDefault()
        void shutdown()
      }
    })
    window.webContents.on('render-process-gone', () => { void shutdown() })
    setImmediate(() => {
      if (!quitting && !startup.snapshot().choiceRequired) void host.start().catch(() => {})
    })
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
