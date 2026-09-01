import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { removeOwnedTestHome } from '../tests/support/owned-test-home.ts'
const require = createRequire(import.meta.url)
const electron = require('electron')
if (!process.env.DSH_WORK_NODE) throw new Error('Set DSH_WORK_NODE to a verified standalone Node')
const modes = ['normal', 'missing', 'renderer-crash', 'runtime-recovery', 'host-death']
const requested = process.argv.indexOf('--mode')
const selected = requested < 0 ? modes : [process.argv[requested + 1]]
if (selected.some(mode => !modes.includes(mode))) throw new Error('Unknown desktop test mode')
for (const mode of selected) {
  const runId = randomUUID()
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), `dsh-work-electron-${mode}-`))
  const reportPath = `artifacts/desktop/${mode}/result.json`
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify({ status: 'fail', phase: 'launch', runId }))
  const entry = mode === 'runtime-recovery' ? 'tests/desktop-recovery-e2e.ts' : 'tests/desktop-e2e.ts'
  const executable = mode === 'host-death' ? process.execPath : electron
  const args = mode === 'host-death' ? ['scripts/run-host-death-test.mjs'] :
    [`--user-data-dir=${userData}`, entry,
      ...(mode === 'missing' ? ['--missing-runtime'] : mode === 'renderer-crash' ? ['--renderer-crash'] : [])]
  const child = spawn(executable, args, {
    shell: false, env: { ...process.env, DSH_WORK_E2E_RUN_ID: runId,
      DSH_WORK_ELECTRON: electron, DSH_WORK_E2E_USER_DATA: userData,
      ELECTRON_ENABLE_SECURITY_WARNINGS: '1' }, stdio: 'ignore',
  })
  const exit = await new Promise(resolve => {
    const timeout = setTimeout(() => { child.kill('SIGKILL') }, 90_000)
    child.on('error', () => { clearTimeout(timeout); resolve(-1) })
    child.on('close', code => { clearTimeout(timeout); resolve(code) })
  })
  let report
  try { report = JSON.parse(fs.readFileSync(reportPath)) } catch {}
  if (exit !== 0 || report?.status !== 'pass' || report?.runId !== runId) {
    console.error(`Electron ${mode} E2E failed in ${report?.phase || 'launch'}`)
    process.exitCode = 1
    break
  }
  report.revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  report.screenshotsSHA256 = Object.fromEntries(report.screenshots.map(file => [file,
    createHash('sha256').update(fs.readFileSync(path.join(path.dirname(reportPath), file))).digest('hex')]))
  try { removeOwnedTestHome(userData); report.testHomeCleanup = 'removed' } catch (error) {
    if (process.platform !== 'win32' || error?.code !== 'EPERM') throw error
    report.testHomeCleanup = 'deferred-windows-eperm'
  }
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(`Electron ${mode} E2E passed: ${report.phase}`)
}
