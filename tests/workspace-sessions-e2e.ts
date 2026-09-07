// Explicit Electron entry point for T04 native Workspace/Session acceptance.
import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

import { createOfficialLauncher, prepareDevelopmentProfile } from '../packages/runtime-host/official-launcher.ts'
import { createRuntimeHost, type RuntimeHost } from '../packages/runtime-host/index.ts'
import {
  installWorkspaceTestProfile,
  WORKSPACE_TEST_AUDIT_FILE,
  WORKSPACE_TEST_NATIVE_SESSION_FILE,
} from './support/workspace-test-profile.ts'

const requestedHome = process.env.DSH_WORK_E2E_HOME
const requestedPhase = process.env.DSH_WORK_E2E_PHASE
if (!requestedHome) throw new Error('explicit Workspace/Session test home is required')
if (requestedPhase !== 'empty' && requestedPhase !== 'create' && requestedPhase !== 'restore') {
  throw new Error('Workspace/Session test phase must be empty, create, or restore')
}
const home = requestedHome
const phase = requestedPhase
const output = path.resolve('artifacts/workspace-sessions')
const reportPath = path.join(output, `${phase}-result.json`)
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', path.join(home, `electron-${phase}`))
app.commandLine.appendSwitch('disable-background-networking')
app.commandLine.appendSwitch('force-device-scale-factor', '1')

