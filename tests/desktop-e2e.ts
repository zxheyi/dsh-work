// Explicit Electron entry point; never imported by headless unit tests.
import { app, BrowserWindow, nativeTheme } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import type { DesktopSession } from '../apps/desktop/main.ts'
import { inspectNativeSurfaceCopy } from './support/native-surface-copy.ts'

const missing = process.argv.includes('--missing-runtime')
const rendererCrash = process.argv.includes('--renderer-crash')
const localProfile = process.argv.includes('--local-profile')
const relaunch = process.argv.includes('--relaunch')
const name = missing ? 'missing' : rendererCrash ? 'renderer-crash'
  : localProfile ? relaunch ? 'local-profile-relaunch' : 'local-profile' : 'normal'
const output = path.resolve('artifacts/desktop', name)
fs.mkdirSync(output, { recursive: true })
const reportPath = path.join(output, 'result.json')
let phase = 'boot'
let nativeSurfaceProbe: Record<string, unknown> | null = null
let presentationProbe: Record<string, unknown> | null = null
const clientDiagnostics: string[] = []
const write = (status: 'pass' | 'fail', extra: Record<string, unknown> = {}): void => fs.writeFileSync(reportPath, JSON.stringify({ status, phase,
  runId: process.env.DSH_WORK_E2E_RUN_ID,
  platform: process.platform, arch: process.arch, electron: process.versions.electron, ...extra }, null, 2))
