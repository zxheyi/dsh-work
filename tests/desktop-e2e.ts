// Explicit Electron entry point; never imported by headless unit tests.
import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import type { DesktopSession } from '../apps/desktop/main.ts'
import { inspectNativeSurfaceCopy } from './support/native-surface-copy.ts'

const missing = process.argv.includes('--missing-runtime')
const rendererCrash = process.argv.includes('--renderer-crash')
const name = missing ? 'missing' : rendererCrash ? 'renderer-crash' : 'normal'
const output = path.resolve('artifacts/desktop', name)
fs.mkdirSync(output, { recursive: true })
const reportPath = path.join(output, 'result.json')
let phase = 'boot'
const write = (status: 'pass' | 'fail', extra: Record<string, unknown> = {}): void => fs.writeFileSync(reportPath, JSON.stringify({ status, phase,
  runId: process.env.DSH_WORK_E2E_RUN_ID,
  platform: process.platform, arch: process.arch, electron: process.versions.electron, ...extra }, null, 2))
write('fail')
const progress = setInterval(() => write('fail'), 250)
const userData = process.env.DSH_WORK_E2E_USER_DATA
assert.ok(userData)
app.setPath('userData', userData)
app.commandLine.appendSwitch('disable-background-networking')
if (missing) process.env.DSH_WORK_NODE = path.join(output, 'deliberately-missing-node')
const emittedDesktopEntry: string = '../dist/apps/desktop/main.js'
const { desktop } = await import(emittedDesktopEntry) as {
  desktop: Promise<DesktopSession>
}
let host: DesktopSession['host'] | null = null
async function run(): Promise<void> {
try {
  const active = await desktop
  host = active.host
  const js = <T = unknown>(source: string): Promise<T> => active.window.webContents.executeJavaScript(source) as Promise<T>
  const waitState = async (state: string): Promise<void> => {
    const deadline = Date.now() + 35_000
    while (Date.now() < deadline) {
      if (await js('document.body.dataset.state') === state) return
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    throw new Error('state timeout')
  }
  const waitForNativeSurface = async (): Promise<{ readonly text: string; readonly url: string }> => {
    const deadline = Date.now() + 35_000
    while (Date.now() < deadline) {
      try {
        const value = await js<{ ready: boolean; text: string }>(`(() => {
          for (const label of ['继续', '稍后配置']) {
            const button = Array.from(document.querySelectorAll('button'))
              .find(item => item.textContent?.trim() === label)
            if (button instanceof HTMLButtonElement) button.click()
          }
          return {
            ready: Boolean(document.querySelector('[data-dsh-work-brand="name"]')
              && document.querySelector('[data-composer-card]')),
            text: document.body.innerText,
          }
        })()`)
        const url = active.window.webContents.getURL()
        if (value.ready) return { text: value.text, url }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    throw new Error('native conversation surface timeout')
  }
  const screenshot = async (file: string): Promise<void> => {
    fs.writeFileSync(path.join(output, file), (await active.window.webContents.capturePage()).toPNG())
  }
  assert.equal(process.versions.electron, '44.0.0')
  phase = 'security-preferences'
  const preferences = active.window.webContents as unknown as {
    getLastWebPreferences(): { sandbox?: boolean; contextIsolation?: boolean; nodeIntegration?: boolean }
  }
  const prefs = preferences.getLastWebPreferences()
  phase = 'sandbox-preference'; assert.equal(prefs.sandbox, true)
  phase = 'isolation-preference'; assert.equal(prefs.contextIsolation, true)
  phase = 'node-preference'; assert.equal(prefs.nodeIntegration, false)
  if (missing) {
    phase = 'automatic-start-failure'
    await waitState('failed')
    phase = 'bridge-key-list'
    assert.equal(await js('JSON.stringify(Object.keys(window.dshWork).sort())'), JSON.stringify(['hasRetainedContext', 'recover', 'snapshot', 'start', 'stop', 'subscribe']))
    phase = 'renderer-globals'
    assert.equal(await js('JSON.stringify([typeof require, typeof process, typeof ipcRenderer])'), JSON.stringify(['undefined', 'undefined', 'undefined']))
    assert.equal(active.host.snapshot().code, 'runtime-unavailable')
    assert.equal(await js("document.getElementById('start').disabled"), false)
    assert.doesNotMatch(await js<string>('document.body.innerText'), /DSH Web|Workspace|Session|Profile|CLI|generation/u)
    await screenshot('failed.png')
    phase = 'retry-button'
    await js("document.getElementById('start').click()")
    await waitState('failed')
  } else {
    phase = 'automatic-native-surface'
    const surface = await waitForNativeSurface()
    const nativeCopy = inspectNativeSurfaceCopy(surface.text)
    phase = 'native-surface-url'
    assert.match(surface.url, /^http:\/\/127\.0\.0\.1:\d+\/$/u)
    phase = 'native-renderer-bridge'
    assert.equal(await js('typeof window.dshWork'), 'undefined')
    phase = 'native-brand-copy'; assert.equal(nativeCopy.brand, true)
    phase = 'native-new-session-copy'; assert.equal(nativeCopy.newSession, true)
    phase = 'native-settings-copy'; assert.equal(nativeCopy.settings, true)
    phase = 'native-legacy-copy-absent'
    assert.doesNotMatch(surface.text, /你想完成什么？|常见工作|最近工作|旧版工作/u)
    phase = 'native-host-ready'
    assert.equal(active.host.snapshot().state, 'ready')
    await screenshot('ready.png')
  }
  phase = 'navigation-denied'
  const allowedUrl = active.window.webContents.getURL()
  await js("window.open('https://example.com/')")
  await js("location.href = 'https://example.com/'")
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(BrowserWindow.getAllWindows().length, 1)
  assert.equal(active.window.webContents.getURL(), allowedUrl)
  phase = rendererCrash ? 'renderer-crash-stops-runtime' : 'window-close-stops-runtime'
  let crashObserved = false
  if (rendererCrash) active.window.webContents.once('render-process-gone', () => { crashObserved = true })
  // Exercise the emitted desktop window-close or renderer-gone shutdown entry.
  app.once('will-quit', () => {
    clearInterval(progress)
    const status = active.host.snapshot()
    const passed = status.canStart && (missing ? status.code === 'runtime-unavailable' : status.state === 'stopped') && (!rendererCrash || crashObserved)
    write(passed ? 'pass' : 'fail', { terminal: status, crashObserved, screenshots: missing ? ['failed.png'] : ['ready.png'] })
    if (!passed) process.exitCode = 1
  })
  if (rendererCrash) active.window.webContents.forcefullyCrashRenderer()
  else active.window.close()
} catch (error) {
  clearInterval(progress)
  write('fail', { failure: error instanceof Error ? error.name : 'UnknownFailure' })
  if (host) await host.stop()
  app.exit(1)
}
}
void run()
