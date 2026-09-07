// Explicit desktop test: launch a relocated, real packaged executable through CDP.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
const root = path.resolve(import.meta.dirname, '..')
const receipt = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/package/receipt.json')))
assert.equal(receipt.platform, process.platform)
assert.equal(receipt.arch, process.arch)
const output = path.join(root, 'artifacts/package/smoke.json')
fs.writeFileSync(output, JSON.stringify({ status: 'fail', phase: 'launch' }))
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-package-'))
const installed = path.join(temporary, 'installed')
fs.cpSync(path.join(root, receipt.bundle), installed, { recursive: true, verbatimSymlinks: true })
const userData = path.join(temporary, 'user-data')
fs.mkdirSync(userData)
const executable = process.platform === 'darwin'
  ? path.join(installed, 'DSH Work.app/Contents/MacOS/DSH Work') : path.join(installed, 'DSH Work.exe')
const resources = process.platform === 'darwin' ? path.join(installed, 'DSH Work.app/Contents/Resources') : path.join(installed, 'resources')
assert.ok(fs.existsSync(path.join(resources, 'runtime/node', process.platform === 'win32' ? 'node.exe' : 'bin/node')))
assert.ok(!fs.existsSync(path.join(resources, 'app/node_modules/@electron/packager')))
for (const file of ['LICENSE.dsh-work.txt', 'third-party/inventory.json', 'third-party/electron-LICENSE', 'third-party/electron-LICENSES.chromium.html', 'runtime/node/LICENSE']) assert.ok(fs.existsSync(path.join(resources, file)), file)
let child
let socket
let clean = false
let phase = 'relocate'
let lastProbe
let sendCommand
const until = async (action, requireRunning = true) => {
  const deadline = Date.now() + 90000
  while (Date.now() < deadline) {
    const result = await action()
    if (result) return result
    if (requireRunning && child.exitCode !== null) throw new Error('packaged desktop exited before readiness')
    await delay(100)
  }
  throw new Error('packaged desktop timed out')
}
try {
  for (let pass = 0; pass < 2; pass++) {
    fs.rmSync(path.join(userData, 'DevToolsActivePort'), { force: true })
    const env = { ...process.env, DSH_HOME: path.join(temporary, 'empty-harness'), DSH_WORK_NODE: path.join(temporary, 'deliberately-missing-node'), PATH: path.dirname(executable) }
    delete env.ELECTRON_RUN_AS_NODE
    phase = `launch-${pass + 1}`
    child = spawn(executable, [`--user-data-dir=${userData}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--disable-background-networking'], { cwd: temporary, env, stdio: 'ignore' })
    let launchError
    child.on('error', error => { launchError = error })
    const port = await until(() => {
      if (launchError) throw launchError
      try { return Number(fs.readFileSync(path.join(userData, 'DevToolsActivePort'), 'utf8').split('\n')[0]) } catch { return false }
    })
    const page = await until(async () => {
      try { return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(target => target.type === 'page') } catch { return false }
    })
    socket = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
    let sequence = 0
    const pending = new Map()
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      const task = pending.get(message.id)
      if (task) { pending.delete(message.id); clearTimeout(task.timer); message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result) }
    })
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 10000)
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }))
    })
    sendCommand = send
    phase = `surface-${pass + 1}`
    await until(async () => {
      const response = await send('Runtime.evaluate', { expression: `(() => {
        for (const label of ['继续', 'Continue', '稍后配置', 'Configure later']) {
          const button = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === label);
          if (button) button.click();
        }
        const expand = [...document.querySelectorAll('button')].find(item => ['打开侧边栏', 'Open sidebar'].includes(item.getAttribute('aria-label') ?? ''));
        if (expand) expand.click();
        return { loopback: location.hostname === '127.0.0.1', brand: Boolean(document.querySelector('[data-dsh-work-brand="name"]')), composer: Boolean(document.querySelector('[data-composer-card]')), state: document.body.dataset.state ?? '', diagnostic: document.querySelector('#diagnostic')?.textContent ?? '', body: document.body.innerText.slice(0, 1200) };
      })()`, returnByValue: true })
      lastProbe = response.result?.value
      return lastProbe?.loopback && lastProbe?.brand && lastProbe?.composer
    })
    const screenshot = await send('Page.captureScreenshot')
    fs.writeFileSync(path.join(root, `artifacts/package/smoke-${pass + 1}.png`), Buffer.from(screenshot.data, 'base64'))
    phase = `quit-${pass + 1}`
    await send('Page.close')
    await until(() => child.exitCode !== null)
    assert.equal(child.exitCode, 0)
    socket.close(); socket = null
    const active = JSON.parse(fs.readFileSync(path.join(userData, 'runtime/active.json')))
    const terminal = path.join(userData, 'runtime/generations', active.generation, 'dsh-work-terminal.json')
    await until(() => fs.existsSync(terminal), false)
    assert.equal(JSON.parse(fs.readFileSync(terminal)).status, 'clean')
    if (pass === 1) assert.ok(fs.existsSync(path.join(userData, 'runtime/last-clean.json')))
  }
  clean = true
  fs.writeFileSync(output, JSON.stringify({ status: 'pass', revision: receipt.revision, platform: process.platform, arch: process.arch, distribution: receipt.distribution, relocated: true, launches: 2, cleanShutdown: true, developerNodeIgnored: true }, null, 2))
  console.log('Relocated packaged desktop: two launches, native surface, clean shutdown passed')
} catch (error) {
  if (sendCommand && socket?.readyState === WebSocket.OPEN) {
    try {
      const capture = await sendCommand('Page.captureScreenshot')
      fs.writeFileSync(path.join(root, 'artifacts/package/smoke-failure.png'), Buffer.from(capture.data, 'base64'))
    } catch {}
  }
  fs.writeFileSync(output, JSON.stringify({ status: 'fail', phase, probe: lastProbe, error: error.message }, null, 2))
  console.error(JSON.stringify({ phase, probe: lastProbe }))
  throw error
} finally {
  socket?.close()
  if (child && child.exitCode === null) child.kill()
  if (clean) fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
}