write('fail')
const progress = setInterval(() => write('fail'), 250)
const userData = process.env.DSH_WORK_E2E_USER_DATA
if (!userData) throw new Error('desktop test user data unavailable')
const ownedUserData = userData
app.setPath('userData', ownedUserData)
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
  active.window.webContents.on('console-message', event => {
    if (clientDiagnostics.length >= 20) return
    const categories = [
      [/ChunkLoadError|Loading chunk/iu, 'chunk-load'],
      [/SyntaxError/iu, 'syntax-error'],
      [/ReferenceError/iu, 'reference-error'],
      [/TypeError/iu, 'type-error'],
      [/Failed to fetch|ERR_[A-Z_]+/u, 'network-error'],
      [/module|import/iu, 'module-error'],
      [/React/iu, 'react-error'],
      [/WebSocket/iu, 'websocket-error'],
      [/Content Security Policy/iu, 'content-security-policy'],
      [/cordis/iu, 'cordis-error'],
      [/Uncaught/iu, 'uncaught'],
    ] as const
    const category = categories.find(([pattern]) => pattern.test(event.message))?.[1] ?? 'other'
    clientDiagnostics.push(`console:${event.level}:${category}`)
  })
  active.window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (clientDiagnostics.length >= 20) return
    clientDiagnostics.push(`load:${String(errorCode)}:${isMainFrame ? 'main' : 'sub'}`)
  })
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
    const deadline = Date.now() + (process.platform === 'win32' ? 70_000 : 35_000)
    let readySince = 0
    while (Date.now() < deadline) {
      try {
        const value = await js<{
          ready: boolean
          text: string
          brand: boolean
          composer: boolean
          sidebar: boolean
          conversation: boolean
          dialog: boolean
          readyState: string
          root: boolean
          rootChildren: number
          scripts: number
        }>(`(() => {
          for (const label of ['继续', 'Continue', '稍后配置', 'Configure later']) {
            const button = Array.from(document.querySelectorAll('button'))
              .find(item => item.textContent?.trim() === label)
            if (button instanceof HTMLButtonElement) button.click()
          }
          const expandSidebar = Array.from(document.querySelectorAll('button'))
            .find(item => ['打开侧边栏', 'Open sidebar'].includes(item.getAttribute('aria-label') ?? ''))
          if (expandSidebar instanceof HTMLButtonElement) expandSidebar.click()
          const brand = Boolean(document.querySelector('[data-dsh-work-brand="name"]'))
          const composer = Boolean(document.querySelector('[data-composer-card]'))
          return {
            ready: brand && composer,
            text: document.body.innerText,
            brand,
            composer,
            sidebar: Boolean(document.querySelector('[data-slot="sidebar"]')),
            conversation: Boolean(document.querySelector('[data-slot="conversation"]')),
            dialog: Boolean(document.querySelector('[role="dialog"]')),
            readyState: document.readyState,
            root: Boolean(document.getElementById('root')),
            rootChildren: document.getElementById('root')?.childElementCount ?? -1,
            scripts: document.scripts.length,
          }
        })()`)
        const url = active.window.webContents.getURL()
        let location = 'other'
        if (url.startsWith('dsh-work:')) location = 'status'
        else {
          try {
            const parsed = new URL(url)
            if (parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1') {
              location = parsed.search ? 'loopback-query' : 'loopback-clean'
            }
          } catch {}
        }
        nativeSurfaceProbe = {
          location,
          brand: value.brand,
          composer: value.composer,
          sidebar: value.sidebar,
          conversation: value.conversation,
          dialog: value.dialog,
          readyState: value.readyState,
          root: value.root,
          rootChildren: value.rootChildren,
          scripts: value.scripts,
          hostState: active.host.snapshot().state,
        }
        // Native first-run dialogs can mount just after the composer appears.
        if (value.ready && !value.dialog) {
          readySince ||= Date.now()
          if (Date.now() - readySince >= 500) return { text: value.text, url }
        } else readySince = 0
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
    phase = 'recovery-presentation'
    assert.equal(await js("document.body.dataset.scene"), 'recovery')
    assert.equal(await js("document.querySelector('.failure-detail')?.getAttribute('aria-hidden')"), null)
    assert.equal(await js("document.querySelector('.runtime-whale')?.complete && document.querySelector('.runtime-whale')?.naturalWidth > 0"), true)
    phase = 'bridge-key-list'
    assert.equal(await js('JSON.stringify(Object.keys(window.dshWork).sort())'), JSON.stringify(['hasRetainedContext', 'recover', 'safeMode', 'selectProfile', 'snapshot', 'start', 'startup', 'stop', 'subscribe']))
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
    if (localProfile && !relaunch) {
      phase = 'local-profile-choice-precedes-start'
      const context = await js<{
        choiceRequired: boolean
        homeLabel: string
        profiles: Array<{ id: string; name: string }>
      }>('window.dshWork.startup()')
      phase = 'local-profile-choice-required'
      assert.equal(context.choiceRequired, true)
      phase = 'local-profile-home-label'
      assert.equal(context.homeLabel, '$DSH_HOME')
      phase = 'local-profile-list'
      assert.deepEqual(context.profiles.map(item => item.name), ['web'])
      phase = 'local-profile-host-stopped'
      assert.equal(active.host.snapshot().state, 'stopped')
      phase = 'local-profile-onboarding-visible'
      {
        const deadline = Date.now() + 5_000
        while (await js("document.getElementById('onboarding').hidden") && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 25))
        }
      }
      presentationProbe = await js(`({
        scene: document.body.dataset.scene,
        state: document.body.dataset.state,
        onboardingHidden: document.getElementById('onboarding')?.hidden,
        profileCards: document.querySelectorAll('#profile-options .profile-card').length,
        useLocalDisabled: document.getElementById('use-local')?.disabled,
      })`)
      assert.equal(await js("document.getElementById('onboarding').hidden"), false)
      phase = 'profile-presentation'
      assert.equal(await js('document.body.dataset.scene'), 'profile')
      assert.equal(await js("document.querySelectorAll('#profile-options .profile-card').length"), 1)
      assert.equal(await js("document.querySelector('.launch-brand') !== null"), true)
      assert.equal(await js("document.getElementById('onboarding-title').textContent"), '选择这次使用的工作环境')
      assert.equal(await js("getComputedStyle(document.getElementById('runtime')).display"), 'none')
      assert.doesNotMatch(await js<string>('document.body.innerText'), new RegExp(ownedUserData.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))
      await screenshot('onboarding.png')
      phase = 'local-profile-selected'
      await js("document.getElementById('use-local').click()")
    } else if (relaunch) {
      phase = 'remembered-choice-starts-automatically'
      const context = await js<{ choiceRequired: boolean; selected: string }>('window.dshWork.startup()')
      assert.equal(context.choiceRequired, false)
      assert.match(context.selected, /^[a-f0-9]{24}$/u)
      assert.equal(await js("document.getElementById('onboarding').hidden"), true)
    }
    phase = 'automatic-native-surface'
    const surface = await waitForNativeSurface()
    const nativeCopy = inspectNativeSurfaceCopy(surface.text)
    phase = 'native-surface-url'
    assert.match(surface.url, /^http:\/\/127\.0\.0\.1:\d+\/$/u)
    phase = 'native-renderer-bridge'
    assert.equal(await js('typeof window.dshWork'), 'undefined')
    phase = 'native-brand-copy'; assert.equal(nativeCopy.brand, true)
    phase = 'native-brand-mark'
    assert.equal(await js("document.querySelector('[data-dsh-work-brand=\"name\"]')?.closest('button')?.querySelector('img[data-dsh-work-brand=\"mark\"]')?.complete === true"), true)
    assert.equal(await js("document.querySelector('[data-dsh-work-brand=\"name\"]')?.closest('button')?.textContent"), '基于DeepSeek Harness')
    if (process.platform === 'darwin') {
      phase = 'native-integrated-window-chrome'
      assert.equal(await js('document.documentElement.dataset.dshWorkPlatform'), 'darwin')
      const [outerWidth, outerHeight] = active.window.getSize()
      const [contentWidth, contentHeight] = active.window.getContentSize()
      assert.equal(outerWidth, contentWidth)
      assert.equal(outerHeight, contentHeight, 'content extends into the hidden title bar')
      assert.equal(await js("getComputedStyle(document.querySelector('.dsh-work-window-drag')).getPropertyValue('-webkit-app-region')"), 'drag')
    }
    phase = 'native-hero-text-only'
    assert.equal(await js("document.querySelector('svg[width=\"34\"][aria-hidden=\"true\"] path[fill=\"currentColor\"]') !== null"), false)
    phase = 'native-new-session-copy'; assert.equal(nativeCopy.newSession, true)
    phase = 'native-settings-copy'; assert.equal(nativeCopy.settings, true)
    phase = 'native-legacy-copy-absent'
    assert.doesNotMatch(surface.text, /你想完成什么？|常见工作|最近工作|旧版工作/u)
    phase = 'native-host-ready'
    assert.equal(active.host.snapshot().state, 'ready')
    if (localProfile) {
      phase = 'local-profile-source-unchanged'
      const sourceManifest = path.join(process.env.DSH_HOME!, 'profiles', 'web', 'package.json')
      assert.deepEqual(JSON.parse(fs.readFileSync(sourceManifest, 'utf8')), {
        private: true,
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
      })
      const choiceBytes = fs.readFileSync(path.join(ownedUserData, 'startup-preferences.json'), 'utf8')
      const checkpointBytes = fs.readFileSync(path.join(ownedUserData, 'startup-checkpoint.json'), 'utf8')
      assert.match(choiceBytes, /"kind": "shared"/u)
      assert.doesNotMatch(checkpointBytes, new RegExp(ownedUserData.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))
    }
    // Capture the brand after the native sidebar entrance animation has settled.
    await js(`Promise.all(Array.from(document.getAnimations()).filter(animation =>
      animation.effect?.getComputedTiming().iterations !== Infinity
    ).map(animation => animation.finished.catch(() => {})))`)
    await screenshot('ready.png')
    if (localProfile && !relaunch) {
      phase = 'brand-responsive-layout'
      const settle = async (): Promise<void> => {
        await new Promise(resolve => setTimeout(resolve, 350))
        await js(`Promise.all(Array.from(document.getAnimations()).filter(animation =>
          animation.effect?.getComputedTiming().iterations !== Infinity
        ).map(animation => animation.finished.catch(() => {})))`)
      }
      const clickSidebarToggle = async (): Promise<void> => {
        active.window.focus()
        active.window.webContents.focus()
        await new Promise(resolve => setTimeout(resolve, 100))
        const point = await js<{ x: number; y: number }>(`(() => {
          const row = document.querySelector('[data-slot="sidebar"] > div > div:first-child')
          const button = Array.from(row.querySelectorAll('button')).find(item => ['打开侧边栏', 'Open sidebar', '收起侧边栏', 'Collapse sidebar'].includes(item.getAttribute('aria-label')))
          const r = button.getBoundingClientRect()
          return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
        })()`)
        active.window.webContents.sendInputEvent({ type: 'mouseMove', ...point })
        await new Promise(resolve => setTimeout(resolve, 50))
        active.window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
        await new Promise(resolve => setTimeout(resolve, 50))
        active.window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
        await new Promise(resolve => setTimeout(resolve, 100))
        active.window.webContents.sendInputEvent({ type: 'mouseMove', x: 500, y: 80 })
        await settle()
      }
      await clickSidebarToggle()
      phase = 'sidebar-collapsed-after-pointer-click'
      assert.equal(await js('document.querySelector("[data-dsh-work-brand=name]") === null'), true)
      phase = 'sidebar-collapsed-traffic-light-clearance'
      assert.equal(await js(`document.querySelector('[data-dsh-work-brand="mark"]').closest('button').getBoundingClientRect().top >= 42`), process.platform === 'darwin')
      await screenshot('sidebar-collapsed.png')
      await clickSidebarToggle()
      assert.equal(await js('document.querySelector("[data-dsh-work-brand=name]") !== null'), true)
      active.window.setSize(960, 680)
      await settle()
      await clickSidebarToggle()
      assert.equal(await js(`(() => {
        const name = document.querySelector('[data-dsh-work-brand="name"]')
        return !!name && name.scrollWidth <= name.clientWidth
      })()`), true, 'source name fits the minimum-width expanded sidebar')
      await screenshot('minimum-width.png')
      active.window.setSize(1440, 900)
      await settle()
      phase = 'native-dark-theme'
      nativeTheme.themeSource = 'dark'
      await settle()
      assert.equal(await js('document.body.hasAttribute("data-ds-dark-theme")'), true)
      await screenshot('dark.png')
      nativeTheme.themeSource = 'system'
    }
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
    write(passed ? 'pass' : 'fail', { terminal: status, crashObserved,
      screenshots: missing ? ['failed.png'] : localProfile && !relaunch ? ['onboarding.png', 'ready.png', 'sidebar-collapsed.png', 'minimum-width.png', 'dark.png'] : ['ready.png'] })
    if (!passed) process.exitCode = 1
  })
  if (rendererCrash) active.window.webContents.forcefullyCrashRenderer()
  else active.window.close()
} catch (error) {
  clearInterval(progress)
  write('fail', {
    failure: error instanceof Error ? error.name : 'UnknownFailure',
    nativeSurfaceProbe,
    presentationProbe,
    clientDiagnostics,
  })
  if (host) await host.stop()
  app.exit(1)
}
}
void run()
