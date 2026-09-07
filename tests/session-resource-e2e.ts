import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

import { createOfficialLauncher, prepareDevelopmentProfile } from '../packages/runtime-host/official-launcher.ts'
import { createRuntimeHost, type RuntimeHost } from '../packages/runtime-host/index.ts'
import { installNavigationTestProfile, NAVIGATION_TEST_BASELINE_FILE } from './support/navigation-test-profile.ts'

const requestedHome = process.env.DSH_WORK_E2E_HOME
const requestedNode = process.env.DSH_WORK_NODE
if (!requestedHome || !requestedNode) throw new Error('explicit Session resource test home and standalone Node are required')
const home: string = requestedHome
const node: string = requestedNode
const output = path.resolve('artifacts/session-resource')
const reportPath = path.join(output, 'result.json')
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', path.join(home, 'electron'))
app.commandLine.appendSwitch('disable-background-networking')
app.commandLine.appendSwitch('force-device-scale-factor', '1')

let step = 'boot'
let host: RuntimeHost | null = null
let window: BrowserWindow | null = null
const report = (status: 'pass' | 'fail', detail?: string): void => {
  fs.writeFileSync(reportPath, JSON.stringify({ status, step, detail }, null, 2))
}
report('fail')

async function reservePort(): Promise<number> {
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
    step = 'prepare-profile'; report('fail')
    prepareDevelopmentProfile(home)
    installNavigationTestProfile(home)
    const patchPath = path.join(home, 'profiles/dsh-work/cordis.patch.yml')
    const patch = JSON.parse(fs.readFileSync(patchPath, 'utf8')) as Array<{ id?: string; config?: { printUrl?: boolean } }>
    const webRuntime = patch.find(row => row.id === 'web-runtime')
    assert.ok(webRuntime?.config)
    webRuntime.config.printUrl = true
    fs.writeFileSync(patchPath, JSON.stringify(patch))

    step = 'launch-runtime'; report('fail')
    const port = await reservePort()
    const origin = `http://127.0.0.1:${port}`
    const launch = createOfficialLauncher({ node, home, port })
    let resolveUrl!: (url: string) => void
    const announcedUrl = new Promise<string>(resolve => { resolveUrl = resolve })
    host = createRuntimeHost({ launch: () => {
      const child = launch()
      let stdout = ''
      child.stdout.on('data', bytes => {
        stdout = (stdout + bytes.toString('utf8')).slice(-4_096)
        const match = stdout.match(/dsh web: (http:\/\/[^\s]+)/u)
        if (match?.[1]) resolveUrl(match[1])
      })
      return child
    } })
    assert.equal((await host.start()).state, 'ready')
    const authenticated = await Promise.race([
      announcedUrl,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Harness URL unavailable')), 5_000)),
    ])

    step = 'open-shell'; report('fail')
    window = new BrowserWindow({
      width: 1440,
      height: 900,
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => {
      if (new URL(url).origin !== origin) event.preventDefault()
    })
    await window.loadURL(authenticated)
    const js = <T = unknown>(source: string): Promise<T> => window!.webContents.executeJavaScript(source) as Promise<T>
    await waitFor(
      () => js<boolean>("(() => { for (const label of ['继续', '稍后配置']) { const button = Array.from(document.querySelectorAll('button')).find(item => item.textContent?.trim() === label); if (button instanceof HTMLButtonElement) button.click() } return Boolean(document.querySelector('[data-composer-input]')) && Boolean(document.querySelector('[data-work-session-resource]')) && document.body.innerText.includes('会话甲') })()"),
      Boolean,
      'Session resource control did not mount in the native composer',
    )
    const baseline = JSON.parse(fs.readFileSync(path.join(home, NAVIGATION_TEST_BASELINE_FILE), 'utf8')) as {
      workspacePath: string
      promptA: string
      files: Array<{ path: string; digest: string }>
    }
    const clickSession = async (title: string): Promise<void> => {
      assert.equal(await js<boolean>("(() => { const row = Array.from(document.querySelectorAll('[role=treeitem]')).find(item => item.textContent?.includes(" + JSON.stringify(title) + ")); if (!(row instanceof HTMLElement)) return false; row.click(); return true })()"), true)
    }
    const selectFile = (name: string, type: string, content: string): Promise<boolean> => js<boolean>(
      "(() => { const input = document.querySelector('[data-work-session-resource] input[type=file]'); if (!(input instanceof HTMLInputElement)) return false; const transfer = new DataTransfer(); transfer.items.add(new File([" + JSON.stringify(content) + "], " + JSON.stringify(name) + ", { type: " + JSON.stringify(type) + " })); Object.defineProperty(input, 'files', { configurable: true, value: transfer.files }); input.dispatchEvent(new Event('change', { bubbles: true })); return true })()",
    )
    const dropFile = (name: string, type: string, content: string): Promise<boolean> => js<boolean>(
      "(() => { const transfer = new DataTransfer(); transfer.items.add(new File([" + JSON.stringify(content) + "], " + JSON.stringify(name) + ", { type: " + JSON.stringify(type) + " })); return !document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })) })()",
    )
    const selectSizedFile = (name: string, bytes: number): Promise<boolean> => js<boolean>(
      "(() => { const input = document.querySelector('[data-work-session-resource] input[type=file]'); if (!(input instanceof HTMLInputElement)) return false; const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(" + String(bytes) + ").fill(65)], " + JSON.stringify(name) + ", { type: 'text/markdown' })); Object.defineProperty(input, 'files', { configurable: true, value: transfer.files }); input.dispatchEvent(new Event('change', { bubbles: true })); return true })()",
    )
    const dropDocumentAndImage = (): Promise<boolean> => js<boolean>(
      "(() => { const transfer = new DataTransfer(); transfer.items.add(new File(['dropped text'], 'dropped.txt', { type: 'text/plain' })); const binary = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='); const bytes = Uint8Array.from(binary, value => value.charCodeAt(0)); transfer.items.add(new File([bytes], 'pixel.png', { type: 'image/png' })); return !document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })) })()",
    )

    step = 'reject-and-remove'; report('fail')
    await clickSession('会话甲')
    assert.equal(await dropFile('unsupported.pdf', 'application/pdf', 'pdf bytes'), true)
    await waitFor(
      () => js<string>('document.body.innerText'),
      text => text.includes('当前仅支持 Markdown、TXT、CSV 和 JSON 文件。') && text.includes('重试'),
      'Unsupported format did not expose a retryable failure',
    )
    await js("document.querySelector('button[aria-label=\"移除 unsupported.pdf\"]')?.click()")
    await waitFor(
      () => js<boolean>("!document.body.innerText.includes('unsupported.pdf')"),
      Boolean,
      'Failed resource could not be removed',
    )

    step = 'mixed-drop-routing'; report('fail')
    assert.equal(await dropDocumentAndImage(), true)
    await waitFor(
      () => js<boolean>("document.body.innerText.includes('dropped.txt') && document.body.innerText.includes('已复制，发送后读取') && Boolean(document.querySelector('img[alt=\"pixel.png\"]'))"),
      Boolean,
      'Mixed drop did not route the document to Work and the image to the native attachment owner',
    )
    await js("document.querySelector('button[aria-label=\"移除 dropped.txt\"]')?.click(); Array.from(document.querySelectorAll('button')).find(item => item.getAttribute('aria-label')?.includes('pixel.png'))?.click()")
    await waitFor(
      () => js<boolean>("!document.body.innerText.includes('dropped.txt') && !document.querySelector('img[alt=\"pixel.png\"]')"),
      Boolean,
      'Mixed-drop items could not be removed from their respective owners',
    )

    step = 'copy-current-session'; report('fail')
    const inputText = '请读取这份资料并确认。'
    await js("(() => { const input = document.querySelector('[data-composer-input]'); if (!(input instanceof HTMLElement)) return; input.focus(); input.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: " + JSON.stringify(inputText) + ", bubbles: true, cancelable: true })) })()")
    assert.equal(await selectSizedFile('removed-while-copying.md', 24 * 1024 * 1024), true)
    await waitFor(
      () => js<boolean>("Boolean(document.querySelector('[data-work-session-resource-name=\"removed-while-copying.md\"].is-copying'))"),
      Boolean,
      'Large resource did not enter the copying state',
    )
    fs.writeFileSync(path.join(output, 'copying.png'), (await window.webContents.capturePage()).toPNG())
    await js("(() => { const card = document.querySelector('[data-composer-card]'); const buttons = card?.querySelectorAll('button'); const send = buttons?.item((buttons?.length ?? 0) - 1); send?.setAttribute('aria-label', 'Send message'); send?.click(); document.querySelector('[data-composer-input]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) })()")
    assert.equal(await js<string>("document.querySelector('[data-composer-input]')?.textContent ?? ''"), inputText)
    await js("document.querySelector('button[aria-label=\"移除 removed-while-copying.md\"]')?.click()")
    await new Promise(resolve => setTimeout(resolve, 750))
    assert.equal(await js<boolean>("!document.body.innerText.includes('removed-while-copying.md') && !(document.querySelector('[data-composer-input]')?.textContent ?? '').includes('removed-while-copying.md')"), true)
    const fileName = 'source notes.md'
    const fileContent = '# Session A resource\n\nOnly session A should submit this.\n'
    assert.equal(await selectFile(fileName, 'text/markdown', fileContent), true)
    const ready = await waitFor(
      () => js<{ body: string; draft: string }>("({ body: document.body.innerText, draft: document.querySelector('[data-composer-input]')?.textContent ?? '' })"),
      value => value.body.includes(fileName) && value.body.includes('已复制，发送后读取')
        && value.draft.includes(inputText) && value.draft.includes('source notes.md'),
      'Selected resource was not copied into the current native draft',
    )
    const pathMatch = ready.draft.match(/@"([^"]+source notes\.md)"/u)
    assert.ok(pathMatch?.[1])
    const importedRelativePath = pathMatch[1]
    const importedPath = path.join(baseline.workspacePath, importedRelativePath)
    assert.equal(fs.readFileSync(importedPath, 'utf8'), fileContent)

    step = 'session-isolation'; report('fail')
    await clickSession('会话乙')
    await waitFor(
      () => js<{ body: string; draft: string }>("({ body: document.body.innerText, draft: document.querySelector('[data-composer-input]')?.textContent ?? '' })"),
      value => !value.body.includes(fileName) && !value.draft.includes(fileName),
      'Session A resource crossed into Session B',
    )
    await clickSession('会话甲')
    await waitFor(
      () => js<{ body: string; draft: string }>("({ body: document.body.innerText, draft: document.querySelector('[data-composer-input]')?.textContent ?? '' })"),
      value => value.body.includes(fileName) && value.draft.includes(fileName),
      'Returning to Session A did not restore its pending resource',
    )

    step = 'send-native-request'; report('fail')
    await js("document.querySelector('button[aria-label=\"发送消息\"]')?.click()")
    await waitFor(
      () => js<{ body: string; draft: string }>("({ body: document.body.innerText, draft: document.querySelector('[data-composer-input]')?.textContent ?? '' })"),
      value => value.draft === '' && value.body.includes('甲会话回复。') && !value.body.includes('已复制，发送后读取'),
      'Native send did not consume the resource-bearing draft',
    )
    const receivedPath = path.join(home, 't06-session-resource-received.json')
    await waitFor(
      async () => fs.existsSync(receivedPath),
      Boolean,
      'Test model did not receive the resource-bearing request',
    )
    assert.ok(fs.readFileSync(receivedPath, 'utf8').includes(importedRelativePath))
    for (const file of baseline.files) {
      assert.equal(createHash('sha256').update(fs.readFileSync(file.path)).digest('hex'), file.digest)
    }
    fs.writeFileSync(path.join(output, 'ready.png'), (await window.webContents.capturePage()).toPNG())
    step = 'complete'; report('pass')
  } catch (error) {
    report('fail', error instanceof Error ? error.stack : String(error))
    throw error
  } finally {
    window?.destroy()
    await host?.stop()
    app.quit()
  }
}

void run()
