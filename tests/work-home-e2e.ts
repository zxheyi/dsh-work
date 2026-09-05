// Explicit Electron entry point for visual acceptance; never imported by headless unit tests.
import { app, BrowserWindow, session } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

import { createOfficialLauncher, prepareDevelopmentProfile } from '../packages/runtime-host/official-launcher.ts'
import { createRuntimeHost, type RuntimeHost } from '../packages/runtime-host/index.ts'

const requestedHome = process.env.DSH_WORK_E2E_HOME
if (!requestedHome) throw new Error('explicit visual-test home is required')
const home: string = requestedHome
app.setPath('userData', path.join(home, 'electron-user-data'))
app.commandLine.appendSwitch('disable-background-networking')
app.commandLine.appendSwitch('force-device-scale-factor', '1')

async function reserveLoopbackPort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  })
  return address.port
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

let host: RuntimeHost | null = null
let window: BrowserWindow | null = null
const reportPath = path.resolve('artifacts/design/work-home-result.json')
let phase = 'boot'
const diagnostics: string[] = []
const writeReport = (status: 'pass' | 'fail', detail?: string): void => {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify({ status, phase, detail, diagnostics: diagnostics.slice(-20) }, null, 2))
}
writeReport('fail')

async function run(): Promise<void> {
  const node = process.env.DSH_WORK_NODE
  if (!node) throw new Error('explicit standalone Node is required; no global fallback')
  await app.whenReady()
  try {
    phase = 'prepare-profile'; writeReport('fail')
    prepareDevelopmentProfile(home)
    const patchPath = path.join(home, 'profiles/dsh-work/cordis.patch.yml')
    const patch = JSON.parse(fs.readFileSync(patchPath, 'utf8')) as Array<{
      id?: string
      config?: { printUrl?: boolean }
    }>
    const webRuntime = patch.find(row => row.id === 'web-runtime')
    assert.ok(webRuntime?.config)
    webRuntime.config.printUrl = true
    fs.writeFileSync(patchPath, JSON.stringify(patch))

    phase = 'launch-runtime'; writeReport('fail')
    const port = await reserveLoopbackPort()
    const origin = `http://127.0.0.1:${String(port)}`
    const launch = createOfficialLauncher({ node, home, port })
    let resolveUrl!: (url: string) => void
    const announcedUrl = new Promise<string>(resolve => { resolveUrl = resolve })
    host = createRuntimeHost({ launch: () => {
      const child = launch()
      let stdout = ''
      child.stdout.on('data', bytes => {
        stdout = `${stdout}${bytes.toString('utf8')}`.slice(-4_096)
        const match = stdout.match(/dsh web: (http:\/\/[^\s]+)/)
        if (match?.[1]) resolveUrl(match[1])
      })
      child.stderr.resume()
      return child
    } })
    assert.equal((await host.start()).state, 'ready')

    let announcementTimer: NodeJS.Timeout | undefined
    const authenticated = await Promise.race([
      announcedUrl,
      new Promise<never>((_, reject) => {
        announcementTimer = setTimeout(
          () => reject(new Error('Harness did not announce its authenticated URL')),
          5_000,
        )
      }),
    ])
    if (announcementTimer) clearTimeout(announcementTimer)

    phase = 'open-browser'; writeReport('fail')
    const isolatedSession = session.fromPartition(`dsh-work-home-${String(Date.now())}`)
    isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    isolatedSession.setPermissionCheckHandler(() => false)
    window = new BrowserWindow({
      width: 1440,
      height: 900,
      useContentSize: true,
      show: false,
      backgroundColor: '#f5f6f4',
      webPreferences: {
        session: isolatedSession,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: false,
      },
    })
    window.webContents.on('console-message', event => {
      const safe = event.message.replace(/([?&](?:token|code)=)[^&\s]+/gi, '$1[redacted]')
      diagnostics.push(safe.slice(0, 2_000))
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-attach-webview', event => event.preventDefault())
    window.webContents.on('will-navigate', (event, url) => {
      if (new URL(url).origin !== origin) event.preventDefault()
    })
    await window.loadURL(authenticated)

    const readSurface = (): Promise<{
      ready: boolean
      text: string
      url: string
      size: { width: number; height: number }
    }> => window!.webContents.executeJavaScript(`({
      ready: Boolean(
        document.querySelector('[data-dsh-work-brand="name"]')
        && document.querySelector('[data-composer-card]')
        && document.querySelector('[data-work-legacy-open]')
        && !document.body.innerText.includes('内测声明')
      ),
      text: document.body.innerText,
      url: location.href,
      size: { width: innerWidth, height: innerHeight },
    })`) as Promise<{
      ready: boolean
      text: string
      url: string
      size: { width: number; height: number }
    }>
    phase = 'dismiss-upstream-notice'; writeReport('fail')
    await waitFor(
      () => window!.webContents.executeJavaScript(`(() => {
        const button = Array.from(document.querySelectorAll('button'))
          .find(item => item.textContent?.trim() === '继续')
        if (button instanceof HTMLButtonElement) button.click()
        return !document.body.innerText.includes('内测声明')
      })()`) as Promise<boolean>,
      value => value,
      'Upstream notice could not be dismissed',
    )

    phase = 'wait-native-surface'; writeReport('fail')
    const surface = await waitFor(
      readSurface,
      value => value.ready && !new URL(value.url).search,
      'Native conversation surface did not become visible',
    )
    assert.deepEqual(surface.size, { width: 1440, height: 900 })
    assert.ok(surface.text.includes('DSH Work'))
    assert.ok(surface.text.includes('新会话'))
    assert.ok(surface.text.includes('工作区'))
    assert.ok(surface.text.includes('设置'))
    assert.doesNotMatch(surface.text, /你想完成什么？|常见工作|最近工作/u)
    assert.equal(await window.webContents.executeJavaScript(
      "Boolean(document.querySelector('[data-slot=sidebar]') && document.querySelector('[data-slot=conversation]'))",
    ), true)

    phase = 'legacy-access'; writeReport('fail')
    await window.webContents.executeJavaScript(
      "document.querySelector('[data-work-legacy-open]')?.click()",
    )
    await waitFor(
      () => window!.webContents.executeJavaScript(
        "Boolean(document.querySelector('[data-work-legacy-surface]') && document.querySelector('.dsh-work-home'))",
      ) as Promise<boolean>,
      value => value,
      'Legacy Work records lost their temporary access path',
    )
    await window.webContents.executeJavaScript(
      "document.querySelector('[aria-label=\"关闭旧版工作\"]')?.click()",
    )
    assert.equal(await window.webContents.executeJavaScript(
      "Boolean(document.querySelector('[data-work-legacy-surface]'))",
    ), false)
    await window.webContents.executeJavaScript(
      "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    )

    const output = path.resolve('artifacts/design')
    fs.mkdirSync(output, { recursive: true })
    const captured = await window.webContents.capturePage()
    const image = captured.getSize().width === 1440
      ? captured
      : captured.resize({ width: 1440, height: 900, quality: 'best' })
    assert.deepEqual(image.getSize(), { width: 1440, height: 900 })
    fs.writeFileSync(path.join(output, 'familiar-native-shell-actual.png'), image.toPNG())
    phase = 'complete'; writeReport('pass')
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown failure'
    if (window && !window.isDestroyed()) {
      const output = path.resolve('artifacts/design')
      fs.mkdirSync(output, { recursive: true })
      fs.writeFileSync(path.join(output, 'work-home-failure.png'), (await window.webContents.capturePage()).toPNG())
    }
    writeReport('fail', detail)
    process.exitCode = 1
  } finally {
    await host?.stop()
    window?.destroy()
    app.exit(typeof process.exitCode === 'number' ? process.exitCode : 0)
  }
}

void run()
