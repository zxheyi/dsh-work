import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

import { createOfficialLauncher, prepareDevelopmentProfile } from '../packages/runtime-host/official-launcher.ts'
import { createRuntimeHost, type RuntimeHost } from '../packages/runtime-host/index.ts'
import { installPermissionTestProfile, PERMISSION_TEST_BASELINE_FILE } from './support/permission-test-profile.ts'

const requestedHome = process.env.DSH_WORK_E2E_HOME
if (!requestedHome) throw new Error('explicit Session permission test home is required')
const home = requestedHome
const requestedNode = process.env.DSH_WORK_NODE
if (!requestedNode) throw new Error('explicit standalone Node is required; no global fallback')
const node = requestedNode
const output = path.resolve('artifacts/session-permission')
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
    step = 'prepare-profile'; report('fail')
    prepareDevelopmentProfile(home)
    installPermissionTestProfile(home)
    const patchPath = path.join(home, 'profiles/dsh-work/cordis.patch.yml')
    const patch = JSON.parse(fs.readFileSync(patchPath, 'utf8')) as Array<{
      id?: string
      config?: { printUrl?: boolean }
    }>
    const webRuntime = patch.find(row => row.id === 'web-runtime')
    assert.ok(webRuntime?.config)
    webRuntime.config.printUrl = true
    fs.writeFileSync(patchPath, JSON.stringify(patch))

    step = 'launch-runtime'; report('fail')
    const port = await reserveLoopbackPort()
    const origin = `http://127.0.0.1:${String(port)}`
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

    step = 'open-native-shell'; report('fail')
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
      () => js<boolean>("(() => { for (const label of ['继续', '稍后配置']) { const button = Array.from(document.querySelectorAll('button')).find(item => item.textContent?.trim() === label); if (button instanceof HTMLButtonElement) button.click() } return Boolean(document.querySelector('[data-composer-input]')) && document.body.innerText.includes('权限会话甲') && document.body.innerText.includes('权限会话乙') })()"),
      value => value,
      'Permission fixture did not become ready',
    )
    const baseline = JSON.parse(fs.readFileSync(path.join(home, PERMISSION_TEST_BASELINE_FILE), 'utf8')) as {
      sessionA: string
      sessionB: string
      allowPrompt: string
      rejectPrompt: string
      continuePrompt: string
      actionPath: string
      files: Array<{ path: string; digest: string }>
    }
    const clickSession = async (title: string): Promise<void> => {
      const source = "(() => { const row = Array.from(document.querySelectorAll('[role=treeitem]')).find(item => item.textContent?.includes(" + JSON.stringify(title) + ")); if (!(row instanceof HTMLElement)) return false; row.click(); return true })()"
      assert.equal(await js<boolean>(source), true)
    }
    const setDraft = async (text: string): Promise<string> => {
      const source = "(async () => { const input = document.querySelector('[data-composer-input]'); if (!(input instanceof HTMLElement)) return ''; input.focus(); input.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: " + JSON.stringify(text) + ", bubbles: true, cancelable: true })); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); return input.textContent ?? '' })()"
      return js<string>(source)
    }
    const send = async (text: string): Promise<void> => {
      assert.equal(await setDraft(text), text)
      const clicked = await js<boolean>("(() => { const input = document.querySelector('[data-composer-input]'); const card = input?.closest('[data-composer-card]'); const buttons = card?.querySelectorAll('button'); const button = buttons?.item((buttons?.length ?? 0) - 1); if (!(button instanceof HTMLButtonElement)) return false; button.click(); return true })()")
      assert.equal(clicked, true)
    }

    step = 'allow-once'; report('fail')
    await clickSession('权限会话乙')
    const draftB = '乙会话保留的未发送草稿'
    assert.equal(await setDraft(draftB), draftB)
    await clickSession('权限会话甲')
    await waitFor(
      () => js<string>("document.querySelector('[data-composer-input]')?.textContent ?? ''"),
      value => value === '',
      'Session A inherited Session B draft before approval',
    )
    await send(baseline.allowPrompt)
    await waitFor(
      () => js<string>("document.querySelector('[data-approval-key]')?.textContent ?? ''"),
      text => text.includes('等待审批') && text.includes('允许一次') && text.includes('拒绝')
        && text.includes('仅允许本次操作') && text.includes('allow'),
      'Native approval card did not expose operation, scope, and one-shot choices',
    )
    assert.equal(fs.existsSync(baseline.actionPath), false)
    fs.writeFileSync(path.join(output, 'permission.png'), (await window.webContents.capturePage()).toPNG())
    await clickSession('权限会话乙')
    await waitFor(
      () => js<string>("document.querySelector('[data-composer-input]')?.textContent ?? ''"),
      value => value === draftB,
      'A pending approval discarded the other Session draft',
    )
    await clickSession('权限会话甲')
    await waitFor(
      () => js<boolean>("Boolean(document.querySelector('[data-approval-key]'))"),
      value => value,
      'Returning to Session A did not restore its pending approval',
    )
    assert.equal(fs.existsSync(baseline.actionPath), false)
    assert.equal(await js<boolean>("(() => { const button = Array.from(document.querySelectorAll('[data-approval-key] button')).find(item => item.textContent?.trim() === '允许一次'); if (!(button instanceof HTMLButtonElement)) return false; button.click(); return true })()"), true)
    await waitFor(
      async () => fs.existsSync(baseline.actionPath) && fs.readFileSync(baseline.actionPath, 'utf8') === 'allow\n',
      value => value,
      'Allow once did not execute exactly the addressed restricted action',
    )
    await waitFor(
      () => js<string>('document.body.innerText'),
      text => text.includes('已按本次授权完成对应操作。') && !text.includes('等待审批'),
      'Composer did not recover after allow once',
    )

    step = 'reject'; report('fail')
    await send(baseline.rejectPrompt)
    await waitFor(
      () => js<string>("document.querySelector('[data-approval-key]')?.textContent ?? ''"),
      text => text.includes('仅允许本次操作') && text.includes('reject'),
      'The second restricted action bypassed one-shot approval',
    )
    assert.equal(await js<boolean>("(() => { const button = Array.from(document.querySelectorAll('[data-approval-key] button')).find(item => item.textContent?.trim() === '拒绝'); if (!(button instanceof HTMLButtonElement)) return false; button.click(); return true })()"), true)
    await waitFor(
      () => js<string>('document.body.innerText'),
      text => text.includes('已拒绝，本次受限操作没有执行。') && !text.includes('等待审批'),
      'Composer did not recover after rejection',
    )
    assert.equal(fs.readFileSync(baseline.actionPath, 'utf8'), 'allow\n')

    step = 'continue-after-reject'; report('fail')
    await send(baseline.continuePrompt)
    await waitFor(
      () => js<string>('document.body.innerText'),
      text => text.includes('拒绝不会阻断后续普通聊天。'),
      'Rejection prevented the Session from continuing ordinary chat',
    )
    assert.equal(await js<boolean>("Boolean(document.querySelector('[data-approval-key]'))"), false)
    assert.equal(fs.readFileSync(baseline.actionPath, 'utf8'), 'allow\n')
    for (const file of baseline.files) {
      assert.equal(createHash('sha256').update(fs.readFileSync(file.path)).digest('hex'), file.digest)
    }
    const sessionRecords = fs.readdirSync(path.join(home, 'sessions'), { recursive: true, encoding: 'utf8' })
      .filter(file => file.endsWith('.jsonl'))
      .map(file => fs.readFileSync(path.join(home, 'sessions', file), 'utf8'))
      .join('\n')
    assert.equal((sessionRecords.match(/"type":"approval\/asked"/gu) ?? []).length, 2)
    assert.equal((sessionRecords.match(/"type":"approval\/decided"/gu) ?? []).length, 2)
    assert.ok(sessionRecords.includes('"outcome":"allowed-once"'))
    assert.ok(sessionRecords.includes('"outcome":"rejected"'))

    await host.stop()
    host = null
    step = 'complete'; report('pass')
  } catch (error) {
    const detail = error instanceof Error ? error.stack ?? error.message : 'unknown failure'
    if (window && !window.isDestroyed()) {
      fs.writeFileSync(path.join(output, 'failure.png'), (await window.webContents.capturePage()).toPNG())
    }
    report('fail', detail)
    process.exitCode = 1
  } finally {
    await host?.stop().catch(() => {})
    window?.destroy()
    app.exit(typeof process.exitCode === 'number' ? process.exitCode : 0)
  }
}

void run()
