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

    step = 'composer-toolbar-consistency'; report('fail')
    const toolbar = await js<{ resource: Record<string, string>; permission: Record<string, string>; icon: { width: number; height: number } | null }>(`(() => {
      const resource = document.querySelector('.dsh-work-session-resource-trigger');
      const permission = document.querySelector('button[aria-label^="访问模式"]');
      const keys = ['fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'height', 'columnGap', 'borderRadius', 'color', 'padding'];
      const style = element => Object.fromEntries(keys.map(key => [key, getComputedStyle(element)[key]]));
      const rect = resource.querySelector('svg')?.getBoundingClientRect();
      return { resource: style(resource), permission: style(permission), icon: rect ? { width: rect.width, height: rect.height } : null };
    })()`)
    assert.deepEqual(toolbar.resource, toolbar.permission, 'Resource and permission controls must share native toolbar typography and geometry')
    assert.deepEqual(toolbar.icon, { width: 14, height: 14 }, 'Resource control must use the native 14px SVG icon')

    step = 'resource-picker-trigger'; report('fail')
    assert.equal(await js<boolean>(`(() => {
      const picker = document.querySelector('[data-work-session-resource] input[type=file]');
      let opened = false;
      picker.click = () => { opened = true; };
      document.querySelector('button[aria-label="添加资料"]').click();
      delete picker.click;
      return opened;
    })()`), true, 'Toolbar resource button must reach the picker in the resource dock')

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
      () => js<boolean>("document.body.innerText.includes('dropped.txt') && Boolean(document.querySelector('[data-composer-chip=reference]')) && Boolean(document.querySelector('img[alt=\"pixel.png\"]'))"),
      Boolean,
      'Mixed drop did not route the document to Work and the image to the native attachment owner',
    )
    window.show()
    window.focus()
    window.webContents.focus()
    await js("document.querySelector('[data-composer-input]')?.focus()")
    window.webContents.selectAll()
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' })
    await js("Array.from(document.querySelectorAll('button')).find(item => item.getAttribute('aria-label')?.includes('pixel.png'))?.click()")
    await waitFor(
      () => js<boolean>("!document.body.innerText.includes('dropped.txt') && !document.querySelector('img[alt=\"pixel.png\"]')"),
      Boolean,
      'Mixed-drop items could not be removed from their respective owners',
    )

    step = 'copy-current-session'; report('fail')
    const inputText = '请读取这份资料并确认。'
    await js("document.querySelector('[data-composer-input]')?.focus()")
    await window.webContents.insertText(inputText)
    await waitFor(
      () => js<string>("document.querySelector('[data-composer-input]')?.textContent ?? ''"),
      text => text.includes(inputText),
      'Typing did not reach the native composer before the copy test',
    )
    assert.equal(await selectSizedFile('removed-while-copying.md', 24 * 1024 * 1024), true)
    await waitFor(
      () => js<boolean>("Boolean(document.querySelector('[data-work-session-resource-name=\"removed-while-copying.md\"].is-copying'))"),
      Boolean,
      'Large resource did not enter the copying state',
    )
    fs.writeFileSync(path.join(output, 'copying.png'), (await window.webContents.capturePage()).toPNG())
    await js("(() => { const card = document.querySelector('[data-composer-card]'); const buttons = card?.querySelectorAll('button'); const send = buttons?.item((buttons?.length ?? 0) - 1); send?.setAttribute('aria-label', 'Send message'); send?.click(); document.querySelector('[data-composer-input]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) })()")
    assert.equal((await js<string>("document.querySelector('[data-composer-input]')?.textContent ?? ''")).trim(), inputText)
    await js("document.querySelector('button[aria-label=\"移除 removed-while-copying.md\"]')?.click()")
    await new Promise(resolve => setTimeout(resolve, 750))
    assert.equal(await js<boolean>("!document.body.innerText.includes('removed-while-copying.md') && !(document.querySelector('[data-composer-input]')?.textContent ?? '').includes('removed-while-copying.md')"), true)
    const fileName = 'source notes.md'
    const fileContent = '# Session A resource\n\nOnly session A should submit this.\n'
    await js("document.querySelector('.dsh-work-session-resource-trigger')?.focus()")
    assert.equal(await selectFile(fileName, 'text/markdown', fileContent), true)
    await waitFor(
      () => js<{ body: string; draft: string }>("({ body: document.body.innerText, draft: document.querySelector('[data-composer-input]')?.textContent ?? '' })"),
      value => value.body.includes(fileName) && !value.body.includes('attachment-')
        && value.draft.includes(inputText) && value.draft.includes('source notes.md'),
      'Selected resource was not copied into the current native draft',
    )
    assert.equal(await js<number>("document.querySelectorAll('[data-composer-input] [data-composer-chip=reference]').length"), 1, 'Imported file must be a native inline chip, not a visible internal path')
    const persistedDraft = await js<string>("JSON.parse(window.name.slice('dsh-work-recovery:v1:'.length)).draft")
    const pathMatch = persistedDraft.match(/@"([^"]+source notes\.md)"/u)
    assert.ok(pathMatch?.[1])
    const importedRelativePath = pathMatch[1]
    const importedPath = path.join(baseline.workspacePath, importedRelativePath)
    assert.equal(fs.readFileSync(importedPath, 'utf8'), fileContent)

    step = 'resource-composer-hit-targets'; report('fail')
    const interaction = await js<{ overlaps: boolean; focused: boolean }>(`(() => {
      const editor = document.querySelector('[data-composer-input]');
      const pending = document.querySelector('[aria-label="待发送资料"]');
      const a = editor.getBoundingClientRect();
      const b = pending?.getBoundingClientRect();
      return {
        overlaps: Boolean(b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top),
        focused: document.activeElement === editor,
      };
    })()`)
    assert.equal(interaction.overlaps, false, 'Pending resources must not cover the native text input')
    assert.equal(interaction.focused, true, 'Import must return focus to the native text input')

    window.show()
    window.focus()
    window.webContents.focus()
    await new Promise(resolve => setTimeout(resolve, 150))
    const point = await js<{ x: number; y: number }>(`(() => {
      const rect = document.querySelector('[data-composer-input]').getBoundingClientRect();
      return { x: Math.round(rect.right - 8), y: Math.round(rect.bottom - 6) };
    })()`)
    window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
    window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 })
    const followupText = '请用中文说明重点。'
    await window.webContents.insertText(followupText)
    await waitFor(
      () => js<string>("document.querySelector('[data-composer-input]')?.textContent ?? ''"),
      text => text.includes(followupText) && text.includes(fileName) && !text.includes(importedRelativePath),
      'Typing after file selection did not reach the native editor or damaged the file reference',
    )
    await new Promise(resolve => setTimeout(resolve, 350))
    fs.writeFileSync(path.join(output, 'resource-input.png'), (await window.webContents.capturePage()).toPNG())

    step = 'resource-narrow-layout'; report('fail')
    window.setSize(960, 680)
    await new Promise(resolve => setTimeout(resolve, 350))
    assert.equal(await js<boolean>(`(() => {
      const editor = document.querySelector('[data-composer-input]').getBoundingClientRect();
      const chip = document.querySelector('[data-composer-chip=reference]').getBoundingClientRect();
      return chip.top >= editor.top && chip.right <= editor.right && !document.querySelector('[aria-label="待发送资料"]');
    })()`), true, 'Resources must leave the editor usable at the minimum window size')
    fs.writeFileSync(path.join(output, 'resource-input-narrow.png'), (await window.webContents.capturePage()).toPNG())
    window.setSize(1440, 900)
    await new Promise(resolve => setTimeout(resolve, 350))
    await js("document.querySelector('button[aria-label=\"打开侧边栏\"]')?.click()")
    await waitFor(
      () => js<boolean>("Array.from(document.querySelectorAll('[role=treeitem]')).some(item => item.textContent?.includes('会话乙'))"),
      Boolean,
      'Sidebar did not expand after the narrow-layout check',
    )

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

    step = 'restore-inline-reference'; report('fail')
    window.webContents.reload()
    await waitFor(
      () => js<boolean>("(document.querySelector('[data-composer-chip=reference]')?.textContent ?? '').includes('source notes.md') && (document.querySelector('[data-composer-input]')?.textContent ?? '').includes('请用中文说明重点。')"),
      Boolean,
      'Reload did not restore the native file chip and accompanying text',
    )

    step = 'send-native-request'; report('fail')
    await js("document.querySelector('[data-composer-input]')?.focus()")
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
    await waitFor(
      () => js<{ body: string; draft: string }>("({ body: document.body.innerText, draft: document.querySelector('[data-composer-input]')?.textContent ?? '' })"),
      value => value.draft === '' && value.body.includes('甲会话回复。'),
      'Native send did not consume the resource-bearing draft',
    )
    const receivedPath = path.join(home, 't06-session-resource-received.json')
    await waitFor(
      async () => fs.existsSync(receivedPath),
      Boolean,
      'Test model did not receive the resource-bearing request',
    )
    assert.ok(fs.readFileSync(receivedPath, 'utf8').includes(importedRelativePath))
    assert.ok(fs.readFileSync(receivedPath, 'utf8').includes(followupText))
    for (const file of baseline.files) {
      assert.equal(createHash('sha256').update(fs.readFileSync(file.path)).digest('hex'), file.digest)
    }
    fs.writeFileSync(path.join(output, 'ready.png'), (await window.webContents.capturePage()).toPNG())
    step = 'hero-resource-composer'; report('fail')
    await js("document.querySelector('button[aria-label=\"新建会话\"]')?.click()")
    await waitFor(
      () => js<boolean>("Boolean(document.querySelector('[data-phase=hero] [data-work-session-resource]'))"),
      Boolean,
      'New session did not mount the resource dock on the home composer',
    )
    for (let index = 0; index < 6; index += 1) {
      assert.equal(await selectFile(`hero-${index}.txt`, 'text/plain', `fixture ${index}`), true)
    }
    await waitFor(
      () => js<number>("document.querySelectorAll('[data-composer-chip=reference]').length"),
      value => value === 6,
      'Home composer did not finish all file copies',
    )
    assert.equal(await js<boolean>(`(() => {
      const input = document.querySelector('[data-composer-input]');
      const a = input.getBoundingClientRect();
      const chips = Array.from(input.querySelectorAll('[data-composer-chip=reference]'));
      return !document.querySelector('[aria-label="待发送资料"]') && !input.textContent.includes('attachment-')
        && chips.every(chip => { const r = chip.getBoundingClientRect(); return r.top >= a.top && r.right <= a.right; })
        && document.activeElement === input;
    })()`), true, 'Home resource list must align with the composer without covering it or losing focus')
    step = 'delete-inline-reference'; report('fail')
    await js(`(() => {
      const editor = document.querySelector('[data-composer-input]');
      editor.focus();
      const chip = editor.querySelector('[data-composer-chip=reference]');
      const range = document.createRange();
      range.setStartAfter(chip); range.collapse(true);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    })()`)
    await new Promise(resolve => setTimeout(resolve, 100))
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' })
    await waitFor(
      () => js<number>("document.querySelectorAll('[data-composer-chip=reference]').length"),
      value => value === 5,
      'Backspace did not delete a single file chip',
    )
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Z', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Z', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] })
    await waitFor(
      () => js<number>("document.querySelectorAll('[data-composer-chip=reference]').length"),
      value => value === 6,
      'Native undo did not restore the deleted file chip',
    )
    await js(`(() => {
      const editor = document.querySelector('[data-composer-input]');
      const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    })()`)
    await window.webContents.insertText('总结这些资料。')
    await new Promise(resolve => setTimeout(resolve, 350))
    fs.writeFileSync(path.join(output, 'hero-resources.png'), (await window.webContents.capturePage()).toPNG())
    await js("document.querySelector('button[aria-label=\"发送消息\"]')?.click()")
    await waitFor(
      () => js<boolean>("(document.querySelector('[data-composer-input]')?.textContent ?? '') === '' && !document.querySelector('[aria-label=\"待发送资料\"]')"),
      Boolean,
      'Home send button did not submit text with the pending resources',
    )
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
