import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

import { createOfficialLauncher, prepareDevelopmentProfile } from '../packages/runtime-host/official-launcher.ts'
import { createRuntimeHost, type RuntimeHost } from '../packages/runtime-host/index.ts'
import {
  installNavigationTestProfile,
  NAVIGATION_TEST_ARCHIVE_FILE,
  NAVIGATION_TEST_BASELINE_FILE,
} from './support/navigation-test-profile.ts'

const requestedHome = process.env.DSH_WORK_E2E_HOME
if (!requestedHome) throw new Error('explicit session navigation test home is required')
const home = requestedHome
const requestedNode = process.env.DSH_WORK_NODE
if (!requestedNode) throw new Error('explicit standalone Node is required; no global fallback')
const node = requestedNode
const output = path.resolve('artifacts/session-navigation')
const reportPath = path.join(output, 'result.json')
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', path.join(home, 'electron'))
app.commandLine.appendSwitch('disable-background-networking')
app.commandLine.appendSwitch('force-device-scale-factor', '1')

let step = 'boot'
let host: RuntimeHost | null = null
let window: BrowserWindow | null = null
const writeReport = (status: 'pass' | 'fail', detail?: string): void => {
  fs.writeFileSync(reportPath, JSON.stringify({ status, step, detail }, null, 2))
}
writeReport('fail')

async function reserveLoopbackPort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return address.port
}

async function waitFor<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  message: string,
  timeoutMs = 35_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const value = await read()
      if (accept(value)) return value
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(message)
}

