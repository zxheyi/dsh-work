import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createGuardianClient } from '../packages/runtime-guardian/client.mjs'
import { removeOwnedTestHome } from '../tests/support/owned-test-home.mjs'

const output = path.resolve('artifacts/desktop/host-death')
const resultPath = path.join(output, 'result.json')
const electron = process.env.DSH_WORK_ELECTRON
const runId = process.env.DSH_WORK_E2E_RUN_ID
if (!path.isAbsolute(electron || '') || !path.isAbsolute(process.env.DSH_WORK_NODE || '') || !runId) process.exit(2)
fs.mkdirSync(output, { recursive: true })

const report = { status: 'fail', phase: 'launch', runId, platform: process.platform,
  arch: process.arch, electron: '44.0.0', screenshots: [], scenarios: [], cleanup: [] }
const write = () => fs.writeFileSync(resultPath, JSON.stringify(report, null, 2))
const waitFor = async (condition, message, timeout = 35_000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = condition()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(message)
}
const readJSON = file => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}
write()

async function exercise(phase) {
  const productRoot = fs.mkdtempSync(path.join(os.tmpdir(), `dsh-work-electron-death-${phase}-`))
  const armedPath = path.join(output, `${phase}.json`)
  let desktop, client, clean = false
  try {
    fs.writeFileSync(armedPath, JSON.stringify({ status: 'launching', runId }))
    desktop = spawn(electron, [`--user-data-dir=${productRoot}`, 'tests/desktop-host-death-e2e.mjs'], {
      shell: false,
      env: { ...process.env, DSH_WORK_HOST_DEATH_ROOT: productRoot,
        DSH_WORK_HOST_DEATH_REPORT: armedPath, DSH_WORK_HOST_DEATH_PHASE: phase,
        ELECTRON_ENABLE_SECURITY_WARNINGS: '1' },
      stdio: 'ignore',
    })
    await waitFor(() => {
      const value = readJSON(armedPath)
      if (value?.status === 'fail') throw new Error(`Electron failed during ${phase}`)
      return value?.status === 'armed' && value.runId === runId ? value : null
    }, `Electron did not arm ${phase}`)
    const generation = readJSON(path.join(productRoot, 'runtime/active.json'))?.generation
    if (!generation) throw new Error('active generation missing')
    if (!desktop.kill('SIGKILL')) throw new Error('exact Electron process was not terminated')
    const exit = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Electron did not exit')), 15_000)
      desktop.once('error', reject)
      desktop.once('close', (code, signal) => { clearTimeout(timeout); resolve({ code, signal }) })
    })
    await waitFor(() => readJSON(path.join(productRoot, 'runtime/generations', generation,
      'dsh-work-terminal.json'))?.status === 'clean', 'guardian did not confirm clean shutdown')

    client = await createGuardianClient({ node: process.env.DSH_WORK_NODE, productRoot })
    const ready = await client.start()
    if (ready.state !== 'ready') throw new Error('replacement desktop could not start Harness')
    const reused = readJSON(path.join(productRoot, 'runtime/active.json'))?.generation
    if (reused !== generation) throw new Error('clean generation was not reused')
    const stopped = await client.stop()
    if (stopped.state !== 'stopped' || !await client.dispose()) throw new Error('replacement cleanup failed')
    clean = true
    return { phase, generationReused: true, electronExit: exit }
  } finally {
    if (desktop && desktop.exitCode === null && desktop.signalCode === null) desktop.kill('SIGKILL')
    await client?.stop().catch(() => {})
    await client?.dispose().catch(() => {})
    if (clean) {
      try {
        removeOwnedTestHome(productRoot)
        report.cleanup.push({ phase, status: 'removed' })
      } catch (error) {
        if (process.platform !== 'win32' || error?.code !== 'EPERM') throw error
        report.cleanup.push({ phase, status: 'deferred-windows-eperm' })
      }
    }
  }
}

try {
  for (const phase of ['before-ready', 'after-ready']) {
    report.phase = phase; write()
    report.scenarios.push(await exercise(phase)); write()
  }
  report.status = 'pass'
  report.phase = 'guardian-recovered-before-and-after-ready'
} catch {
  process.exitCode = 1
} finally { write() }
