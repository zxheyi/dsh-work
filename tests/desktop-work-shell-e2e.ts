// Explicit Electron entry point for the Desktop Work Shell acceptance.
import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import type { DesktopSession } from '../apps/desktop/main.ts'

const userData = process.env.DSH_WORK_E2E_USER_DATA
assert.ok(userData)
app.setPath('userData', userData)
app.commandLine.appendSwitch('disable-background-networking')
app.commandLine.appendSwitch('force-device-scale-factor', '1')

const output = path.resolve('artifacts/desktop/work-shell')
fs.mkdirSync(output, { recursive: true })
const reportPath = path.join(output, 'result.json')
let phase = 'boot'
const write = (status: 'pass' | 'fail', extra: Record<string, unknown> = {}): void => {
  fs.writeFileSync(reportPath, JSON.stringify({
    status,
    phase,
    runId: process.env.DSH_WORK_E2E_RUN_ID,
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    ...extra,
  }, null, 2))
}
write('fail')

const emittedDesktopEntry: string = '../dist/apps/desktop/main.js'
const { desktop } = await import(emittedDesktopEntry) as {
  desktop: Promise<DesktopSession>
}

async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean, message: string): Promise<T> {
  const deadline = Date.now() + 35_000
  while (Date.now() < deadline) {
    const value = await read()
    if (accept(value)) return value
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(message)
}

async function run(): Promise<void> {
  let active: DesktopSession | null = null
  try {
    phase = 'open-desktop'; write('fail')
    active = await desktop
    const js = <T = unknown>(source: string): Promise<T> =>
      active!.window.webContents.executeJavaScript(source) as Promise<T>
    phase = 'wait-authenticated-handoff'; write('fail')
    await waitFor(
      async () => active!.window.webContents.getURL(),
      value => /^http:\/\/127\.0\.0\.1:\d+\/$/u.test(value),
      'Desktop did not reach the authenticated Work surface',
    )
    phase = 'dismiss-upstream-notice'; write('fail')
    await waitFor(
      () => js<boolean>(`(() => {
        const button = Array.from(document.querySelectorAll('button'))
          .find(item => item.textContent?.trim() === '继续')
        if (button instanceof HTMLButtonElement) button.click()
        return !document.body.innerText.includes('内测声明')
      })()`),
      value => value,
      'Upstream notice could not be dismissed',
    )
    phase = 'wait-native-shell'; write('fail')
    const surface = await waitFor(async () => ({
      url: active!.window.webContents.getURL(),
      text: await js<string>('document.body.innerText'),
      ready: await js<boolean>(`Boolean(
        document.querySelector('[data-dsh-work-brand="name"]')
        && document.querySelector('[data-composer-card]')
      )`),
      bridge: await js<string>('typeof window.dshWork'),
    }), value => value.ready && /^http:\/\/127\.0\.0\.1:\d+\/$/u.test(value.url),
    'Desktop did not enter the native conversation shell')
    assert.match(surface.url, /^http:\/\/127\.0\.0\.1:\d+\/$/u)
    assert.equal(surface.bridge, 'undefined')
    assert.ok(surface.text.includes('DSH Work'))
    assert.ok(surface.text.includes('新会话'))
    assert.ok(surface.text.includes('工作区'))
    assert.ok(surface.text.includes('设置'))
    assert.doesNotMatch(surface.text, /旧版工作/u)
    assert.doesNotMatch(surface.text, /你想完成什么？|常见工作|最近工作/u)
    const preferences = active.window.webContents as unknown as {
      getLastWebPreferences(): { sandbox?: boolean; contextIsolation?: boolean; nodeIntegration?: boolean }
    }
    const prefs = preferences.getLastWebPreferences()
    assert.equal(prefs.sandbox, true)
    assert.equal(prefs.contextIsolation, true)
    assert.equal(prefs.nodeIntegration, false)
    assert.equal(BrowserWindow.getAllWindows().length, 1)

    phase = 'navigation-boundary'; write('fail')
    await js("window.open('https://example.com/'); location.href = 'https://example.com/'; undefined")
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(BrowserWindow.getAllWindows().length, 1)
    assert.equal(active.window.webContents.getURL(), surface.url)

    phase = 'capture-home'; write('fail')
    await js("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
    const captured = await active.window.webContents.capturePage()
    fs.writeFileSync(path.join(output, 'home.png'), captured.toPNG())
    phase = 'close-cleanly'; write('fail')
    app.once('will-quit', () => {
      const terminal = active!.host.snapshot()
      const passed = terminal.state === 'stopped' && terminal.code === null && terminal.canStart
      phase = 'complete'
      write(passed ? 'pass' : 'fail', { terminal, screenshots: ['home.png'] })
      if (!passed) process.exitCode = 1
    })
    active.window.close()
  } catch (error) {
    write('fail', { detail: error instanceof Error ? error.message : 'unknown failure' })
    await active?.host.stop().catch(() => {})
    await active?.host.dispose().catch(() => {})
    app.exit(1)
  }
}

void run()
