// Opt-in live-provider acceptance. Never imported by headless tests or normal CI.
import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createOfficialLauncher, prepareDevelopmentProfile } from '../packages/runtime-host/official-launcher.ts'
import { hasCompletedAssistantReply, readLiveSessionLog } from './support/live-release-evidence.ts'
import { createRuntimeHost, type RuntimeHost } from '../packages/runtime-host/index.ts'
const home = process.env.DSH_WORK_E2E_HOME!
const node = process.env.DSH_WORK_NODE!
if (!home || !node) throw new Error('Explicit isolated home and standalone Node required')
const output = path.resolve('artifacts/live-release')
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', path.join(home, 'electron'))
app.commandLine.appendSwitch('disable-background-networking')
app.on('window-all-closed', () => {})
let host: RuntimeHost | null = null
let window: BrowserWindow | null = null
let step = 'prepare'
const completed: string[] = []
let failureLocation: string | undefined
let providerFailureCode: string | undefined
let waitingAt: string | undefined
let outputPaths: string[] = []
const report = (status: string) => fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({
  status, step, runId: process.env.DSH_WORK_E2E_RUN_ID, completed, waitingAt, outputPaths, failureLocation, providerFailureCode, provider: 'deepseek-official', model: 'deepseek-v4-flash',
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  testSHA256: createHash('sha256').update(fs.readFileSync(import.meta.filename)).digest('hex'),
  platform: process.platform, arch: process.arch, fixtureModel: false,
  requestMarkers: fs.existsSync(path.join(home,'live-request-markers.jsonl')) ? fs.readFileSync(path.join(home,'live-request-markers.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)) : [],
}, null, 2))
const wait = async (read: () => Promise<boolean>, timeout = 90_000): Promise<void> => {
  waitingAt = new Error().stack?.split('\n')[2]?.match(/tests\/[^)]+/)?.[0]
  report('running')
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try { if (await read()) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Acceptance timeout')
}
const js = <T = unknown>(source: string): Promise<T> => window!.webContents.executeJavaScript(source) as Promise<T>
const credentialBytes = fs.readFileSync(path.join(home, '.credentials.yaml'))
const settings = (baseURL?: string): void => fs.writeFileSync(path.join(home, 'settings.yaml'), JSON.stringify({
  'ui-onboarding': { welcomeNoticeVersion: '2026-08-13.1' },
  'llm-deepseek': { ...(baseURL ? { baseURL } : {}), retryPolicy: { mode: 'normal', maxRetries: 0 } },
}))
const setDraft = async (text: string): Promise<void> => {
  assert.equal(await js(`(async () => { const input = document.querySelector('[data-composer-input]');
    input.focus(); input.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: ${JSON.stringify(text)}, bubbles: true, cancelable: true }));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); return input.textContent; })()`), text)
}
const send = async (text: string): Promise<void> => {
  await setDraft(text)
  await js(`document.querySelector('button[aria-label="发送消息"]')?.click()`)
}
const idle = async (): Promise<void> => wait(async () => await js<boolean>(`Boolean(document.querySelector('button[aria-label="发送消息"]'))`))
const boot = async (configure = false): Promise<void> => {
  let resolveUrl!: (value: string) => void
  const announced = new Promise<string>(resolve => { resolveUrl = resolve })
  const launch = createOfficialLauncher({ home, node, port: 0 })
  host = createRuntimeHost({ launch: () => {
    const child = launch(); let bytes = ''
    child.stdout.on('data', chunk => {
      bytes = (bytes + chunk.toString()).slice(-4096)
      const found = bytes.match(/dsh web: (http:\/\/[^\s]+)/)
      if (found?.[1]) resolveUrl(found[1])
    })
    return child
  } })
  assert.equal((await host.start()).state, 'ready')
  window = new BrowserWindow({ show: false, width: 1440, height: 900,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  await window.loadURL(await Promise.race([announced, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('No authenticated URL')), 10000))]))
  if (configure) {
    await wait(() => js<boolean>(`(() => {Array.from(document.querySelectorAll('button')).find(x=>x.textContent?.trim()==='继续')?.click();return Boolean(document.querySelector('input[type=password]'))})()`))
    const key = JSON.parse(credentialBytes.toString('utf8')).refs.DEEPSEEK_API_KEY
    await js(`(()=>{const input=document.querySelector('input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(key)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`)
    await wait(()=>js<boolean>(`Array.from(document.querySelectorAll('button')).some(x=>x.textContent?.trim()==='保存并继续' && !x.disabled)`))
    await js(`Array.from(document.querySelectorAll('button')).find(x=>x.textContent?.trim()==='保存并继续')?.click()`)
    await wait(()=>js<boolean>(`!document.querySelector('input[type=password]')`))
    assert.ok(fs.readFileSync(path.join(home,'.credentials.yaml'),'utf8').includes(key))
    completed.push('fresh-model-setup-ui')
  }
  await wait(() => js<boolean>(`(() => { for (const label of ['继续','稍后配置']) Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === label)?.click(); return Boolean(document.querySelector('[data-composer-input]')); })()`))
  const titleFile = path.join(home, 'live-session-title.txt')
  if (fs.existsSync(titleFile)) {
    const title = fs.readFileSync(titleFile, 'utf8')
    await wait(() => js<boolean>(`(() => {
      const root=Array.from(document.querySelectorAll('[role=treeitem]')).find(x=>x.textContent?.includes('Release validation'));
      if(root?.getAttribute('aria-expanded')==='false')root.click();
      const row=Array.from(document.querySelectorAll('[role=treeitem]')).find(x=>Array.from(x.querySelectorAll('span')).some(s=>s.textContent===${JSON.stringify(title)}));
      if(!row)return false;row.click();return true;
    })()`))
  }
}
const stop = async (): Promise<void> => { window?.destroy(); window = null; await host?.stop(); host = null }
async function run(): Promise<void> {
try {
  report('fail'); await app.whenReady()
  prepareDevelopmentProfile(home); settings()
  const profile = path.join(home, 'profiles/dsh-work')
  const manifestFile = path.join(profile, 'package.json')
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  manifest.dsh.profile.bundles.push('@dsh-work/live-release-setup')
  fs.writeFileSync(manifestFile, JSON.stringify(manifest))
  fs.cpSync('tests/fixtures/live-release-setup', path.join(profile, 'node_modules/@dsh-work/live-release-setup'), { recursive: true })
  const patchFile = path.join(profile, 'cordis.patch.yml')
  const patch = JSON.parse(fs.readFileSync(patchFile, 'utf8'))
  patch.find((row: { id: string }) => row.id === 'web-runtime').config.printUrl = true
  patch.push({ id: 'session-persistence-jsonl', config: { root: path.join(home, 'sessions') } })
  fs.writeFileSync(patchFile, JSON.stringify(patch))
  fs.writeFileSync(path.join(home,'.credentials.yaml'), JSON.stringify({version:1,refs:{}}), {mode:0o600})
  step = 'first-live-response'; report('fail'); await boot(true)
  await js(`Array.from(document.querySelectorAll('[role=treeitem]')).find(x=>x.textContent?.includes('Release validation'))?.click()`)
  await wait(() => js<boolean>(`document.querySelector('[data-composer-input]')?.getAttribute('aria-disabled') !== 'true' && Boolean(document.querySelector('button[aria-label="发送消息"]'))`))
  await new Promise(resolve => setTimeout(resolve, 500))
  step = 'first-live-response'; report('fail')
  await send('Reply with exactly RELEASE_FIRST_OK. Do not use tools.')
  await wait(() => js<boolean>(`Array.from(document.querySelectorAll('[data-chat-turn]')).some(x => x.textContent?.includes('RELEASE_FIRST_OK')) && document.querySelectorAll('[data-chat-turn]').length > 0`))
  await idle()
  // Durable response must include an assistant text block; user prompt alone is not success.
  const records = () => readLiveSessionLog(path.join(home,'sessions'))
  const events = () => records().trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  await wait(async () => events().some(row => row.type === 'turn/end'))
  const finish = events().find(row => row.type === 'turn/end')
  providerFailureCode = finish?.data?.reason?.error?.code
  assert.equal(finish?.data?.reason?.kind, 'completed')
  assert.ok(hasCompletedAssistantReply(events(), finish.data.turn, 'RELEASE_FIRST_OK'))
  completed.push(step)
  await wait(() => js<boolean>(`(()=>{const root=Array.from(document.querySelectorAll('[role=treeitem]')).find(x=>x.textContent?.includes('Release validation'));if(root?.getAttribute('aria-expanded')==='false')root.click();return Boolean(document.querySelector('[role=treeitem][aria-selected=true] [class*=title]'))})()`))
  const title = await js<string>(`document.querySelector('[role=treeitem][aria-selected=true] [class*=title]')?.textContent ?? ''`)
  assert.ok(title)
  fs.writeFileSync(path.join(home, 'live-session-title.txt'), title)
  step = 'attachment-generate'; report('fail')
  await setDraft('Read the attached file using tools, then write release-report.md in the workspace root. Include a Markdown heading and the exact text Orchid: 7. Do not ask questions.')
  await js(`(() => { const input = document.querySelector('[data-work-session-resource] input[type=file]'); const transfer = new DataTransfer();
    transfer.items.add(new File(['# Synthetic brief\\nProject Orchid has 7 items.\\n'], 'release-brief.md', {type:'text/markdown'}));
    Object.defineProperty(input,'files',{configurable:true,value:transfer.files});input.dispatchEvent(new Event('change',{bubbles:true})); })()`)
  await wait(() => js<boolean>(`document.querySelector('[data-composer-input]')?.textContent?.includes('release-brief.md') === true && document.querySelector('[data-composer-input]')?.textContent?.includes('Orchid: 7') === true`))
  await js(`document.querySelector('button[aria-label="发送消息"]')?.click()`)
  const reportFile = path.join(home, 'live-workspace/release-report.md')
  await wait(async () => fs.existsSync(reportFile) && fs.readFileSync(reportFile, 'utf8').includes('Orchid: 7'))
  await idle()
  await wait(() => js<boolean>(`Boolean(document.querySelector('[data-work-session-output$="release-report.md"]'))`))
  completed.push(step)
  step = 'revision-save'; report('fail')
  await send('Revise release-report.md using tools. Keep Orchid: 7 and append exactly RELEASE_REVISED_OK on its own line. Write the file, do not only describe the change.')
  await wait(async () => fs.readFileSync(reportFile, 'utf8').includes('RELEASE_REVISED_OK'))
  await idle()
  await js(`document.querySelector('[data-work-session-output$="release-report.md"]')?.click()`)
  await wait(() => js<boolean>(`document.querySelector('[data-work-output-preview-markdown]')?.textContent?.includes('RELEASE_REVISED_OK') === true`))
  await js(`Array.from(document.querySelectorAll('[data-work-output-preview] button')).find(b=>b.textContent?.trim()==='保存副本')?.click()`)
  await wait(() => js<boolean>(`document.querySelector('[data-work-output-preview]')?.textContent?.includes('已保存') === true`))
  const copies = path.join(home, 'deliveries/session-outputs')
  const savedFiles = fs.readdirSync(copies, {recursive:true,encoding:'utf8'}).filter(f=>f.endsWith('/release-report.md') || f==='release-report.md')
  assert.ok(savedFiles.some(f=>fs.readFileSync(path.join(copies,f)).equals(fs.readFileSync(reportFile))))
  completed.push(step)
  const expected = fs.readFileSync(reportFile)
  step = 'restart-persistence'; report('fail'); await stop(); await boot()
  await wait(() => js<boolean>(`document.body.innerText.includes('RELEASE_REVISED_OK')`))
  assert.deepEqual(fs.readFileSync(reportFile), expected)
  completed.push(step)
  fs.writeFileSync(path.join(output, 'live-result.png'), (await window!.webContents.capturePage()).toPNG())
  for (const fault of ['wrong-key', 'connection-refused'] as const) {
    step = fault; report('fail'); await stop()
    fs.writeFileSync(path.join(home, '.credentials.yaml'), JSON.stringify({version:1,refs:{DEEPSEEK_API_KEY:'sk-invalid-release-validation'}}), {mode:0o600})
    // Port 1 is intentionally unavailable; the rejected credential is also used here.
    settings(fault === 'connection-refused' ? 'http://127.0.0.1:1' : undefined)
    await boot()
    await wait(() => js<boolean>(`document.body.innerText.includes('RELEASE_REVISED_OK')`))
    const before = events().filter(row=>row.type==='turn/end').length
    await send('Reply exactly RELEASE_FAULT_RECOVERY_OK without tools.')
    await wait(async () => events().filter(row=>row.type==='turn/end').length > before)
    const ending = events().filter(row=>row.type==='turn/end').at(-1)
    assert.equal(ending.data.reason.kind, 'error')
    assert.equal(ending.data.reason.error.code, fault === 'wrong-key' ? 'AUTH' : 'TRANSPORT')
    await idle()
    assert.deepEqual(fs.readFileSync(reportFile), expected)
    completed.push(step)
    step = fault + '-recovery'; report('fail'); await stop()
    fs.writeFileSync(path.join(home, '.credentials.yaml'), credentialBytes, {mode:0o600})
    settings(); await boot()
    await wait(() => js<boolean>(`document.body.innerText.includes('RELEASE_REVISED_OK')`))
    const recoveredBefore = events().filter(row=>row.type==='turn/end').length
    await send('Reply exactly RELEASE_RECOVERED_OK without tools.')
    await wait(async () => events().filter(row=>row.type==='turn/end').length > recoveredBefore)
    assert.equal(events().filter(row=>row.type==='turn/end').at(-1).data.reason.kind, 'completed')
    assert.ok(hasCompletedAssistantReply(events(), events().filter(row=>row.type==='turn/end').at(-1).data.turn, 'RELEASE_RECOVERED_OK'))
    completed.push(step)
  }
  step = 'complete'; report('pass')
} catch (error) {
  if(window && !window.isDestroyed()) outputPaths = (await js<string[]>(`Array.from(document.querySelectorAll('[data-work-session-output]')).map(x=>x.getAttribute('data-work-session-output'))`)).map(p=>p.replaceAll(home,'<test-home>').replaceAll(fs.realpathSync(home),'<test-home>'))
  failureLocation = error instanceof Error ? error.stack?.split('\n').find(line => /live-release-e2e\.ts:\d/.test(line))?.match(/tests\/[^)]+/)?.[0] : undefined
  // Do not serialize provider exceptions, URLs, credentials, or diagnostics into public evidence.
  report('fail'); process.exitCode = 1
  if (window && !window.isDestroyed()) fs.writeFileSync(path.join(output, 'failure.png'), (await window.webContents.capturePage()).toPNG())
} finally {
  await stop().catch(() => {}); app.exit(process.exitCode === 1 ? 1 : 0)
}

}
void run()
