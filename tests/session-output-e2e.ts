import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

import { createOfficialLauncher, prepareDevelopmentProfile } from '../packages/runtime-host/official-launcher.ts'
import { createRuntimeHost, type RuntimeHost } from '../packages/runtime-host/index.ts'
import { installOutputTestProfile, OUTPUT_TEST_BASELINE_FILE } from './support/output-test-profile.ts'

const requestedHome = process.env.DSH_WORK_E2E_HOME
if (!requestedHome) throw new Error('explicit Session output test home is required')
const home = requestedHome
const requestedNode = process.env.DSH_WORK_NODE
if (!requestedNode) throw new Error('explicit standalone Node is required; no global fallback')
const node = requestedNode
const output = path.resolve('artifacts/session-output')
const reportPath = path.join(output, 'result.json')
const versionRoot = path.join(home, 'session-output-versions', 'v1')
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

interface OutputVersionRecord {
  readonly fileId: string
  readonly versionId: string
  readonly ordinal: number
  readonly origin: 'generated' | 'migration-baseline'
  readonly sessionId: string
  readonly turn: number | null
  readonly throughSeq: number | null
  readonly path: string
  readonly contentDigest: string
  readonly sources: readonly {
    readonly path: string
    readonly status: string
  }[]
}

interface OutputAdoptionRecord {
  readonly fileId: string
  readonly versionId: string
  readonly sessionId: string
  readonly path: string
  readonly contentDigest: string
  readonly summary: string
}

