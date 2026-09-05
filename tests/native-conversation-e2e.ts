// Explicit Electron entry point for T03 native conversation acceptance.
import { app, BrowserWindow, session } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

import { createOfficialLauncher, prepareDevelopmentProfile } from '../packages/runtime-host/official-launcher.ts'
import { createRuntimeHost, type RuntimeHost } from '../packages/runtime-host/index.ts'
import {
  CHAT_TEST_ABORT_FILE,
  CHAT_TEST_CONNECTION_AUDIT_FILE,
  CHAT_TEST_CONTROL_FILE,
  CHAT_TEST_SESSION_ID,
  installChatTestProfile,
} from './support/chat-test-profile.ts'

const requestedHome = process.env.DSH_WORK_E2E_HOME
const requestedPhase = process.env.DSH_WORK_E2E_PHASE
if (!requestedHome) throw new Error('explicit conversation-test home is required')
if (requestedPhase !== 'missing' && requestedPhase !== 'connected') {
  throw new Error('conversation-test phase must be missing or connected')
}
const home = requestedHome
const phase = requestedPhase
const output = path.resolve('artifacts/conversation')
const reportPath = path.join(output, `${phase}-result.json`)
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', path.join(home, 'electron-user-data'))
app.commandLine.appendSwitch('disable-background-networking')
app.commandLine.appendSwitch('force-device-scale-factor', '1')

