// Real status window/bridge and official CLI, with a test-owned launcher.
// main.mjs shutdown wiring is covered separately by desktop-e2e.mjs.
import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createRuntimeHost } from '../packages/runtime-host/index.mjs'
import { createOfficialLauncher, prepareDevelopmentProfile } from '../packages/runtime-host/official-launcher.mjs'
import { createStatusWindow, registerDesktopScheme } from '../apps/desktop/window.mjs'

const output = path.resolve('artifacts/desktop/runtime-recovery')
const require = createRequire(import.meta.url)
const runtimeManifest = require.resolve('@deepseek-ai/dsh/package.json')
const runtimeManifestBytes = fs.readFileSync(runtimeManifest)
fs.mkdirSync(output, { recursive: true })
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-ui-recovery-'))
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-recovery-test-')))
app.commandLine.appendSwitch('disable-background-networking')
app.enableSandbox()
registerDesktopScheme()
let phase = 'boot', host, window, child, launches = 0
const events = [], screenshots = [], manifestChecks = []
const write = (status, extra = {}) => fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({
  status, phase, runId: process.env.DSH_WORK_E2E_RUN_ID,
  platform: process.platform, arch: process.arch, electron: process.versions.electron,
  screenshots, ...extra,
}, null, 2))
write('fail')
const progress = setInterval(() => write('fail'), 250)
const assertRuntimeManifest = label => {
  phase = label
  assert.deepEqual(fs.readFileSync(runtimeManifest), runtimeManifestBytes)
  manifestChecks.push(label)
}
const removeOwnedHome = () => {
  if (!fs.existsSync(home)) return
  const link = path.join(home, 'profiles/dsh-work/node_modules/@deepseek-ai/dsh-cmdline')
  if (fs.existsSync(link)) {
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true, 'only the test-created package junction may be detached')
    fs.unlinkSync(link)
  }
  fs.rmSync(home, { recursive: true, force: true })
}

async function run() {
  try {
    prepareDevelopmentProfile(home)
    const launch = createOfficialLauncher({ node: process.env.DSH_WORK_NODE, home })
    host = createRuntimeHost({ launch: () => {
      const generation = ++launches
      if (generation > 1) assert.ok(events.includes('close:1'))
      child = launch()
      child.once('exit', () => events.push(`exit:${generation}`))
      child.once('close', () => events.push(`close:${generation}`))
      return child
    } })
    window = await createStatusWindow(host)
    const js = source => window.webContents.executeJavaScript(source)
    const wait = async condition => {
      const deadline = Date.now() + 35_000
      while (Date.now() < deadline) {
        if (await js(condition)) return
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      throw Error('state timeout')
    }
    const capture = async file => {
      fs.writeFileSync(path.join(output, file), (await window.webContents.capturePage()).toPNG())
      screenshots.push(file)
    }
    await wait("document.body.dataset.state === 'stopped' && !document.getElementById('start').disabled")
    await js(`window.recoveryStates = []; window.dshWork.subscribe(value => window.recoveryStates.push({
      ...value, startDisabled: document.getElementById('start').disabled,
      stopDisabled: document.getElementById('stop').disabled,
    })); undefined`)
    phase = 'ready-before-runtime-fault'
    await js("document.getElementById('start').click()")
    await wait("document.body.dataset.state === 'ready'")
    await capture('ready.png')
    phase = 'owned-runtime-fault'
    assert.equal(child.kill('SIGKILL'), true)
    await wait("document.body.dataset.state === 'failed' && !document.getElementById('start').disabled")
    assert.deepEqual(events, ['exit:1', 'close:1'])
    assert.equal(launches, 1, 'runtime failure never automatically restarts')
    const states = await js('window.recoveryStates')
    const failures = states.filter(value => value.state === 'failed')
    assert.ok(failures.some(value => !value.canStart))
    assert.ok(failures.some(value => value.canStart))
    for (const value of failures) {
      assert.equal(value.startDisabled, !value.canStart)
      assert.equal(value.stopDisabled, !value.canStop)
    }
    assert.match(await js("document.getElementById('detail').textContent"), /直接子进程/)
    assert.equal(await js("document.getElementById('start').textContent"), '重试启动')
    await capture('failed.png')
    phase = 'explicit-renderer-retry'
    await js("document.getElementById('start').click()")
    await wait("document.body.dataset.state === 'ready'")
    assert.equal(launches, 2)
    await capture('recovered.png')
    await js("document.getElementById('stop').click()")
    await wait("document.body.dataset.state === 'stopped'")
    assert.deepEqual(events, ['exit:1', 'close:1', 'exit:2', 'close:2'])
    assert.equal(host.snapshot().canStart, true)
    assertRuntimeManifest('manifest-after-recovery-stop')
    removeOwnedHome()
    assertRuntimeManifest('manifest-after-home-cleanup')
    window.destroy()
    assertRuntimeManifest('manifest-after-window-destroy')
    phase = 'runtime-failure-ui-retry-complete'
    clearInterval(progress)
    write('pass', { terminal: host.snapshot(), launches, events, manifestChecks })
  } catch {
    clearInterval(progress)
    write('fail')
    process.exitCode = 1
  } finally {
    await host?.stop()
    if (!host || host.snapshot().canStart) removeOwnedHome()
    window?.destroy()
    app.quit()
  }
}
void app.whenReady().then(run)