async function run(): Promise<void> {
  await app.whenReady()
  try {
    step = 'prepare-profile'; writeReport('fail')
    prepareDevelopmentProfile(home)
    installNavigationTestProfile(home)
    const patchPath = path.join(home, 'profiles/dsh-work/cordis.patch.yml')
    const patch = JSON.parse(fs.readFileSync(patchPath, 'utf8')) as Array<{
      id?: string
      config?: { printUrl?: boolean }
    }>
    const webRuntime = patch.find(row => row.id === 'web-runtime')
    assert.ok(webRuntime?.config)
    webRuntime.config.printUrl = true
    fs.writeFileSync(patchPath, JSON.stringify(patch))

    step = 'launch-runtime'; writeReport('fail')
    const port = await reserveLoopbackPort()
    const origin = 'http://127.0.0.1:' + String(port)
    const launch = createOfficialLauncher({ node, home, port })
    let resolveUrl!: (url: string) => void
    const announcedUrl = new Promise<string>(resolve => { resolveUrl = resolve })
    host = createRuntimeHost({ launch: () => {
      const child = launch()
      let stdout = ''
      child.stdout.on('data', bytes => {
        stdout = (stdout + bytes.toString('utf8')).slice(-4_096)
        const match = stdout.match(/dsh web: (http:\/\/[^\s]+)/)
        if (match?.[1]) resolveUrl(match[1])
      })
      return child
    } })
    assert.equal((await host.start()).state, 'ready')
    const authenticated = await Promise.race([
      announcedUrl,
      new Promise<never>((_, reject) => setTimeout(
        () => reject(new Error('Harness did not announce its authenticated URL')),
        5_000,
      )),
    ])

    step = 'open-native-shell'; writeReport('fail')
    window = new BrowserWindow({
      width: 1440,
      height: 900,
      useContentSize: true,
      show: false,
      backgroundColor: '#f5f6f4',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: false,
      },
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => {
      if (new URL(url).origin !== origin) event.preventDefault()
    })
    await window.loadURL(authenticated)
    const js = <T = unknown>(source: string): Promise<T> =>
      window!.webContents.executeJavaScript(source) as Promise<T>
    await waitFor(
      () => js<boolean>("(() => { for (const label of ['继续', '稍后配置']) { const button = Array.from(document.querySelectorAll('button')).find(item => item.textContent?.trim() === label); if (button instanceof HTMLButtonElement) button.click() } return Boolean(document.querySelector('[data-composer-input]')) && document.body.innerText.includes('会话甲') && document.body.innerText.includes('会话乙') })()"),
      value => value,
      'Native navigation fixture did not become ready',
    )
    const baseline = JSON.parse(fs.readFileSync(
      path.join(home, NAVIGATION_TEST_BASELINE_FILE),
      'utf8',
    )) as {
      sessionA: string
      sessionB: string
      promptA: string
      promptB: string
      files: Array<{ path: string; digest: string }>
    }
    const clickSession = async (title: string): Promise<void> => {
      const source = "(() => { const row = Array.from(document.querySelectorAll('[role=treeitem]')).find(item => item.textContent?.includes(" + JSON.stringify(title) + ")); if (!(row instanceof HTMLElement)) return false; row.click(); return true })()"
      assert.equal(await js<boolean>(source), true)
    }
    const setDraft = (text: string): Promise<string> => {
      const source = "(async () => { const input = document.querySelector('[data-composer-input]'); if (!(input instanceof HTMLElement)) return ''; input.focus(); input.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: " + JSON.stringify(text) + ", bubbles: true, cancelable: true })); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); return input.textContent ?? '' })()"
      return js<string>(source)
    }

    step = 'session-selection'; writeReport('fail')
    await clickSession('会话甲')
    await waitFor(
      () => js<string>('document.body.innerText'),
      text => text.includes(baseline.promptA) && text.includes('甲会话回复。')
        && !text.includes(baseline.promptB) && !text.includes('乙会话回复。'),
      'Selecting Session A mixed conversation history from Session B',
    )
    const draftA = '甲会话未发送草稿'
    assert.equal(await setDraft(draftA), draftA)
    await clickSession('会话乙')
    await waitFor(
      () => js<{ body: string; draft: string }>("({ body: document.body.innerText, draft: document.querySelector('[data-composer-input]')?.textContent ?? '' })"),
      value => value.body.includes(baseline.promptB) && value.body.includes('乙会话回复。')
        && !value.body.includes(baseline.promptA) && !value.body.includes('甲会话回复。')
        && value.draft === '',
      'Selecting Session B mixed history or draft from Session A',
    )
    const draftB = '乙会话未发送草稿'
    assert.equal(await setDraft(draftB), draftB)
    await clickSession('会话甲')
    await waitFor(
      () => js<string>("document.querySelector('[data-composer-input]')?.textContent ?? ''"),
      value => value === draftA,
      'Returning to Session A did not restore its draft',
    )

    step = 'native-search'; writeReport('fail')
    await clickSession('会话乙')
    await waitFor(
      () => js<{ body: string; draft: string }>("({ body: document.body.innerText, draft: document.querySelector('[data-composer-input]')?.textContent ?? '' })"),
      value => value.body.includes(baseline.promptB) && value.body.includes('乙会话回复。')
        && !value.body.includes(baseline.promptA) && value.draft === draftB,
      'Search did not start from the distinct Session B selection',
    )
    await js("document.querySelector('button[aria-label=\"搜索会话\"]')?.click()")
    await waitFor(
      () => js<boolean>("Boolean(document.querySelector('input[placeholder=\"搜索会话…\"]'))"),
      value => value,
      'Native Session search did not open',
    )
    const setSearch = (query: string): Promise<void> => {
      const source = "(() => { const input = document.querySelector('input[placeholder=\"搜索会话…\"]'); if (!(input instanceof HTMLInputElement)) return; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, " + JSON.stringify(query) + "); input.dispatchEvent(new Event('input', { bubbles: true })) })()"
      return js<void>(source)
    }
    await setSearch('会话甲')
    await waitFor(
      () => js<string>("document.querySelector('[aria-label=\"搜索结果\"]')?.textContent ?? ''"),
      value => value.includes('会话甲') && !value.includes('会话乙'),
      'Native title search did not isolate Session A',
    )
    await js("Array.from(document.querySelectorAll('[aria-label=\"搜索结果\"] [role=treeitem]')).find(item => item.textContent?.includes('会话甲'))?.click()")
    await waitFor(
      () => js<{ body: string; draft: string }>("({ body: document.body.innerText, draft: document.querySelector('[data-composer-input]')?.textContent ?? '' })"),
      value => value.body.includes(baseline.promptA) && value.body.includes('甲会话回复。')
        && !value.body.includes(baseline.promptB) && !value.body.includes('乙会话回复。')
        && value.draft === draftA,
      'Opening the search result did not select Session A',
    )
    await js("document.querySelector('button[aria-label=\"清除搜索\"]')?.click()")
    await js("document.querySelector('button[aria-label=\"搜索会话\"]')?.click()")
    await setSearch('绝对不存在的会话内容')
    await waitFor(
      () => js<string>('document.body.innerText'),
      value => value.includes('无匹配会话'),
      'No-result Session search did not expose an empty state',
    )
    fs.writeFileSync(path.join(output, 'no-results.png'), (await window.webContents.capturePage()).toPNG())
    await js("document.querySelector('button[aria-label=\"清除搜索\"]')?.click()")
    await waitFor(
      () => js<boolean>("!document.body.innerText.includes('无匹配会话') && document.body.innerText.includes('会话甲') && document.body.innerText.includes('会话乙')"),
      value => value,
      'No-result Session search could not be exited',
    )

    step = 'archive-selected-session'; writeReport('fail')
    await clickSession('会话乙')
    await waitFor(
      () => js<string>("document.querySelector('[data-composer-input]')?.textContent ?? ''"),
      value => value === draftB,
      'Returning to Session B did not restore its own draft',
    )
    await js("document.querySelector('button[aria-label=\"会话“会话乙”的操作\"]')?.click()")
    await waitFor(
      () => js<boolean>("Boolean(Array.from(document.querySelectorAll('button')).find(item => item.textContent?.trim() === '归档会话'))"),
      value => value,
      'Session B archive menu did not open',
    )
    await js("Array.from(document.querySelectorAll('button')).find(item => item.textContent?.trim() === '归档会话')?.click()")
    await waitFor(
      async () => fs.existsSync(path.join(home, NAVIGATION_TEST_ARCHIVE_FILE)),
      value => value,
      'Host did not persist Session B archive membership',
    )
    assert.equal(await js<boolean>("Array.from(document.querySelectorAll('[role=treeitem]')).some(item => item.textContent?.includes('会话乙'))"), false)
    for (const file of baseline.files) {
      const bytes = fs.readFileSync(file.path)
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.digest)
    }
    const sessionRecords = fs.readdirSync(path.join(home, 'sessions'), {
      recursive: true,
      encoding: 'utf8',
    }).filter(file => file.endsWith('.jsonl'))
      .map(file => fs.readFileSync(path.join(home, 'sessions', file), 'utf8'))
      .join('\n')
    assert.ok(sessionRecords.includes(baseline.promptA))
    assert.ok(sessionRecords.includes(baseline.promptB))

    step = 'capture'; writeReport('fail')
    fs.writeFileSync(path.join(output, 'archived.png'), (await window.webContents.capturePage()).toPNG())
    await host.stop()
    host = null
    step = 'complete'; writeReport('pass')
  } catch (error) {
    const detail = error instanceof Error ? error.stack ?? error.message : 'unknown failure'
    if (window && !window.isDestroyed()) {
      fs.writeFileSync(path.join(output, 'failure.png'), (await window.webContents.capturePage()).toPNG())
    }
    writeReport('fail', detail)
    process.exitCode = 1
  } finally {
    await host?.stop().catch(() => {})
    window?.destroy()
    app.exit(typeof process.exitCode === 'number' ? process.exitCode : 0)
  }
}

void run()