function readOutputVersionRecords(): readonly OutputVersionRecord[] {
  const recordsRoot = path.join(versionRoot, 'records')
  if (!fs.existsSync(recordsRoot)) return []
  return fs.readdirSync(recordsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .flatMap(entry => {
      const directory = path.join(recordsRoot, entry.name)
      const names = fs.readdirSync(directory)
      return names
        .filter(name => /^\d{6}-[a-f0-9]{32}\.json$/u.test(name))
        .flatMap(name => {
          const bytes = fs.readFileSync(path.join(directory, name))
          const digest = createHash('sha256').update(bytes).digest('hex')
          const confirmed = names.some(candidate => {
            if (!candidate.startsWith(`${name}.`) || !candidate.endsWith('.commit')) return false
            try {
              const value = JSON.parse(fs.readFileSync(path.join(directory, candidate), 'utf8')) as {
                readonly recordName?: unknown
                readonly recordDigest?: unknown
              }
              return value.recordName === name && value.recordDigest === digest
            } catch {
              return false
            }
          })
          return confirmed ? [JSON.parse(bytes.toString('utf8')) as OutputVersionRecord] : []
        })
    })
}

function readOutputVersionBlob(record: OutputVersionRecord): Buffer {
  return fs.readFileSync(path.join(versionRoot, 'blobs', record.contentDigest))
}

function readOutputAdoptionRecords(): readonly OutputAdoptionRecord[] {
  const adoptionsRoot = path.join(versionRoot, 'adoptions')
  if (!fs.existsSync(adoptionsRoot)) return []
  return fs.readdirSync(adoptionsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .flatMap(entry => fs.readdirSync(path.join(adoptionsRoot, entry.name))
      .filter(name => /^[a-f0-9]{32}\.json$/u.test(name))
      .map(name => JSON.parse(fs.readFileSync(
        path.join(adoptionsRoot, entry.name, name), 'utf8',
      )) as OutputAdoptionRecord))
}

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
  timeoutMs = 12_000,
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
    installOutputTestProfile(home)
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
    const pressKey = async (key: 'Enter' | 'Tab' | 'Escape', modifiers: ('shift')[] = []): Promise<void> => {
      const debuggerApi = window!.webContents.debugger
      if (!debuggerApi.isAttached()) debuggerApi.attach('1.3')
      const code = key
      const virtualKey = key === 'Enter' ? 13 : key === 'Tab' ? 9 : 27
      const modifierMask = modifiers.includes('shift') ? 8 : 0
      await debuggerApi.sendCommand('Input.dispatchKeyEvent', {
        type: 'rawKeyDown', key, code, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey,
        modifiers: modifierMask,
      })
      if (key === 'Enter') {
        await debuggerApi.sendCommand('Input.dispatchKeyEvent', {
          type: 'char', key, code, text: '\r', unmodifiedText: '\r',
          windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey,
          modifiers: modifierMask,
        })
      }
      await debuggerApi.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey,
        modifiers: modifierMask,
      })
      await new Promise(resolve => setTimeout(resolve, 80))
    }
    await waitFor(
      () => js<boolean>("(() => { for (const label of ['继续', '稍后配置']) { const button = Array.from(document.querySelectorAll('button')).find(item => item.textContent?.trim() === label); if (button instanceof HTMLButtonElement) button.click() } return Boolean(document.querySelector('[data-composer-input]')) && document.body.innerText.includes('成果会话甲') && document.body.innerText.includes('成果会话乙') })()"),
      value => value,
      'Output fixture did not become ready',
    )
    const baseline = JSON.parse(fs.readFileSync(path.join(home, OUTPUT_TEST_BASELINE_FILE), 'utf8')) as {
      sessionA: string
      sessionB: string
      ordinaryPrompt: string
      generateAPrompt: string
      generateBPrompt: string
      revisionFailPrompt: string
      revisionSuccessPrompt: string
      restorePrompt: string
      workspacePath: string
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
      await clickSend()
    }
    const clickSend = async (): Promise<void> => {
      const clicked = await js<boolean>("(() => { const input = document.querySelector('[data-composer-input]'); const card = input?.closest('[data-composer-card]'); const buttons = card?.querySelectorAll('button'); const button = buttons?.item((buttons?.length ?? 0) - 1); if (!(button instanceof HTMLButtonElement)) return false; button.click(); return true })()")
      assert.equal(clicked, true)
    }
    const selectFile = (name: string, type: string, content: string): Promise<boolean> => js<boolean>(
      "(() => { const input = document.querySelector('[data-work-session-resource] input[type=file]'); if (!(input instanceof HTMLInputElement)) return false; const transfer = new DataTransfer(); transfer.items.add(new File([" + JSON.stringify(content) + "], " + JSON.stringify(name) + ", { type: " + JSON.stringify(type) + " })); Object.defineProperty(input, 'files', { configurable: true, value: transfer.files }); input.dispatchEvent(new Event('change', { bubbles: true })); return true })()",
    )

    step = 'ordinary-reply'; report('fail')
    await clickSession('成果会话甲')
    await send(baseline.ordinaryPrompt)
    await waitFor(
      () => js<string>('document.body.innerText'),
      text => text.includes('这是没有文件的普通回复。'),
      'Ordinary reply did not complete',
    )
    assert.equal(await js<number>("document.querySelectorAll('[data-work-session-outputs]').length"), 0)
    assert.equal(await js<number>("document.querySelectorAll('[data-produced-files-row]').length"), 0)

    step = 'other-session-output'; report('fail')
    await clickSession('成果会话乙')
    await send(baseline.generateBPrompt)
    await waitFor(
      () => js<string[]>("Array.from(document.querySelectorAll('[data-work-session-output]')).map(item => item.textContent?.trim() ?? '')"),
      values => values.length === 1 && values[0]?.includes('other-session.md') === true,
      'Session B real output did not appear',
    )
    assert.equal(fs.readFileSync(path.join(baseline.workspacePath, 'other-session.md'), 'utf8'), '# 乙报告\n')

    step = 'current-turn-files'; report('fail')
    await clickSession('成果会话甲')
    await waitFor(
      () => js<number>("document.querySelectorAll('[data-work-session-output]').length"),
      count => count === 0,
      'Session B output leaked into Session A',
    )
    await js("window.__dshWorkOutputSelections = []; window.addEventListener('dsh-work:select-session-output', event => { event.preventDefault(); window.__dshWorkOutputSelections.push(event.detail) })")
    const sourceName = 'source-brief.md'
    const sourceContent = '# Source brief\n\nOnly verified facts.\n'
    assert.equal(await setDraft(baseline.generateAPrompt), baseline.generateAPrompt)
    assert.equal(await selectFile(sourceName, 'text/markdown', sourceContent), true)
    const sourceDraft = await waitFor(
      () => js<{ body: string; draft: string }>("({ body: document.body.innerText, draft: document.querySelector('[data-composer-input]')?.textContent ?? '' })"),
      value => value.body.includes(sourceName) && value.body.includes('已复制，发送后读取')
        && value.draft.includes(sourceName) && value.draft.includes(baseline.generateAPrompt),
      'Session A source did not become ready',
    )
    const sourcePath = /@(?:"([^"\r\n]+)"|([^\s"'<>]+))/u.exec(sourceDraft.draft)?.slice(1).find(Boolean)
    assert.ok(sourcePath)
    await clickSend()
    const names = await waitFor(
      () => js<string[]>("Array.from(document.querySelectorAll('[data-work-session-output] strong')).map(item => item.textContent ?? '')"),
      values => values.length === 2,
      'Two validated Session A outputs did not appear',
    )
    assert.deepEqual(names, ['report-a.md', 'report-b.csv'])
    assert.equal(await js<boolean>("document.body.innerText.includes('empty.md')"), false)
    assert.equal(await js<number>("document.querySelectorAll('[data-work-session-outputs]').length"), 1)
    const sourcePhase = await waitFor(
      () => js<string>("document.querySelector('[data-work-session-outputs]')?.getAttribute('data-work-session-sources-phase') ?? ''"),
      value => value === 'ready' || value === 'error',
      'Source inspection did not settle',
    )
    assert.equal(sourcePhase, 'ready')
    await waitFor(
      () => js<string>("document.querySelector('[data-work-session-sources]')?.textContent ?? ''"),
      text => text === `已读取 1 份资料${sourceName}已读取`,
      'Verified source grouping did not appear beside generated results',
    )
    assert.equal(await js<number>("document.querySelectorAll('[data-produced-files-row]').length"), 0)
    assert.equal(fs.readFileSync(path.join(baseline.workspacePath, sourcePath), 'utf8'), sourceContent)
    const reportA = fs.readFileSync(path.join(baseline.workspacePath, 'report-a.md'), 'utf8')
    assert.match(reportA, /^# 甲报告/u)
    assert.equal(fs.readFileSync(path.join(baseline.workspacePath, 'report-b.csv'), 'utf8'), 'name,value\nalpha,1\n')
    assert.equal(fs.statSync(path.join(baseline.workspacePath, 'empty.md')).size, 0)
    const initialReportAVersions = await waitFor(
      async () => readOutputVersionRecords().filter(record =>
        record.sessionId === baseline.sessionA && record.path === 'report-a.md'),
      records => records.length === 1,
      'Initial report A did not publish one immutable version',
    )
    assert.equal(initialReportAVersions[0]?.origin, 'generated')
    assert.equal(initialReportAVersions[0]?.ordinal, 1)
    assert.ok(initialReportAVersions[0]?.turn !== null)
    assert.ok(initialReportAVersions[0]?.throughSeq !== null)
    assert.deepEqual(readOutputVersionBlob(initialReportAVersions[0]!), Buffer.from(reportA, 'utf8'))
    assert.ok(initialReportAVersions[0]?.sources.some(source =>
      source.path === sourcePath && source.status === 'verified'))
    const initialReportBVersions = readOutputVersionRecords().filter(record =>
      record.sessionId === baseline.sessionA && record.path === 'report-b.csv')
    assert.equal(initialReportBVersions.length, 1)
    assert.deepEqual(
      readOutputVersionBlob(initialReportBVersions[0]!),
      Buffer.from('name,value\nalpha,1\n', 'utf8'),
    )

    const selectAt = async (index: number): Promise<string> => {
      const source = "(() => { const buttons = document.querySelectorAll('[data-work-session-output]'); const button = buttons.item(" + String(index) + "); if (!(button instanceof HTMLButtonElement)) return ''; button.click(); return button.getAttribute('data-work-session-output') ?? '' })()"
      return js<string>(source)
    }
    const reportAPath = path.join(baseline.workspacePath, 'report-a.md')
    const heldReportAPath = path.join(baseline.workspacePath, '.report-a-held.md')
    fs.renameSync(reportAPath, heldReportAPath)
    assert.equal(await selectAt(0), 'report-a.md')
    await waitFor(
      () => js<number>("window.__dshWorkOutputSelections?.length ?? 0"),
      count => count === 1,
      'First output selection was not published',
    )
    assert.equal(await js<string>("document.querySelector('[data-work-session-output][aria-pressed=true]')?.getAttribute('data-work-session-output') ?? ''"), 'report-a.md')
    await waitFor(
      () => js<string>("document.querySelector('[data-work-output-preview]')?.textContent ?? ''"),
      text => text.includes('暂时无法读取文件') && text.includes('重试'),
      'Missing Markdown output did not expose a retryable read failure',
    )
    fs.renameSync(heldReportAPath, reportAPath)
    assert.equal(await js<boolean>("(() => { const button = Array.from(document.querySelectorAll('[data-work-output-preview] button')).find(item => item.textContent?.trim() === '重试'); if (!(button instanceof HTMLButtonElement)) return false; button.click(); return true })()"), true)
    await waitFor(
      () => js<string>("document.querySelector('[data-work-output-preview-markdown]')?.textContent ?? ''"),
      text => text.includes('本周结论已经整理完成。') && text.includes('产品：整理试用反馈。'),
      'Markdown output did not render in the details panel',
    )
    await waitFor(
      () => js<boolean>("document.querySelector('[data-details-collapsed]') === null"),
      value => value,
      'Details layout did not open for the Markdown preview',
    )
    await waitFor(
      () => js<number>("document.querySelector('[data-slot=details]')?.parentElement?.getBoundingClientRect().width ?? 0"),
      width => width >= 300,
      'Details layout did not finish expanding',
    )
    assert.equal(await js<number>("document.querySelectorAll('[data-work-output-preview-markdown] script, [data-work-output-preview-markdown] img, [data-work-output-preview-markdown] iframe, [data-work-output-preview-markdown] a').length"), 0)
    assert.equal(await js<boolean>('globalThis.__dshWorkPreviewExecuted === true'), false)
    fs.writeFileSync(path.join(output, 'preview.png'), (await window.webContents.capturePage()).toPNG())

    step = 'source-review-and-reference'; report('fail')
    assert.equal(await js<boolean>("(() => { const button = Array.from(document.querySelectorAll('[data-work-output-preview] [role=tab]')).find(item => item.textContent?.trim().startsWith('来源')); if (!(button instanceof HTMLButtonElement)) return false; button.click(); return true })()"), true)
    const sourcePanel = await waitFor(
      () => js<string>("document.querySelector('[data-work-output-preview-source]')?.textContent ?? ''"),
      text => text.includes(sourceName) && text.includes('工作区副本') && text.includes('已读取') && text.includes('在输入框引用'),
      'Preview source tab did not show the verified Workspace snapshot',
    )
    assert.match(sourcePanel, /已读取/u)
    assert.equal(await js<string>("document.querySelector('[data-work-output-preview-source]')?.getAttribute('data-work-output-preview-source') ?? ''"), sourcePath)
    await js("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
    fs.writeFileSync(path.join(output, 'sources.png'), (await window.webContents.capturePage()).toPNG())
    assert.equal(await js<boolean>("(() => { const button = Array.from(document.querySelectorAll('[data-work-output-preview-source] button')).find(item => item.textContent?.trim() === '在输入框引用'); if (!(button instanceof HTMLButtonElement)) return false; button.click(); return true })()"), true)
    await waitFor(
      () => js<string>("document.querySelector('[data-composer-input]')?.textContent ?? ''"),
      text => text.includes(sourcePath),
      'Verified source reference was not restored to the native composer',
    )
    await clickSend()
    await waitFor(
      () => js<string>("document.querySelector('[data-composer-input]')?.textContent ?? ''"),
      text => text === '',
      'Referenced source draft was not consumed by native Send',
    )

    step = 'native-tool-surface-handoff'; report('fail')
    await js("(() => { const process = document.querySelector('[data-turn-process]'); if (process instanceof HTMLButtonElement && process.getAttribute('aria-expanded') !== 'true') process.click() })()")
    await waitFor(
      () => js<number>("document.querySelectorAll('[data-chat-call-id]').length"),
      count => count > 0,
      'Native Tool rows did not expand',
    )
    assert.equal(await js<boolean>("(() => { const row = document.querySelector('[data-chat-call-id] [data-disclosure-row]'); if (!(row instanceof HTMLElement)) return false; row.click(); return true })()"), true)
    await waitFor(
      () => js<number>("document.querySelector('[data-chat-call-id]')?.querySelectorAll('button').length ?? 0"),
      count => count >= 2,
      'Native Tool inspect action did not become available',
    )
    assert.equal(await js<boolean>("(() => { const call = document.querySelector('[data-chat-call-id]'); const buttons = call?.querySelectorAll('button'); const inspect = buttons?.item((buttons?.length ?? 0) - 1); if (!(inspect instanceof HTMLButtonElement)) return false; inspect.click(); return true })()"), true)
    await waitFor(
      () => js<boolean>("document.querySelector('[data-work-output-preview]') === null && document.querySelector('[role=tab][aria-selected=true]')?.textContent?.trim() === '轨迹'"),
      value => value,
      'Native Tool inspection did not take over from the Work preview',
    )
    assert.equal(await js<boolean>("(() => { const tab = Array.from(document.querySelectorAll('[role=tab]')).find(item => item.textContent?.trim() === '对话'); if (!(tab instanceof HTMLButtonElement)) return false; tab.click(); return true })()"), true)
    await waitFor(
      () => js<number>("document.querySelectorAll('[data-work-session-output]').length"),
      count => count === 2,
      'Conversation outputs did not return after native Tool inspection',
    )
    assert.equal(await selectAt(0), 'report-a.md')
    await waitFor(
      () => js<number>("document.querySelectorAll('[data-work-output-preview-markdown]').length"),
      count => count === 1,
      'Markdown preview did not reopen after native Tool details',
    )

    assert.equal(await selectAt(1), 'report-b.csv')
    await waitFor(
      () => js<number>("window.__dshWorkOutputSelections?.length ?? 0"),
      count => count === 3,
      'Second output selection was not published',
    )
    assert.equal(await js<string>("document.querySelector('[data-work-session-output][aria-pressed=true]')?.getAttribute('data-work-session-output') ?? ''"), 'report-b.csv')
    await waitFor(
      () => js<string>("document.querySelector('[data-work-output-preview]')?.textContent ?? ''"),
      text => text.includes('此格式暂不支持应用内预览') && text.includes('使用系统应用打开'),
      'Unsupported output did not expose a real system-open action',
    )
    assert.equal(await js<boolean>("(() => { const button = Array.from(document.querySelectorAll('[data-work-output-preview] [role=tab]')).find(item => item.textContent?.trim().startsWith('来源')); if (!(button instanceof HTMLButtonElement)) return false; button.click(); return true })()"), true)
    await waitFor(
      () => js<string>("document.querySelector('[data-work-output-preview-source]')?.textContent ?? ''"),
      text => text.includes(sourceName) && text.includes('已读取'),
      'Non-Markdown output did not expose its verified source',
    )
    assert.equal(await js<boolean>("(() => { const button = Array.from(document.querySelectorAll('[data-work-output-preview] [role=tab]')).find(item => item.textContent?.trim() === '内容'); if (!(button instanceof HTMLButtonElement)) return false; button.click(); return true })()"), true)
    await waitFor(
      () => js<string>("document.querySelector('[data-work-output-preview]')?.textContent ?? ''"),
      text => text.includes('此格式暂不支持应用内预览'),
      'Non-Markdown output did not return to its content fallback',
    )
    const selected = await js<Array<{ path: string }>>("window.__dshWorkOutputSelections")
    assert.deepEqual(selected.map(item => item.path), ['report-a.md', 'report-a.md', 'report-b.csv'])
    fs.writeFileSync(path.join(output, 'files.png'), (await window.webContents.capturePage()).toPNG())

    step = 'retain-original-turn'; report('fail')
    await send(baseline.ordinaryPrompt)
    await waitFor(
      () => js<number>("document.body.innerText.split('这是没有文件的普通回复。').length - 1"),
      count => count >= 2,
      'Second ordinary reply did not complete',
    )
    assert.equal(await js<number>("document.querySelectorAll('[data-work-session-outputs]').length"), 1)
    assert.deepEqual(await js<string[]>("Array.from(document.querySelectorAll('[data-work-session-output] strong')).map(item => item.textContent ?? '')"), ['report-a.md', 'report-b.csv'])

    step = 'close-preview-retain-draft'; report('fail')
    assert.equal(await selectAt(0), 'report-a.md')
    await waitFor(
      () => js<number>("document.querySelectorAll('[data-work-output-preview-markdown]').length"),
      count => count === 1,
      'Markdown preview did not reopen',
    )
    assert.equal(await setDraft('保留的修改草稿'), '保留的修改草稿')
    assert.equal(await js<boolean>("(() => { const button = document.querySelector('[aria-label=\"返回会话并关闭文件预览\"]'); if (!(button instanceof HTMLButtonElement)) return false; button.click(); return true })()"), true)
    await waitFor(
      () => js<boolean>("document.querySelector('[data-details-collapsed]') !== null"),
      value => value,
      'Preview did not close',
    )
    assert.equal(await js<string>("document.querySelector('[data-composer-input]')?.textContent ?? ''"), '保留的修改草稿')
    await waitFor(
      () => js<string>("document.activeElement?.getAttribute('data-work-session-output') ?? ''"),
      value => value === 'report-a.md',
      'Closing preview did not restore focus to the selected file',
    )

    await clickSend()
    await waitFor(
      () => js<string>("document.querySelector('[data-composer-input]')?.textContent ?? ''"),
      text => text === '',
      'Existing draft did not clear before revision acceptance',
    )
    assert.equal(await selectAt(0), 'report-a.md')
    await waitFor(
      () => js<number>("document.querySelectorAll('[data-work-output-preview-markdown]').length"),
      count => count === 1,
      'Markdown preview did not reopen for revision',
    )

    step = 'save-current-output'; report('fail')
    const selectedBytes = fs.readFileSync(reportAPath)
    assert.equal(await js<boolean>("(() => { const button = Array.from(document.querySelectorAll('[data-work-output-preview] button')).find(item => item.textContent?.trim() === '保存副本'); if (!(button instanceof HTMLButtonElement)) return false; button.click(); return true })()"), true)
    await waitFor(
      () => js<string>("document.querySelector('.dsh-work-output-preview-actions')?.textContent ?? ''"),
      text => text.includes('已保存到') && text.includes('打开位置'),
      'Managed save did not report its real location after the copy completed',
    )
    const savesRoot = path.join(home, 'deliveries', 'session-outputs')
    const savedDirectory = await waitFor(
      async () => fs.existsSync(savesRoot)
        ? fs.readdirSync(savesRoot).map(name => path.join(savesRoot, name)).find(candidate =>
          fs.existsSync(path.join(candidate, 'report-a.md'))) ?? ''
        : '',
      value => value.length > 0,
      'Managed Session output copy was not created',
    )
    assert.deepEqual(fs.readFileSync(path.join(savedDirectory, 'report-a.md')), selectedBytes)
    fs.writeFileSync(path.join(output, 'saved.png'), (await window.webContents.capturePage()).toPNG())
    fs.unlinkSync(path.join(savedDirectory, 'report-a.md'))
    assert.equal(await js<boolean>("(() => { const button = Array.from(document.querySelectorAll('[data-work-output-preview] button')).find(item => item.textContent?.trim() === '打开位置'); if (!(button instanceof HTMLButtonElement)) return false; button.click(); return true })()"), true)
    await waitFor(
      () => js<string>("document.querySelector('.dsh-work-output-preview-actions')?.textContent ?? ''"),
      text => text.includes('副本已保存到')
        && text.includes('暂时无法打开位置')
        && !text.includes('未生成文件副本'),
      'Opening failure incorrectly denied the already completed save',
    )

    step = 'same-session-revision-recovery'; report('fail')
    assert.equal(await js<boolean>("(() => { const button = Array.from(document.querySelectorAll('[data-work-output-preview] button')).find(item => item.textContent?.trim() === '要求修改'); if (!(button instanceof HTMLButtonElement)) return false; button.click(); return true })()"), true)
    const revisionDraft = await waitFor(
      () => js<{ draft: string; focused: boolean }>("({ draft: document.querySelector('[data-composer-input]')?.textContent ?? '', focused: document.activeElement === document.querySelector('[data-composer-input]') })"),
      value => value.draft.includes('@report-a.md') && value.focused,
      'Revision did not return the file reference and focus to the native composer',
    )
    assert.match(revisionDraft.draft, /@report-a\.md/u)
    const appendDraft = async (text: string): Promise<string> => js<string>(
      "(async () => { const input = document.querySelector('[data-composer-input]'); if (!(input instanceof HTMLElement)) return ''; input.focus(); const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents(input); range.collapse(false); selection?.removeAllRanges(); selection?.addRange(range); input.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: " + JSON.stringify(text) + ", bubbles: true, cancelable: true })); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); return input.textContent ?? '' })()",
    )
    assert.match(await appendDraft(baseline.revisionFailPrompt), new RegExp(baseline.revisionFailPrompt, 'u'))
    await clickSend()
    await waitFor(
      () => js<string>("document.querySelector('[data-work-session-revision-failure]')?.textContent ?? ''"),
      text => text.includes('修改失败') && text.includes('已保留上一结果') && text.includes('在原会话重试'),
      'Invalid revision did not expose a retryable failure in the original Session',
    )
    assert.equal(fs.statSync(reportAPath).size, 0)
    assert.equal(readOutputVersionRecords().filter(record =>
      record.sessionId === baseline.sessionA && record.path === 'report-a.md').length, 1)
    assert.equal(await selectAt(0), 'report-a.md')
    await waitFor(
      () => js<string>("document.querySelector('[data-work-output-preview-markdown]')?.textContent ?? ''"),
      text => text.includes('本周结论已经整理完成。'),
      'Protected prior output was not readable after the failed revision',
    )
    assert.equal(await js<number>("document.querySelectorAll('[data-work-session-revision-failure]').length"), 1)
    fs.writeFileSync(path.join(output, 'revision-failure.png'), (await window.webContents.capturePage()).toPNG())

    assert.equal(await js<boolean>("(() => { const button = document.querySelector('[data-work-session-revision-failure] button'); if (!(button instanceof HTMLButtonElement)) return false; button.click(); return true })()"), true)
    await waitFor(
      () => js<string>("document.querySelector('[data-composer-input]')?.textContent ?? ''"),
      text => text.includes('@report-a.md'),
      'Revision retry did not return to the original composer',
    )
    assert.match(await appendDraft(baseline.revisionSuccessPrompt), new RegExp(baseline.revisionSuccessPrompt, 'u'))
    await clickSend()
    await waitFor(
      async () => ({
        revisedCount: await js<number>("Array.from(document.querySelectorAll('[data-work-session-output]')).filter(item => item.getAttribute('data-work-session-output') === 'report-a.md').length"),
        revised: fs.existsSync(reportAPath) ? fs.readFileSync(reportAPath, 'utf8') : '',
      }),
      value => value.revisedCount === 2 && value.revised.includes('甲报告（已修改）'),
      'Valid retry did not publish the revised file once',
    )
    assert.equal(await js<number>("Array.from(document.querySelectorAll('[data-work-session-output]')).filter(item => item.getAttribute('data-work-session-output') === 'report-a.md').length"), 2)
    const revisedReportAVersions = await waitFor(
      async () => readOutputVersionRecords().filter(record =>
        record.sessionId === baseline.sessionA && record.path === 'report-a.md')
        .sort((left, right) => left.ordinal - right.ordinal),
      records => records.length === 2,
      'Successful revision did not publish a second immutable version',
    )
    assert.deepEqual(revisedReportAVersions.map(record => record.ordinal), [1, 2])
    assert.notEqual(revisedReportAVersions[0]?.contentDigest, revisedReportAVersions[1]?.contentDigest)
    assert.deepEqual(readOutputVersionBlob(revisedReportAVersions[0]!), Buffer.from(reportA, 'utf8'))
    assert.equal(readOutputVersionBlob(revisedReportAVersions[1]!).toString('utf8'), '# 甲报告（已修改）\n\n修改成功。\n')

    step = 'historical-version-revision'; report('fail')
    assert.equal(await js<boolean>("(() => { const button = Array.from(document.querySelectorAll('[data-work-output-preview] [role=tab]')).find(item => item.textContent?.trim().startsWith('版本')); if (!(button instanceof HTMLButtonElement)) return false; button.click(); return true })()"), true)
    await waitFor(
      () => js<string[]>("Array.from(document.querySelectorAll('[data-work-output-version]')).map(item => item.getAttribute('data-work-output-version') ?? '')"),
      values => values.length === 2 && values.includes('v1') && values.includes('v2'),
      'Version tab did not show both immutable report versions',
    )
    const selectComparison = async (from: string, to: string): Promise<void> => {
      assert.equal(await js<boolean>(`(() => {
        const fromSelect = document.querySelector('[aria-label="比较起点版本"]')
        const toSelect = document.querySelector('[aria-label="比较终点版本"]')
        if (!(fromSelect instanceof HTMLSelectElement) || !(toSelect instanceof HTMLSelectElement)) return false
        const optionValue = (select, label) => Array.from(select.options).find(option => option.textContent?.trim() === label)?.value
        const fromValue = optionValue(fromSelect, ${JSON.stringify(from)})
        const toValue = optionValue(toSelect, ${JSON.stringify(to)})
        if (!fromValue || !toValue) return false
        fromSelect.value = fromValue
        fromSelect.dispatchEvent(new Event('change', { bubbles: true }))
        toSelect.value = toValue
        toSelect.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`), true)
    }
    const initialDiff = await waitFor(
      () => js<{ from: string; to: string; removed: string; added: string }>(`(() => ({
        from: document.querySelector('[aria-label="比较起点版本"] option:checked')?.textContent?.trim() ?? '',
        to: document.querySelector('[aria-label="比较终点版本"] option:checked')?.textContent?.trim() ?? '',
        removed: Array.from(document.querySelectorAll('[data-work-output-diff="removed"]')).map(item => item.textContent ?? '').join('\\n'),
        added: Array.from(document.querySelectorAll('[data-work-output-diff="added"]')).map(item => item.textContent ?? '').join('\\n'),
      }))()`),
      value => value.removed.length > 0 && value.added.length > 0,
      'Default v1 to v2 comparison did not match the stored snapshots',
    )
    assert.equal(initialDiff.from, 'v1')
    assert.equal(initialDiff.to, 'v2')
    assert.match(initialDiff.removed, /本周结论已经整理完成。/u)
    assert.match(initialDiff.added, /修改成功。/u)
    assert.match(initialDiff.removed, /− v1 删除/u)
    assert.match(initialDiff.added, /\+ v2 新增/u)
    await selectComparison('v1', 'v1')
    await waitFor(
      () => js<string>("document.querySelector('[data-work-output-diff=\"unchanged\"]')?.textContent ?? ''"),
      text => text.includes('内容相同') && text.includes('没有变化'),
      'Comparing the same immutable version did not report no changes',
    )
    await selectComparison('v2', 'v1')
    await waitFor(
      () => js<{ removed: string; added: string }>(`({
        removed: Array.from(document.querySelectorAll('[data-work-output-diff="removed"]')).map(item => item.textContent ?? '').join('\\n'),
        added: Array.from(document.querySelectorAll('[data-work-output-diff="added"]')).map(item => item.textContent ?? '').join('\\n'),
      })`),
      value => value.removed.includes('修改成功。') && value.added.includes('本周结论已经整理完成。'),
      'Reversing comparison direction did not reverse removed and added content',
    )
    await selectComparison('v1', 'v2')
    assert.match(await js<string>("document.querySelector('[data-work-output-version=\"v2\"]')?.textContent ?? ''"), /当前/u)
    assert.equal(await js<boolean>("(() => { const button = document.querySelector('[data-work-output-version=\"v1\"]'); if (!(button instanceof HTMLButtonElement)) return false; button.click(); return true })()"), true)
    const historicalPanel = await waitFor(
      () => js<{ summary: string; body: string }>(`(() => {
        const detail = document.querySelector('[data-work-output-version-detail="v1"]')
        return {
          summary: detail?.querySelector('.dsh-work-output-preview-version-summary')?.textContent ?? '',
          body: detail?.querySelector('[data-work-output-preview-markdown]')?.textContent ?? '',
        }
      })()`),
      value => value.summary.includes('内容摘要') && value.summary.includes('甲报告')
        && value.body.includes('本周结论已经整理完成。') && !value.body.includes('修改成功'),
      'Selecting v1 did not render its exact historical content and derived summary',
    )
    assert.match(historicalPanel.summary, /SHA-256 [a-f0-9]{12}/u)
    assert.equal(fs.readFileSync(reportAPath, 'utf8'), '# 甲报告（已修改）\n\n修改成功。\n')
    assert.equal(readOutputVersionRecords().filter(record =>
      record.sessionId === baseline.sessionA && record.path === 'report-a.md').length, 2)

    step = 'save-historical-version'; report('fail')
    const savedBeforeHistorical = fs.readdirSync(savesRoot).length
    assert.equal(await js<boolean>("(() => { const button = Array.from(document.querySelectorAll('[data-work-output-preview] button')).find(item => item.textContent?.trim() === '保存 v1 副本'); if (!(button instanceof HTMLButtonElement) || button.disabled) return false; button.click(); return true })()"), true)
    await waitFor(
      () => js<string>("document.querySelector('.dsh-work-output-preview-actions > span')?.textContent ?? ''"),
      text => text.includes('已保存 v1 到'),
      'Saving selected v1 did not report the bound historical version',
    )
    const historicalSave = await waitFor(
      async () => fs.readdirSync(savesRoot)
        .map(name => path.join(savesRoot, name))
        .find(candidate => fs.existsSync(path.join(candidate, 'report-a.md'))
          && fs.readFileSync(path.join(candidate, 'report-a.md'), 'utf8') === reportA),
      candidate => Boolean(candidate) && fs.readdirSync(savesRoot).length > savedBeforeHistorical,
      'Historical v1 bytes were not copied to a distinct managed save record',
    )
    assert.ok(historicalSave)
    assert.equal(fs.readFileSync(reportAPath, 'utf8'), '# 甲报告（已修改）\n\n修改成功。\n')

    step = 'adopt-historical-version'; report('fail')
    assert.equal(await js<boolean>("(() => { const button = document.querySelector('[data-work-output-adopt=\"v1\"]'); if (!(button instanceof HTMLButtonElement) || button.disabled) return false; button.click(); return true })()"), true)
    await waitFor(
      () => js<string>("document.querySelector('[data-work-output-version=\"v1\"]')?.textContent ?? ''"),
      text => text.includes('已采用'),
      'Adopting v1 did not mark that exact historical version',
    )
    assert.doesNotMatch(await js<string>("document.querySelector('[data-work-output-version=\"v2\"]')?.textContent ?? ''"), /已采用/u)
    const [adoption] = readOutputAdoptionRecords()
    assert.ok(adoption)
    assert.equal(adoption.fileId, revisedReportAVersions[0]?.fileId)
    assert.equal(adoption.versionId, revisedReportAVersions[0]?.versionId)
    assert.equal(adoption.contentDigest, revisedReportAVersions[0]?.contentDigest)
    assert.match(adoption.summary, /甲报告/u)
    assert.equal(fs.readFileSync(reportAPath, 'utf8'), '# 甲报告（已修改）\n\n修改成功。\n')

    step = 'restore-historical-version'; report('fail')
    assert.equal(await js<boolean>("(() => { const button = Array.from(document.querySelectorAll('[data-work-output-preview] button')).find(item => item.textContent?.trim() === '恢复 v1'); if (!(button instanceof HTMLButtonElement) || button.disabled) return false; button.click(); return true })()"), true)
    await js("new Promise(resolve => setTimeout(resolve, 500))")
    const restorePreparation = await js<{ draft: string; status: string }>(`({
      draft: document.querySelector('[data-composer-input]')?.textContent ?? '',
      status: document.querySelector('.dsh-work-output-preview-actions > span')?.textContent ?? '',
    })`)
    const restoreDraft = restorePreparation.draft
    assert.match(restoreDraft, /使用 @attachment-/u, restorePreparation.status)
    assert.ok(restoreDraft.includes('（v1）的完整内容恢复 @report-a.md')
      && restoreDraft.includes(baseline.restorePrompt))
    const restoreReference = /使用 @([^\s]+) （v1）的完整内容恢复 @report-a\.md/u.exec(restoreDraft)?.[1]
    assert.ok(restoreReference)
    assert.equal(fs.readFileSync(path.join(baseline.workspacePath, restoreReference), 'utf8'), reportA)
    assert.equal(await js<boolean>("(() => { const button = Array.from(document.querySelectorAll('[data-work-output-preview] button')).find(item => item.textContent?.trim() === '恢复 v1'); if (!(button instanceof HTMLButtonElement) || button.disabled) return false; button.click(); return true })()"), true)
    assert.equal(await waitFor(
      () => js<string>("document.querySelector('[data-composer-input]')?.textContent ?? ''"),
      text => text === restoreDraft,
      'Retrying restore preparation duplicated the bound request',
    ), restoreDraft)
    await waitFor(
      () => js<boolean>("Array.from(document.querySelectorAll('[data-work-output-preview] button')).some(item => item instanceof HTMLButtonElement && item.textContent?.trim() === '恢复 v1' && !item.disabled)"),
      value => value,
      'The retried restore preparation did not finish',
    )
    await clickSend()
    await waitFor(
      () => js<string>("document.querySelector('[data-composer-input]')?.textContent ?? ''"),
      text => text === '',
      'The completed restore request did not clear the native composer',
    )
    const restoredRecords = await waitFor(
      async () => readOutputVersionRecords().filter(record =>
        record.sessionId === baseline.sessionA && record.path === 'report-a.md'),
      records => records.length === 3,
      'A completed v1 restore did not publish one new immutable version',
    )
    assert.deepEqual(restoredRecords.map(record => record.ordinal), [1, 2, 3])
    assert.deepEqual(readOutputVersionBlob(restoredRecords[2]!), readOutputVersionBlob(restoredRecords[0]!))
    assert.equal(readOutputVersionBlob(restoredRecords[1]!).toString('utf8'), '# 甲报告（已修改）\n\n修改成功。\n')
    assert.equal(fs.readFileSync(reportAPath, 'utf8'), reportA)

    await js("document.querySelector('[aria-label=\"返回会话并关闭文件预览\"]')?.click()")
    await waitFor(
      () => js<boolean>("document.querySelector('[data-work-output-preview]') === null"),
      value => value,
      'Preview did not close after restore',
    )
    assert.equal(await waitFor(
      () => js<boolean>("(() => { const rows = Array.from(document.querySelectorAll('[data-work-session-output=\"report-a.md\"]')); const row = rows.at(-1); if (!(row instanceof HTMLButtonElement)) return false; row.click(); return true })()"),
      value => value,
      'Restored output did not appear in the conversation',
    ), true)
    assert.equal(await js<boolean>("(() => { const button = Array.from(document.querySelectorAll('[role=\"tab\"]')).find(item => item.textContent?.startsWith('版本')); if (!(button instanceof HTMLButtonElement)) return false; button.click(); return true })()"), true)
    await waitFor(
      () => js<string>("document.querySelector('[data-work-output-version=\"v3\"]')?.textContent ?? ''"),
      text => text.includes('当前'),
      'The restored v3 did not become current after completion',
    )
    assert.match(await js<string>("document.querySelector('[data-work-output-version=\"v1\"]')?.textContent ?? ''"), /已采用/u)
    assert.doesNotMatch(await js<string>("document.querySelector('[data-work-output-version=\"v3\"]')?.textContent ?? ''"), /已采用/u)
    assert.equal(await js<boolean>("(() => { const button = document.querySelector('[data-work-output-version=\"v2\"]'); if (!(button instanceof HTMLButtonElement)) return false; button.click(); return true })()"), true)
    await waitFor(
      () => js<boolean>("Boolean(document.querySelector('[data-work-output-version-detail=\"v2\"] [data-work-output-preview-markdown]'))"),
      value => value,
      'The preserved v2 was not readable after restoring v1',
    )
    fs.writeFileSync(reportAPath, '# External edit\n')
    assert.equal(await js<boolean>("(() => { const button = Array.from(document.querySelectorAll('[data-work-output-preview] button')).find(item => item.textContent?.trim() === '恢复 v2'); if (!(button instanceof HTMLButtonElement) || button.disabled) return false; button.click(); return true })()"), true)
    await waitFor(
      () => js<string>("document.querySelector('.dsh-work-output-preview-actions > span')?.textContent ?? ''"),
      text => text.includes('当前文件已在工作区发生变化') && text.includes('刷新版本'),
      'An external edit did not block restore with an explicit conflict',
    )
    assert.equal(readOutputVersionRecords().filter(record =>
      record.sessionId === baseline.sessionA && record.path === 'report-a.md').length, 3)
    fs.writeFileSync(reportAPath, reportA)
    assert.equal(await js<boolean>("(() => { const button = Array.from(document.querySelectorAll('[data-work-output-preview] button')).find(item => item.textContent?.trim() === '基于 v2 修改'); if (!(button instanceof HTMLButtonElement) || button.disabled) return false; button.click(); return true })()"), true)
    const historicalDraft = await waitFor(
      () => js<{ draft: string; focused: boolean }>("({ draft: document.querySelector('[data-composer-input]')?.textContent ?? '', focused: document.activeElement === document.querySelector('[data-composer-input]') })"),
      value => value.draft.includes('基于 @attachment-') && value.draft.includes('（v2）修改 @report-a.md')
        && value.focused,
      'The v2 revision action did not bind the immutable snapshot in the native composer',
    )
    const historicalReference = /基于 @([^\s]+)（v2）修改 @report-a\.md/u.exec(historicalDraft.draft)?.[1]
    assert.ok(historicalReference)
    assert.equal(fs.readFileSync(path.join(baseline.workspacePath, historicalReference), 'utf8'), '# 甲报告（已修改）\n\n修改成功。\n')
    assert.equal(fs.readFileSync(reportAPath, 'utf8'), reportA)
    await clickSend()
    await waitFor(
      () => js<string>("document.querySelector('[data-composer-input]')?.textContent ?? ''"),
      text => text === '',
      'The explicit v2 revision request was not consumed by native Send',
    )
    assert.equal(readOutputVersionRecords().filter(record =>
      record.sessionId === baseline.sessionA && record.path === 'report-a.md').length, 3)
    fs.writeFileSync(path.join(output, 'versions.png'), (await window.webContents.capturePage()).toPNG())

    step = 'responsive-keyboard-file-review'; report('fail')
    window.show()
    window.focus()
    if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach('1.3')
    if (await js<boolean>("Boolean(document.querySelector('[data-work-output-preview]'))")) {
      await js("document.querySelector('[aria-label=\"返回会话并关闭文件预览\"]')?.click()")
      await waitFor(
        () => js<boolean>("document.querySelector('[data-work-output-preview]') === null"),
        value => value,
        'Desktop preview did not close before responsive acceptance',
      )
    }
    const focusReport = (index: number): Promise<boolean> => js<boolean>(`(() => {
      const rows = Array.from(document.querySelectorAll('[data-work-session-output="report-a.md"]'))
      const row = rows.at(${String(index)})
      if (!(row instanceof HTMLButtonElement)) return false
      row.focus()
      return document.activeElement === row
    })()`)
    const previewSnapshot = (): Promise<{
      readonly width: number
      readonly left: number
      readonly right: number
      readonly viewport: number
      readonly overflow: boolean
      readonly closeFocused: boolean
      readonly namedButtons: boolean
      readonly liveSaveStatus: boolean
    }> => js(`(() => {
      const preview = document.querySelector('[data-work-output-preview]')
      const rect = preview?.getBoundingClientRect()
      const buttons = Array.from(preview?.querySelectorAll('button') ?? [])
      const saveStatus = preview?.querySelector('.dsh-work-output-preview-actions > span')
      return {
        width: rect?.width ?? 0,
        left: rect?.left ?? -1,
        right: rect?.right ?? -1,
        viewport: innerWidth,
        overflow: document.documentElement.scrollWidth > innerWidth
          || buttons.some(button => {
            const buttonRect = button.getBoundingClientRect()
            return buttonRect.left < 0 || buttonRect.right > innerWidth
          }),
        closeFocused: document.activeElement?.getAttribute('aria-label') === '返回会话并关闭文件预览',
        namedButtons: buttons.every(button => Boolean(
          button.getAttribute('aria-label') || button.textContent?.trim() || button.getAttribute('title'),
        )),
        liveSaveStatus: saveStatus?.getAttribute('role') === 'status'
          && saveStatus.getAttribute('aria-live') === 'polite',
      }
    })()`)
    const openByKeyboardAt = async (width: number, outputIndex = -1): Promise<void> => {
      window!.setContentSize(width, 900)
      await js("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
      assert.equal(await focusReport(outputIndex), true)
      await pressKey('Enter')
      await waitFor(
        () => js<boolean>("Boolean(document.querySelector('[data-work-output-preview]'))"),
        value => value,
        `Keyboard did not open the file preview at ${String(width)}px`,
      )
      await waitFor(
        previewSnapshot,
        value => value.viewport === width && Math.abs(value.width - width) <= 1
          && value.left === 0 && Math.abs(value.right - width) <= 1 && value.closeFocused,
        `File preview did not become a focused single panel at ${String(width)}px`,
      )
      await waitFor(
        () => js<boolean>("Array.from(document.querySelectorAll('[data-work-output-preview] button')).some(item => item instanceof HTMLButtonElement && item.textContent?.trim() === '要求修改' && !item.disabled)"),
        value => value,
        `File preview actions did not become ready at ${String(width)}px`,
      )
      const snapshot = await previewSnapshot()
      assert.equal(snapshot.overflow, false)
      assert.equal(snapshot.namedButtons, true)
      assert.equal(snapshot.liveSaveStatus, true)
    }

    await openByKeyboardAt(736)
    const tabOrder: string[] = []
    for (let index = 0; index < 6; index++) {
      await pressKey('Tab')
      tabOrder.push(await js<string>(
        "document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.trim() || ''",
      ))
    }
    assert.equal(tabOrder[0], '内容')
    assert.ok(tabOrder[1]?.startsWith('来源'))
    assert.ok(tabOrder[2]?.startsWith('版本'))
    assert.ok(tabOrder.includes('保存副本'))
    assert.ok(tabOrder.includes('要求修改'))
    assert.equal(tabOrder.at(-1), '返回会话并关闭文件预览')
    fs.writeFileSync(path.join(output, 'responsive-736.png'), (await window.webContents.capturePage()).toPNG())
    await pressKey('Escape')
    await waitFor(
      () => js<boolean>("document.querySelector('[data-work-output-preview]') === null && document.activeElement === document.querySelector('[data-composer-input]')"),
      value => value,
      '736px preview did not return keyboard focus to the composer',
    )
    await window.webContents.debugger.sendCommand('Input.insertText', { text: 'x' })
    await waitFor(
      () => js<string>("document.querySelector('[data-composer-input]')?.textContent ?? ''"),
      value => value === 'x',
      'Composer did not accept keyboard input after returning from preview',
    )

    await openByKeyboardAt(390)
    assert.equal(await js<string>("document.querySelector('.dsh-work-output-preview-close-label')?.textContent ?? ''"), '返回会话')
    fs.writeFileSync(path.join(output, 'responsive-390.png'), (await window.webContents.capturePage()).toPNG())
    for (let index = 0; index < 5; index++) await pressKey('Tab')
    assert.equal(await js<string>("document.activeElement?.textContent?.trim() ?? ''"), '要求修改')
    await pressKey('Enter')
    await waitFor(
      () => js<{ readonly previewClosed: boolean; readonly composerFocused: boolean; readonly draft: string }>(`({
        previewClosed: document.querySelector('[data-work-output-preview]') === null,
        composerFocused: document.activeElement === document.querySelector('[data-composer-input]'),
        draft: document.querySelector('[data-composer-input]')?.textContent ?? '',
      })`),
      value => value.previewClosed && value.composerFocused
        && value.draft.includes('x') && value.draft.includes('@report-a.md'),
      '390px revision did not return to the preserved composer draft',
    )

    await openByKeyboardAt(390, 0)
    await pressKey('Tab')
    await pressKey('Tab')
    assert.ok((await js<string>("document.activeElement?.textContent?.trim() ?? ''")).startsWith('来源'))
    await pressKey('Enter')
    await waitFor(
      () => js<boolean>("Boolean(document.querySelector('[data-work-output-preview-source] button:not(:disabled)'))"),
      value => value,
      '390px source tab did not expose a reference action',
    )
    await pressKey('Tab')
    await pressKey('Tab')
    assert.equal(await js<string>("document.activeElement?.textContent?.trim() ?? ''"), '在输入框引用')
    await pressKey('Enter')
    await waitFor(
      () => js<{ readonly previewClosed: boolean; readonly composerFocused: boolean; readonly draft: string }>(`({
        previewClosed: document.querySelector('[data-work-output-preview]') === null,
        composerFocused: document.activeElement === document.querySelector('[data-composer-input]'),
        draft: document.querySelector('[data-composer-input]')?.textContent ?? '',
      })`),
      value => value.previewClosed && value.composerFocused
        && value.draft.includes(sourcePath),
      '390px source reference did not return to the composer with the managed source',
    )

    await host.stop()
    host = null
    step = 'complete'; report('pass')
  } catch (error) {
    const detail = error instanceof Error ? error.stack ?? error.message : 'unknown failure'
    report('fail', detail)
    if (window && !window.isDestroyed()) {
      fs.writeFileSync(path.join(output, 'failure.png'), (await window.webContents.capturePage()).toPNG())
    }
    process.exitCode = 1
  } finally {
    await host?.stop().catch(() => {})
    window?.destroy()
    app.exit(typeof process.exitCode === 'number' ? process.exitCode : 0)
  }
}

void run()
