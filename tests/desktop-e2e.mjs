// Explicit Electron entry point; never imported by headless unit tests.
import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { desktop } from '../dist/apps/desktop/main.js'

const missing = process.argv.includes('--missing-runtime')
const rendererCrash = process.argv.includes('--renderer-crash')
const name = missing ? 'missing' : rendererCrash ? 'renderer-crash' : 'normal'
const output = path.resolve('artifacts/desktop', name)
fs.mkdirSync(output, { recursive: true })
const reportPath = path.join(output, 'result.json')
let phase = 'boot'
const write = (status, extra = {}) => fs.writeFileSync(reportPath, JSON.stringify({ status, phase,
  runId: process.env.DSH_WORK_E2E_RUN_ID,
  platform: process.platform, arch: process.arch, electron: process.versions.electron, ...extra }, null, 2))
write('fail')
const progress = setInterval(() => write('fail'), 250)
app.setPath('userData', process.env.DSH_WORK_E2E_USER_DATA)
app.commandLine.appendSwitch('disable-background-networking')
if (missing) process.env.DSH_WORK_NODE = path.join(output, 'deliberately-missing-node')
let host, window
async function run() {
try {
  ({ host, window } = await desktop)
  const js = source => window.webContents.executeJavaScript(source)
  const waitState = async state => {
    const deadline = Date.now() + 35_000
    while (Date.now() < deadline) {
      if (await js('document.body.dataset.state') === state) return
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    throw new Error('state timeout')
  }
  const screenshot = async state => {
    await waitState(state)
    fs.writeFileSync(path.join(output, `${state}.png`), (await window.webContents.capturePage()).toPNG())
  }
  await waitState('stopped')
  phase = 'bridge-isolation'
  assert.equal(process.versions.electron, '44.0.0')
  phase = 'bridge-key-list'
  assert.equal(await js('JSON.stringify(Object.keys(window.dshWork).sort())'), JSON.stringify(['recover', 'snapshot', 'start', 'stop', 'subscribe']))
  phase = 'renderer-globals'
  assert.equal(await js('JSON.stringify([typeof require, typeof process, typeof ipcRenderer])'), JSON.stringify(['undefined', 'undefined', 'undefined']))
  phase = 'security-preferences'
  const prefs = window.webContents.getLastWebPreferences()
  phase = 'sandbox-preference'; assert.equal(prefs.sandbox, true)
  phase = 'isolation-preference'; assert.equal(prefs.contextIsolation, true)
  phase = 'node-preference'; assert.equal(prefs.nodeIntegration, false)
  phase = 'observe-renderer-states'
  await js('window.observedStates = []; window.dshWork.subscribe(s => window.observedStates.push(s.state)); undefined')
  phase = 'initial-screenshot'
  await screenshot('stopped')
  phase = 'start-button'
  await js("document.getElementById('start').click()")
  if (missing) {
    await screenshot('failed')
    assert.equal(host.snapshot().code, 'runtime-unavailable')
    assert.equal(await js("document.getElementById('start').disabled"), false)
    await js("document.getElementById('start').click()")
    await waitState('failed')
  } else {
    await screenshot('ready')
    assert.equal(await js("document.getElementById('start').disabled"), true)
    assert.equal(await js("document.getElementById('stop').disabled"), false)
    phase = 'stop-button'
    await js("document.getElementById('stop').click()")
    await waitState('stopped')
    assert.equal(host.snapshot().code, null)
    const states = await js('window.observedStates')
    for (const state of ['starting', 'ready', 'stopping', 'stopped']) assert.ok(states.includes(state))
    phase = 'early-stop-through-renderer'
    await js('window.observedStates = []; window.earlyStart = window.dshWork.start(); window.earlyStop = window.dshWork.stop(); undefined')
    const early = await js('Promise.all([window.earlyStart, window.earlyStop])')
    assert.ok(early.every(value => value.state === 'stopped' && value.code === null && value.canStart))
    await waitState('stopped')
    assert.deepEqual(await js('window.observedStates'), ['starting', 'stopping', 'stopped'])
    assert.equal(await js("document.getElementById('start').disabled"), false)
    assert.equal(await js("document.getElementById('stop').disabled"), true)
    phase = 'restart-button'
    await js("document.getElementById('start').click()")
    await waitState('ready')
  }
  phase = 'navigation-denied'
  await js("window.open('https://example.com/')")
  await js("location.href = 'https://example.com/'")
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(BrowserWindow.getAllWindows().length, 1)
  assert.equal(window.webContents.getURL(), 'dsh-work://status/index.html')
  phase = rendererCrash ? 'renderer-crash-stops-runtime' : 'window-close-stops-runtime'
  let crashObserved = false
  if (rendererCrash) window.webContents.once('render-process-gone', () => { crashObserved = true })
  // Exercise the emitted desktop window-close or renderer-gone shutdown entry.
  app.once('will-quit', () => {
    clearInterval(progress)
    const status = host.snapshot()
    const passed = status.canStart && (missing ? status.code === 'runtime-unavailable' : status.state === 'stopped') && (!rendererCrash || crashObserved)
    write(passed ? 'pass' : 'fail', { terminal: status, crashObserved, screenshots: missing ? ['stopped.png', 'failed.png'] : ['stopped.png', 'ready.png'] })
    if (!passed) process.exitCode = 1
  })
  if (rendererCrash) window.webContents.forcefullyCrashRenderer()
  else window.close()
} catch {
  clearInterval(progress)
  write('fail')
  if (host) await host.stop()
  app.exit(1)
}
}
void run()
