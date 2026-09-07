import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { removeOwnedTestHome } from '../tests/support/owned-test-home.ts'

const require = createRequire(import.meta.url)
const electron = require('electron')
const node = process.env.DSH_WORK_NODE
if (!node) throw new Error('Set DSH_WORK_NODE to a verified standalone Node')
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-session-output-'))
const reportPath = path.resolve('artifacts/session-output/result.json')
fs.mkdirSync(path.dirname(reportPath), { recursive: true })
fs.writeFileSync(reportPath, JSON.stringify({ status: 'fail', step: 'launch' }, null, 2))
const child = spawn(electron, ['tests/session-output-e2e.ts'], {
  shell: false,
  env: { ...process.env, DSH_WORK_NODE: node, DSH_WORK_E2E_HOME: home },
  stdio: 'inherit',
})
const exit = await new Promise(resolve => {
  const timeout = setTimeout(() => child.kill('SIGKILL'), 90_000)
  child.on('error', () => { clearTimeout(timeout); resolve(-1) })
  child.on('close', code => { clearTimeout(timeout); resolve(code) })
})
let report
try { report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) } catch {}
removeOwnedTestHome(home)
if (exit !== 0 || report?.status !== 'pass') {
  console.error(`Session output acceptance failed in ${report?.step || 'launch'}`)
  process.exitCode = 1
} else {
  console.log('Session output acceptance passed: validate files and safely preview Markdown')
}
