import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { removeOwnedTestHome } from '../tests/support/owned-test-home.ts'

const require = createRequire(import.meta.url)
const electron = require('electron')
if (!process.env.DSH_WORK_NODE) throw new Error('Set DSH_WORK_NODE to a verified standalone Node')
const runId = randomUUID()
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-runtime-context-'))
const reportPath = path.resolve('artifacts/desktop/runtime-context/result.json')
fs.mkdirSync(path.dirname(reportPath), { recursive: true })
fs.writeFileSync(reportPath, JSON.stringify({ status: 'fail', step: 'launch', runId }))
const child = spawn(electron, [`--user-data-dir=${userData}`, 'tests/runtime-context-e2e.ts'], {
  shell: false,
  env: {
    ...process.env,
    DSH_WORK_E2E_RUN_ID: runId,
    DSH_WORK_E2E_USER_DATA: userData,
    ELECTRON_ENABLE_SECURITY_WARNINGS: '1',
  },
  stdio: 'inherit',
})
const exit = await new Promise(resolve => {
  const timeout = setTimeout(() => child.kill('SIGKILL'), 90_000)
  child.on('error', () => { clearTimeout(timeout); resolve(-1) })
  child.on('close', code => { clearTimeout(timeout); resolve(code) })
})
let report
try { report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) } catch {}
if (exit !== 0 || report?.status !== 'pass' || report?.runId !== runId) {
  console.error(`Runtime context acceptance failed in ${report?.step || 'launch'}`)
  process.exitCode = 1
} else {
  removeOwnedTestHome(userData)
  console.log('Runtime context acceptance passed: same Session, draft, and no replay after restart')
}
