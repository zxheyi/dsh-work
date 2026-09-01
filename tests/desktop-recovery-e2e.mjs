// Real desktop/main guardian and official CLI recovery from an uncertain generation.
import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createGenerationStore } from '../packages/runtime-guardian/generation-store.ts'
import { desktop } from '../dist/apps/desktop/main.js'
import { removeOwnedTestHome } from './support/owned-test-home.ts'

const output = path.resolve('artifacts/desktop/runtime-recovery')
const productRoot = process.env.DSH_WORK_E2E_USER_DATA
app.setPath('userData', productRoot)
app.commandLine.appendSwitch('disable-background-networking')
fs.mkdirSync(output, { recursive: true })

const staleStore = createGenerationStore(productRoot, { id: () => 'uncertain-generation' })
const stale = staleStore.claim()
fs.writeFileSync(path.join(stale.home, 'uncertain.txt'), 'preserved')
let phase = 'boot', host, window
const screenshots = []
const write = (status, extra = {}) => fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({
  status, phase, runId: process.env.DSH_WORK_E2E_RUN_ID,
  platform: process.platform, arch: process.arch, electron: process.versions.electron,
  screenshots, ...extra,
}, null, 2))
write('fail')
const progress = setInterval(() => write('fail'), 250)

async function run() {
  try {
    ({ host, window } = await desktop)
    const js = source => window.webContents.executeJavaScript(source)
    const wait = async condition => {
      const deadline = Date.now() + 35_000
      while (Date.now() < deadline) {
        if (await js(condition)) return
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      throw new Error('state timeout')
    }
    const capture = async file => {
      fs.writeFileSync(path.join(output, file), (await window.webContents.capturePage()).toPNG())
      screenshots.push(file)
    }
    await wait("document.body.dataset.state === 'stopped'")
    phase = 'ordinary-start-refuses-uncertain-generation'
    await js("document.getElementById('start').click()")
    await wait("document.body.dataset.state === 'failed'")
    assert.equal(host.snapshot().code, 'recovery-required')
    assert.equal(await js("document.getElementById('start').disabled"), true)
    assert.equal(await js("document.getElementById('recover').hidden"), false)
    assert.equal(fs.readFileSync(path.join(stale.home, 'uncertain.txt'), 'utf8'), 'preserved')
    await capture('recovery-required.png')

    phase = 'explicit-isolated-recovery'
    await js("document.getElementById('recover').click()")
    await wait("document.body.dataset.state === 'ready'")
    const recoveredGeneration = JSON.parse(fs.readFileSync(path.join(productRoot, 'runtime/active.json'))).generation
    assert.notEqual(recoveredGeneration, stale.generation)
    assert.equal(fs.readFileSync(path.join(stale.home, 'uncertain.txt'), 'utf8'), 'preserved')
    assert.equal(fs.readdirSync(path.join(productRoot, 'runtime/quarantine')).length, 1)
    await capture('recovered.png')
    await js("document.getElementById('stop').click()")
    await wait("document.body.dataset.state === 'stopped'")

    phase = 'window-close-disposes-guardian'
    app.once('will-quit', () => {
      clearInterval(progress)
      const terminal = host.snapshot()
      const passed = terminal.state === 'stopped' && terminal.code === null
      let testHomeCleanup = 'not-attempted'
      if (passed) {
        try { removeOwnedTestHome(productRoot); testHomeCleanup = 'removed' } catch (error) {
          if (process.platform !== 'win32' || error?.code !== 'EPERM') throw error
          testHomeCleanup = 'deferred-windows-eperm'
        }
      }
      write(passed ? 'pass' : 'fail', { terminal, staleGenerationPreserved: true,
        recoveredGenerationDistinct: true, testHomeCleanup })
      if (!passed) process.exitCode = 1
    })
    window.close()
  } catch {
    clearInterval(progress)
    write('fail')
    try { await host?.stop(); await host?.dispose() } catch {}
    app.exit(1)
  }
}

void run()
