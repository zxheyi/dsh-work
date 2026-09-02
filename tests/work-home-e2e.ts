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
      ready: Boolean(document.querySelector('.dsh-work-home') && document.querySelector('.dsh-work-sidebar')),
      text: document.body.innerText,
      url: location.href,
      size: { width: innerWidth, height: innerHeight },
    })`) as Promise<{
      ready: boolean
      text: string
      url: string
      size: { width: number; height: number }
    }>
    phase = 'wait-work-surface'; writeReport('fail')
    const surface = await waitFor(
      readSurface,
      value => value.ready && value.text.includes('你想完成什么？') && !new URL(value.url).search,
      'Work home surface did not become visible',
    )
    assert.deepEqual(surface.size, { width: 1440, height: 900 })
    assert.ok(surface.text.includes('常见工作'))
    assert.ok(surface.text.includes('最近工作'))
    assert.doesNotMatch(surface.text, /Workspace|Session|Agent|模型|插件/)

    const resourceMenu = await window.webContents.executeJavaScript(`(() => {
      const menu = document.querySelector('.dsh-work-resource-menu')
      if (!(menu instanceof HTMLDetailsElement)) return null
      menu.open = true
      return {
        open: menu.open,
        trigger: menu.querySelector('summary')?.textContent?.trim(),
        items: Array.from(menu.querySelectorAll('.dsh-work-resource-item')).map(item => item.textContent?.trim()),
      }
    })()`) as { open: boolean; trigger?: string; items: string[] } | null
    assert.deepEqual(resourceMenu, {
      open: true,
      trigger: '+添加资料⌄',
      items: ['添加文件还可添加 20 个', '添加文件夹即将支持', '添加网页即将支持', '粘贴内容即将支持'],
    })
    const stagedFile = await window.webContents.executeJavaScript(`(async () => {
      const input = document.querySelector('.dsh-work-file-input')
      if (!(input instanceof HTMLInputElement)) return null
      const transfer = new DataTransfer()
      transfer.items.add(new File(['Launch brief'], 'launch brief.txt', { type: 'text/plain' }))
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const chip = document.querySelector('[data-work-pending-resource]')
      return { name: chip?.getAttribute('data-work-pending-resource'), text: chip?.textContent }
    })()`) as { name?: string; text?: string } | null
    assert.equal(stagedFile?.name, 'launch brief.txt')
    assert.match(stagedFile?.text ?? '', /待添加/u)
    const importPanel = await window.webContents.executeJavaScript(`(async () => {
      const menu = document.querySelector('.dsh-work-resource-menu')
      if (menu instanceof HTMLDetailsElement) menu.open = false
      const trigger = document.querySelector('.dsh-work-import-trigger')
      if (!(trigger instanceof HTMLButtonElement)) return null
      trigger.click()
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const panel = document.querySelector('.dsh-work-import')
      return {
        title: panel?.querySelector('h3')?.textContent?.trim(),
        text: panel?.textContent,
        sourceCount: panel?.querySelectorAll('option').length,
        hasContentInput: Boolean(panel?.querySelector('[data-work-import-content]')),
      }
    })()`) as {
      title?: string
      text?: string
      sourceCount?: number
      hasContentInput: boolean
    } | null
    assert.equal(importPanel?.title, '继续已有对话')
    assert.match(importPanel?.text ?? '', /原对话不会改变/u)
    assert.equal(importPanel?.sourceCount, 3)
    assert.equal(importPanel?.hasContentInput, true)
    await window.webContents.executeJavaScript(`new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    })`)

    const output = path.resolve('artifacts/design')
    fs.mkdirSync(output, { recursive: true })
    const captured = await window.webContents.capturePage()
    const image = captured.getSize().width === 1440
      ? captured
      : captured.resize({ width: 1440, height: 900, quality: 'best' })
    assert.deepEqual(image.getSize(), { width: 1440, height: 900 })
    fs.writeFileSync(path.join(output, 'work-home-v2-actual.png'), image.toPNG())
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