let step = 'boot'
let host: RuntimeHost | null = null
let window: BrowserWindow | null = null
const writeReport = (status: 'pass' | 'fail', detail?: string): void => {
  fs.writeFileSync(reportPath, JSON.stringify({ status, phase, step, detail }, null, 2))
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
  const node = process.env.DSH_WORK_NODE
  if (!node) throw new Error('explicit standalone Node is required; no global fallback')
  await app.whenReady()
  try {
    step = 'prepare-profile'; writeReport('fail')
    prepareDevelopmentProfile(home)
    if (phase !== 'empty') installWorkspaceTestProfile(home, phase)
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
      () => js<boolean>(`(() => {
        for (const label of ['继续', '稍后配置']) {
          const button = Array.from(document.querySelectorAll('button'))
            .find(item => item.textContent?.trim() === label)
          if (button instanceof HTMLButtonElement) button.click()
        }
        return Boolean(document.querySelector('[data-composer-card]'))
      })()`),
      value => value,
      'Native conversation shell did not become ready',
    )

    if (phase === 'empty') {
      step = 'empty-workspace-entry'; writeReport('fail')
      await waitFor(
        () => js<{ hero: boolean; sidebar: boolean }>(`({
          hero: Array.from(document.querySelectorAll('button'))
            .some(item => item.textContent?.trim() === '选择工作区'),
          sidebar: Boolean(document.querySelector('button[aria-label="添加工作区"]')),
        })`),
        value => value.hero && value.sidebar,
        'An empty Profile did not expose native Workspace selection entries',
      )
    } else {
      step = phase === 'create' ? 'create-native-session' : 'restore-two-sessions'; writeReport('fail')
      const audit = JSON.parse(fs.readFileSync(path.join(home, WORKSPACE_TEST_AUDIT_FILE), 'utf8')) as {
        workspaceId: string
        workspacePath: string
        primarySessionId: string
        sentinelPath: string
        sentinelBytes: string
        sentinelDigest: string
        primaryPrompt: string
      }
      assert.equal(
        fs.realpathSync(path.dirname(audit.sentinelPath)),
        fs.realpathSync(audit.workspacePath),
      )
      assert.equal(fs.readFileSync(audit.sentinelPath, 'utf8'), 'legacy bytes stay in their original workspace\n')
      assert.equal(fs.readFileSync(audit.sentinelPath).toString('base64'), audit.sentinelBytes)
      await waitFor(
        () => js<boolean>(`document.body.innerText.includes('旧 Work 会话')`),
        value => value,
        'The mapped Work Session did not appear in the native Workspace tree',
      )

      step = 'legacy-deliverable'; writeReport('fail')
      await waitFor(
        () => js<boolean>(`Boolean(document.querySelector('[data-work-legacy-deliverable-open]'))`),
        value => value,
        'The bounded legacy deliverable action was not available',
      )
      await js(`document.querySelector('[data-work-legacy-deliverable-open]')?.click()`)
      await waitFor(
        () => js<boolean>(`Boolean(document.querySelector('[data-work-legacy-deliverable-preview]'))
          && document.querySelector('[data-work-legacy-deliverable-preview]')?.textContent
            === 'legacy bytes stay in their original workspace\\n'`),
        value => value,
        'The bounded legacy deliverable preview did not expose the existing file',
      )
      await js(`document.querySelector('button[aria-label="关闭旧成果"]')?.click()`)

      if (phase === 'create') {
        step = 'create-native-session'; writeReport('fail')
        await js(`document.querySelector('button[aria-label="在“兼容工作区”中新建会话"]')?.click()`)
        await waitFor(
          () => js<boolean>(`Boolean(document.querySelector('[data-composer-input]'))
            && document.querySelector('[data-composer-input]')?.textContent === ''`),
          value => value,
          'Native new-session action did not open a blank Session in the Workspace',
        )
        const prompt = '建立同目录的第二条会话。'
        assert.equal(await js<string>(`(async () => {
          const input = document.querySelector('[data-composer-input]')
          if (!(input instanceof HTMLElement)) return ''
          input.focus()
          input.dispatchEvent(new InputEvent('beforeinput', {
            inputType: 'insertText', data: ${JSON.stringify('建立同目录的第二条会话。')},
            bubbles: true, cancelable: true,
          }))
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          return input.textContent ?? ''
        })()`), prompt)
        await js(`document.querySelector('button[aria-label="发送消息"]')?.click()`)
        await waitFor(
          () => js<boolean>(`document.body.innerText.includes('会话已建立。')
            && document.body.innerText.includes('新增原生会话')`),
          value => value,
          'The UI-created Session did not send and receive a native conversation turn',
        )
        await waitFor(
          async () => fs.existsSync(path.join(home, WORKSPACE_TEST_NATIVE_SESSION_FILE)),
          value => value,
          'The Host did not observe the UI-created Session in the mapped Workspace',
        )
      }
      const native = JSON.parse(fs.readFileSync(
        path.join(home, WORKSPACE_TEST_NATIVE_SESSION_FILE),
        'utf8',
      )) as {
        secondSessionId: string
        workspaceId: string
        workspacePath: string
        secondPrompt: string
      }
      assert.notEqual(audit.primarySessionId, native.secondSessionId)
      assert.equal(native.workspaceId, audit.workspaceId)
      assert.equal(native.workspacePath, audit.workspacePath)
      await waitFor(
        () => js<{ workspaceCount: number; sessionTitles: string[] }>(`(() => {
          const rows = Array.from(document.querySelectorAll('[role="treeitem"]'))
          return {
            workspaceCount: rows.filter(row => row.textContent?.includes('兼容工作区')).length,
            sessionTitles: rows.map(row => row.textContent?.trim() ?? '')
              .filter(title => title.includes('旧 Work 会话')
                || title.includes('新增原生会话')
                || title.includes('建立同目录的第二条会话。')),
          }
        })()`),
        value => value.workspaceCount === 1
          && value.sessionTitles.some(title => title.includes('旧 Work 会话'))
          && value.sessionTitles.some(title => title.includes('新增原生会话')
            || title.includes('建立同目录的第二条会话。')),
        'The native Workspace tree did not show both mapped Sessions',
      )
      assert.equal(await js<boolean>(`Boolean(
        document.querySelector('[data-work-legacy-open], [data-work-legacy-surface]')
      )`), false)
    }

    step = 'capture'; writeReport('fail')
    fs.writeFileSync(path.join(output, `${phase}.png`), (await window.webContents.capturePage()).toPNG())
    await host.stop()
    host = null
    step = 'complete'; writeReport('pass')
  } catch (error) {
    const detail = error instanceof Error ? error.stack ?? error.message : 'unknown failure'
    if (window && !window.isDestroyed()) {
      fs.writeFileSync(path.join(output, `${phase}-failure.png`), (await window.webContents.capturePage()).toPNG())
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
