// Real desktop/main guardian and official CLI recovery from an uncertain generation.
import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import type { DesktopSession } from '../apps/desktop/main.ts'
import {
  createGenerationStore,
  type ClaimedGeneration,
  type GenerationSelection,
} from '../packages/runtime-guardian/generation-store.ts'
import { removeOwnedTestHome } from './support/owned-test-home.ts'

const emittedDesktopEntry: string = '../dist/apps/desktop/main.js'
const { desktop } = await import(emittedDesktopEntry) as {
  desktop: Promise<DesktopSession>
}

const output = path.resolve('artifacts/desktop/runtime-recovery')
const configuredProductRoot = process.env.DSH_WORK_E2E_USER_DATA
assert.ok(configuredProductRoot)
const productRoot: string = configuredProductRoot
app.setPath('userData', productRoot)
app.commandLine.appendSwitch('disable-background-networking')
fs.mkdirSync(output, { recursive: true })

const staleStore = createGenerationStore(productRoot, { id: () => 'uncertain-generation' })
const claimed = (selection: GenerationSelection): ClaimedGeneration => {
  assert.equal(selection.status, 'claimed')
  if (selection.status !== 'claimed') throw new Error('expected a claimed generation')
  return selection
}
const stale = claimed(staleStore.claim())
fs.writeFileSync(path.join(stale.home, 'uncertain.txt'), 'preserved')
let phase = 'boot'
let host: DesktopSession['host'] | null = null
const screenshots: string[] = []
const write = (status: 'pass' | 'fail', extra: Record<string, unknown> = {}): void => fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({
  status, phase, runId: process.env.DSH_WORK_E2E_RUN_ID,
  platform: process.platform, arch: process.arch, electron: process.versions.electron,
  screenshots, ...extra,
}, null, 2))
write('fail')
const progress = setInterval(() => write('fail'), 250)

async function run(): Promise<void> {
  try {
    const active = await desktop
    host = active.host
    const js = <T = unknown>(source: string): Promise<T> => active.window.webContents.executeJavaScript(source) as Promise<T>
    const wait = async (condition: string): Promise<void> => {
      const deadline = Date.now() + 35_000
      while (Date.now() < deadline) {
        if (await js(condition)) return
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      throw new Error('state timeout')
    }
    const capture = async (file: string): Promise<void> => {
      fs.writeFileSync(path.join(output, file), (await active.window.webContents.capturePage()).toPNG())
      screenshots.push(file)
    }
    await wait("document.body.dataset.state === 'stopped'")
    phase = 'ordinary-start-refuses-uncertain-generation'
    await js("document.getElementById('start').click()")
    await wait("document.body.dataset.state === 'failed'")
    assert.equal(active.host.snapshot().code, 'recovery-required')
    assert.equal(await js("document.getElementById('start').disabled"), true)
    assert.equal(await js("document.getElementById('recover').hidden"), false)
    assert.equal(fs.readFileSync(path.join(stale.home, 'uncertain.txt'), 'utf8'), 'preserved')
    await capture('recovery-required.png')

    phase = 'explicit-isolated-recovery'
    await js("document.getElementById('recover').click()")
    await wait("document.body.dataset.state === 'ready'")
    const recoveredGeneration = JSON.parse(fs.readFileSync(path.join(productRoot, 'runtime/active.json'), 'utf8')).generation
    assert.notEqual(recoveredGeneration, stale.generation)
    assert.equal(fs.readFileSync(path.join(stale.home, 'uncertain.txt'), 'utf8'), 'preserved')
    assert.equal(fs.readdirSync(path.join(productRoot, 'runtime/quarantine')).length, 1)
    await capture('recovered.png')
    await js("document.getElementById('stop').click()")
    await wait("document.body.dataset.state === 'stopped'")

    phase = 'window-close-disposes-guardian'
    app.once('will-quit', () => {
      clearInterval(progress)
      const terminal = active.host.snapshot()
      const passed = terminal.state === 'stopped' && terminal.code === null
      let testHomeCleanup = 'not-attempted'
      if (passed) {
        try { removeOwnedTestHome(productRoot); testHomeCleanup = 'removed' } catch (error: unknown) {
          if (process.platform !== 'win32' || !error || typeof error !== 'object' || !('code' in error) || error.code !== 'EPERM') throw error
          testHomeCleanup = 'deferred-windows-eperm'
        }
      }
      write(passed ? 'pass' : 'fail', { terminal, staleGenerationPreserved: true,
        recoveredGenerationDistinct: true, testHomeCleanup })
      if (!passed) process.exitCode = 1
    })
    active.window.close()
  } catch {
    clearInterval(progress)
    write('fail')
    try { await host?.stop(); await host?.dispose() } catch {}
    app.exit(1)
  }
}

void run()
