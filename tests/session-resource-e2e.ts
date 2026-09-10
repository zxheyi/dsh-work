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
      () => js<boolean>("(() => { for (const label of ['继续', '稍后配置']) { const button = Array.from(document.querySelectorAll('button')).find(item => item.textContent?.trim() === label); if (button instanceof HTMLButtonElement) button.click() } return Boolean(document.querySelector('[data-composer-input]')) && Boolean(document.querySelector('input[type=file]')) && document.body.innerText.includes('会话甲') })()"),
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
      "(() => { const input = document.querySelector('input[type=file]'); if (!(input instanceof HTMLInputElement)) return false; const transfer = new DataTransfer(); transfer.items.add(new File([" + JSON.stringify(content) + "], " + JSON.stringify(name) + ", { type: " + JSON.stringify(type) + " })); Object.defineProperty(input, 'files', { configurable: true, value: transfer.files }); input.dispatchEvent(new Event('change', { bubbles: true })); return true })()",
    )
    const body = () => js<string>('document.body.innerText')
    const remove = (name: string) => js(`Array.from(document.querySelectorAll('button')).find(button => button.getAttribute('aria-label') === ${JSON.stringify('移除文件 ' + name)})?.click()`)
    await clickSession('会话甲')
    step = 'single-native-picker'; report('fail')
    assert.equal(await js<number>("document.querySelectorAll('input[type=file]').length"), 1)
    assert.equal(await js<boolean>("Boolean(document.querySelector('button[aria-label=\"添加附件\"]')) && !document.querySelector('.dsh-work-session-resource-trigger')"), true)

    step = 'native-failure-and-retry'; report('fail')
    let refuseUpload = true
    const filter = { urls: [origin + '/api/session/uploadFileBinary*'] }
    window.webContents.session.webRequest.onBeforeRequest(filter, (_details, callback) => callback({ cancel: refuseUpload }))
    assert.equal(await selectFile('retry.pdf', 'application/pdf', '%PDF-fixture'), true)
    await waitFor(body, value => value.includes('上传失败'), 'Native upload failure not shown')
    refuseUpload = false
    await js("Array.from(document.querySelectorAll('button')).find(button => button.getAttribute('aria-label')?.includes('重试'))?.click()")
    await waitFor(body, value => value.includes('retry.pdf') && !value.includes('上传失败') && !value.includes('上传中'), 'Native retry did not finish')
    await remove('retry.pdf')
    await waitFor(body, value => !value.includes('retry.pdf'), 'Native file removal failed')

    step = 'native-cancel-pending'; report('fail')
    let releaseUpload: ((response: { cancel: boolean }) => void) | undefined
    window.webContents.session.webRequest.onBeforeRequest(filter, (_details, callback) => { releaseUpload = callback })
    assert.equal(await selectFile('cancel.xlsx', 'application/octet-stream', 'cancel me'), true)
    await waitFor(body, value => value.includes('上传中'), 'Native pending state not shown')
    await remove('cancel.xlsx')
    releaseUpload?.({ cancel: true })
    window.webContents.session.webRequest.onBeforeRequest(null)
    await waitFor(body, value => !value.includes('cancel.xlsx'), 'Cancelled upload remained in draft')

    step = 'mixed-drop-native-owner'; report('fail')
    await js(`(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['spreadsheet'], 'dropped.xlsx', { type: 'application/octet-stream' }));
      const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), c => c.charCodeAt(0));
      transfer.items.add(new File([bytes], 'pixel.png', { type: 'image/png' }));
      document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    })()`)
    await waitFor(() => js<boolean>("document.body.innerText.includes('dropped.xlsx') && Boolean(document.querySelector('img[alt=\"pixel.png\"]'))"), Boolean, 'Native mixed drop failed')
    await remove('dropped.xlsx')
    await js("Array.from(document.querySelectorAll('button')).find(button => button.getAttribute('aria-label')?.includes('pixel.png'))?.click()")

    step = 'native-file-session-isolation'; report('fail')
    const fileName = 'source notes.md'
    const fileContent = '# Native stored source\n'
    assert.equal(await selectFile(fileName, 'text/markdown', fileContent), true)
    await waitFor(body, value => value.includes(fileName) && !value.includes('上传中'), 'Native upload did not complete')
    const workspaceBefore = fs.readdirSync(baseline.workspacePath).sort()
    await clickSession('会话乙')
    await waitFor(body, value => !value.includes(fileName), 'Native file crossed sessions')
    await clickSession('会话甲')
    await waitFor(body, value => value.includes(fileName), 'Native draft file did not return')
    await js("document.querySelector('[data-composer-input]')?.focus()")
    await window.webContents.insertText('请读取附件。')
    fs.writeFileSync(path.join(output, 'native-upload.png'), (await window.webContents.capturePage()).toPNG())
    window.setSize(960, 680)
    await new Promise(resolve => setTimeout(resolve, 250))
    fs.writeFileSync(path.join(output, 'native-upload-narrow.png'), (await window.webContents.capturePage()).toPNG())
    step = 'send-native-receipt'; report('fail')
    await js("document.querySelector('button[aria-label=\"发送消息\"]')?.click()")
    const receivedPath = path.join(home, 't06-session-resource-received.json')
    await waitFor(async () => fs.existsSync(receivedPath), Boolean, 'Native model did not receive attached file')
    const received = fs.readFileSync(receivedPath, 'utf8')
    assert.ok(received.includes(fileName))
    assert.ok(received.includes('请读取附件。'))
    assert.ok(!received.includes('cancel.xlsx'))
    assert.deepEqual(fs.readdirSync(baseline.workspacePath).sort(), workspaceBefore, 'Native upload must not create a second DWork copy')
    for (const file of baseline.files) assert.equal(createHash('sha256').update(fs.readFileSync(file.path)).digest('hex'), file.digest)
    step = 'complete'; report('pass')
  } catch (error) {
    if (window) fs.writeFileSync(path.join(output, 'failure-debug.json'), JSON.stringify(await window.webContents.executeJavaScript("({ body: document.body.innerText, retained: window.name, url: location.origin + location.pathname, chips: document.querySelectorAll('[data-composer-chip]').length })"), null, 2))
    report('fail', error instanceof Error ? error.stack : String(error))
    throw error
  } finally {
    window?.destroy()
    await host?.stop()
    app.quit()
  }
}

void run()