let step = 'boot'
let host: RuntimeHost | null = null
let window: BrowserWindow | null = null
const diagnostics: string[] = []
const writeReport = (status: 'pass' | 'fail', detail?: string): void => {
  fs.writeFileSync(reportPath, JSON.stringify({
    status,
    phase,
    step,
    detail,
    sessionId: CHAT_TEST_SESSION_ID,
    diagnostics: diagnostics.slice(-20),
  }, null, 2))
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
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  })
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
    installChatTestProfile(home, phase === 'connected')
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
      child.stderr.on('data', bytes => {
        diagnostics.push(bytes.toString('utf8').replace(/([?&](?:token|code)=)[^&\s]+/gi, '$1[redacted]').slice(0, 2_000))
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

    step = 'open-native-session'; writeReport('fail')
    const isolatedSession = session.fromPartition(`dsh-work-conversation-${phase}-${String(Date.now())}`)
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
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => {
      if (new URL(url).origin !== origin) event.preventDefault()
    })
    await window.loadURL(authenticated)
    const js = <T = unknown>(source: string): Promise<T> =>
      window!.webContents.executeJavaScript(source) as Promise<T>
    const readSessionRecords = (): string => {
      const sessionRoot = path.join(home, 'sessions')
      if (!fs.existsSync(sessionRoot)) return ''
      return fs.readdirSync(sessionRoot, { recursive: true, encoding: 'utf8' })
        .filter(file => file.endsWith('.jsonl'))
        .map(file => fs.readFileSync(path.join(sessionRoot, file), 'utf8'))
        .join('\n')
    }
    const reloadNativeSession = async (dismissSetupPrompt = false): Promise<void> => {
      const loaded = new Promise<void>(resolve => {
        window!.webContents.once('did-finish-load', () => resolve())
      })
      window!.webContents.reload()
      await loaded
      if (dismissSetupPrompt) {
        await waitFor(
          () => js<boolean>(`Boolean(Array.from(document.querySelectorAll('button'))
            .find(item => item.textContent?.trim() === '稍后配置'))`),
          value => value,
          'Model setup prompt did not appear after route loss',
        )
        await js(`Array.from(document.querySelectorAll('button'))
          .find(item => item.textContent?.trim() === '稍后配置')?.click()`)
        await waitFor(
          () => js<boolean>(`!Array.from(document.querySelectorAll('button'))
            .some(item => item.textContent?.trim() === '稍后配置')`),
          value => value,
          'Model setup prompt could not be dismissed after reload',
        )
      }
      await waitFor(
        () => js<{ composer: boolean; workspace: boolean }>(`({
          composer: Boolean(document.querySelector('[data-composer-input]')),
          workspace: document.body.innerText.includes('普通聊天验收'),
        })`),
        value => value.composer && value.workspace,
        'Native test Session did not recover after reload',
      )
    }
    await waitFor(
      () => js<boolean>(`(async () => {
        const button = Array.from(document.querySelectorAll('button'))
          .find(item => item.textContent?.trim() === '继续')
        if (button instanceof HTMLButtonElement) button.click()
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        return !document.body.innerText.includes('内测声明')
          && !Array.from(document.querySelectorAll('button')).some(item => item.textContent?.trim() === '继续')
      })()`),
      value => value,
      'Upstream notice could not be dismissed',
    )
    await waitFor(
      () => js<{ composer: boolean; workspace: boolean }>(`({
        composer: Boolean(document.querySelector('[data-composer-input]')),
        workspace: document.body.innerText.includes('普通聊天验收'),
      })`),
      value => value.composer && value.workspace,
      'Native test Workspace and Session did not become ready',
    )

    if (phase === 'missing') {
      step = 'missing-connection-block'; writeReport('fail')
      const blocked = await waitFor(
        () => js<{ disabled: boolean; locked: boolean; text: string }>(`({
          disabled: Boolean(document.querySelector('button[aria-label="发送消息"]')?.disabled),
          locked: document.querySelector('[data-composer-input]')?.getAttribute('aria-disabled') === 'true',
          text: document.body.innerText,
        })`),
        value => value.disabled && value.locked && value.text.includes('当前模型不可用，请先选择模型'),
        'Missing model route did not lock the native composer with guidance',
      )
      assert.ok(blocked.text.includes('dsh-work-missing/unavailable'))
      const before = blocked.text
      await js(`document.querySelector('[data-composer-input]')?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', bubbles: true, cancelable: true,
      }))`)
      await new Promise(resolve => setTimeout(resolve, 200))
      assert.equal(await js<string>('document.body.innerText'), before)
    } else {
      step = 'draft-survives-model-selection'; writeReport('fail')
      await waitFor(
        () => js<boolean>(`Boolean(document.querySelector('button[aria-label^="选择模型，当前 测试快速模型"]'))`),
        value => value,
        'Real model directory did not expose the connected test model',
      )
      assert.ok((await js<string>('document.body.innerText')).includes('标准模式'))
      const draft = '请用一句话确认普通聊天已连接'
      assert.equal(await js<string>(`(async () => {
        const input = document.querySelector('[data-composer-input]')
        if (!(input instanceof HTMLElement)) return ''
        input.focus()
        input.dispatchEvent(new InputEvent('beforeinput', {
          inputType: 'insertText', data: ${JSON.stringify(draft)}, bubbles: true, cancelable: true,
        }))
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        return input.textContent ?? ''
      })()`), draft)

      step = 'connection-loss-retains-draft'; writeReport('fail')
      fs.writeFileSync(path.join(home, CHAT_TEST_CONTROL_FILE), 'disconnected\n')
      await waitFor(
        async () => fs.existsSync(path.join(home, CHAT_TEST_CONNECTION_AUDIT_FILE))
          && fs.readFileSync(path.join(home, CHAT_TEST_CONNECTION_AUDIT_FILE), 'utf8')
            .split(/\r?\n/u).includes('disconnected'),
        value => value,
        'Test adapter did not withdraw its model route',
        3_000,
      )
      await reloadNativeSession(true)
      await waitFor(
        () => js<{ disabled: boolean; locked: boolean; draft: string }>(`({
          disabled: Boolean(document.querySelector('button[aria-label="发送消息"]')?.disabled),
          locked: document.querySelector('[data-composer-input]')?.getAttribute('aria-disabled') === 'true',
          draft: document.querySelector('[data-composer-input]')?.textContent ?? '',
        })`),
        value => value.disabled && value.locked && value.draft === draft,
        'Losing the selected route did not lock the populated composer',
      )
      const recordBeforeBlockedSubmit = readSessionRecords()
      assert.ok(!recordBeforeBlockedSubmit.includes(draft))
      await js(`(() => {
        const input = document.querySelector('[data-composer-input]')
        input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
        document.querySelector('button[aria-label="发送消息"]')?.click()
      })()`)
      await new Promise(resolve => setTimeout(resolve, 500))
      assert.equal(readSessionRecords(), recordBeforeBlockedSubmit)
      assert.equal(await js<string>(`document.querySelector('[data-composer-input]')?.textContent ?? ''`), draft)

      step = 'connection-restores-draft'; writeReport('fail')
      fs.writeFileSync(path.join(home, CHAT_TEST_CONTROL_FILE), 'connected\n')
      await waitFor(
        async () => fs.existsSync(path.join(home, CHAT_TEST_CONNECTION_AUDIT_FILE))
          && fs.readFileSync(path.join(home, CHAT_TEST_CONNECTION_AUDIT_FILE), 'utf8')
            .split(/\r?\n/u).includes('connected'),
        value => value,
        'Test adapter did not restore its model route',
        3_000,
      )
      await reloadNativeSession()
      await waitFor(
        () => js<{ ready: boolean; unlocked: boolean; draft: string }>(`({
          ready: Boolean(document.querySelector('button[aria-label^="选择模型，当前 测试快速模型"]')),
          unlocked: document.querySelector('[data-composer-input]')?.getAttribute('aria-disabled') !== 'true',
          draft: document.querySelector('[data-composer-input]')?.textContent ?? '',
        })`),
        value => value.ready && value.unlocked && value.draft === draft,
        'Restoring the selected route did not preserve and unlock the draft',
      )

      step = 'draft-survives-model-selection'; writeReport('fail')
      await js(`document.querySelector('button[aria-label^="选择模型，当前 测试快速模型"]')?.click()`)
      await waitFor(
        () => js<boolean>(`Boolean(document.querySelector('[role="menu"] button'))`),
        value => value,
        'Model menu root did not open',
      )
      await js(`document.querySelector('[role="menu"] button')?.click()`)
      await waitFor(
        () => js<boolean>(`Boolean(document.querySelector('button[title="测试稳定模型"]'))`),
        value => value,
        'Connected model catalog did not list the alternate model',
      )
      await js(`document.querySelector('button[title="测试稳定模型"]')?.click()`)
      await waitFor(
        () => js<{ selected: boolean; draft: string }>(`({
          selected: Boolean(document.querySelector('button[aria-label^="选择模型，当前 测试稳定模型"]')),
          draft: document.querySelector('[data-composer-input]')?.textContent ?? '',
        })`),
        value => value.selected && value.draft === draft,
        'Model selection did not preserve the native composer draft',
      )

      const send = async (text: string, expected: string): Promise<void> => {
        assert.equal(await js<string>(`(async () => {
          const input = document.querySelector('[data-composer-input]')
          if (!(input instanceof HTMLElement)) return ''
          input.focus()
          input.dispatchEvent(new InputEvent('beforeinput', {
            inputType: 'insertText', data: ${JSON.stringify(text)}, bubbles: true, cancelable: true,
          }))
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          return input.textContent ?? ''
        })()`), text)
        await js(`document.querySelector('button[aria-label="发送消息"]')?.click()`)
        await waitFor(
          () => js<string>('document.body.innerText'),
          value => value.includes(text) && value.includes(expected),
          `Native conversation did not render ${expected}`,
        )
        await waitFor(
          () => js<boolean>(`Boolean(document.querySelector('button[aria-label="发送消息"]'))`),
          value => value,
          'Native composer did not return to its idle state',
        )
      }

      step = 'ordinary-chat'; writeReport('fail')
      await js(`document.querySelector('button[aria-label="发送消息"]')?.click()`)
      await waitFor(
        () => js<string>('document.body.innerText'),
        value => value.includes(draft) && value.includes('这是第 1 次普通回复。'),
        'First ordinary response was not rendered',
      )
      await waitFor(
        () => js<boolean>(`Boolean(document.querySelector('button[aria-label="发送消息"]'))`),
        value => value,
        'Native composer did not settle after the first reply',
      )
      await send('继续追问同一件事', '这是第 2 次普通回复。')

      step = 'stop-generation'; writeReport('fail')
      const stopPrompt = '请开始一段可以停止的回复'
      assert.equal(await js<string>(`(async () => {
        const input = document.querySelector('[data-composer-input]')
        if (!(input instanceof HTMLElement)) return ''
        input.focus()
        input.dispatchEvent(new InputEvent('beforeinput', {
          inputType: 'insertText', data: ${JSON.stringify(stopPrompt)}, bubbles: true, cancelable: true,
        }))
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        return input.textContent ?? ''
      })()`), stopPrompt)
      await js(`document.querySelector('button[aria-label="发送消息"]')?.click()`)
      await waitFor(
        () => js<boolean>(`Boolean(document.querySelector('button[aria-label="停止生成"]'))`),
        value => value,
        'Running ordinary reply did not expose the native Stop action',
      )
      await js(`document.querySelector('button[aria-label="停止生成"]')?.click()`)
      await waitFor(
        async () => fs.existsSync(path.join(home, CHAT_TEST_ABORT_FILE))
          && fs.readFileSync(path.join(home, CHAT_TEST_ABORT_FILE), 'utf8').includes(CHAT_TEST_SESSION_ID),
        value => value,
        'Stop did not abort the active model request',
        3_000,
      )
      await waitFor(
        () => js<boolean>(`Boolean(document.querySelector('button[aria-label="发送消息"]'))
          && !document.body.innerText.includes('这是第 3 次普通回复。')`),
        value => value,
        'Stopped reply did not return the composer to idle',
      )
      assert.equal(await js<boolean>(`Boolean(document.querySelector('[data-work-legacy-surface]'))`), false)
      assert.doesNotMatch(await js<string>('document.body.innerText'), /Markdown 成果|确认完成|导出成果/u)
      assert.deepEqual(fs.readdirSync(path.join(home, 't03-chat-workspace')), [])
    }

    step = 'capture'; writeReport('fail')
    fs.writeFileSync(path.join(output, `${phase}.png`), (await window.webContents.capturePage()).toPNG())
    await host.stop()
    host = null
    if (phase === 'connected') {
      step = 'same-session-record'; writeReport('fail')
      const sessionRoot = path.join(home, 'sessions')
      const files = fs.readdirSync(sessionRoot, { recursive: true, encoding: 'utf8' })
        .filter(file => file.endsWith('.jsonl'))
      const matching = files.filter(file => file.includes(CHAT_TEST_SESSION_ID)
        || fs.readFileSync(path.join(sessionRoot, file), 'utf8').includes(CHAT_TEST_SESSION_ID))
      assert.ok(matching.length > 0, 'No durable record was found for the native test Session')
      const record = matching.map(file => fs.readFileSync(path.join(sessionRoot, file), 'utf8')).join('\n')
      assert.ok(record.includes('请用一句话确认普通聊天已连接'))
      assert.ok(record.includes('继续追问同一件事'))
      assert.ok(record.includes('请开始一段可以停止的回复'))
      assert.ok(record.includes('这是第 1 次普通回复。'))
      assert.ok(record.includes('这是第 2 次普通回复。'))
      assert.ok(!record.includes('这是第 3 次普通回复。'))
      assert.match(record, /"kind":"aborted"/u)
    }
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
