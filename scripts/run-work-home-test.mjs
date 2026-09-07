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

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-home-visual-'))
const reportPath = path.resolve('artifacts/design/work-home-result.json')
fs.mkdirSync(path.dirname(reportPath), { recursive: true })
fs.writeFileSync(reportPath, JSON.stringify({ status: 'fail', phase: 'launch' }, null, 2))

const child = spawn(electron, ['tests/work-home-e2e.ts'], {
  shell: false,
  env: { ...process.env, DSH_WORK_NODE: node, DSH_WORK_E2E_HOME: home },
  stdio: 'inherit',
})
const exit = await new Promise(resolve => {
  const timeout = setTimeout(() => child.kill('SIGKILL'), 75_000)
  child.on('error', () => { clearTimeout(timeout); resolve(-1) })
  child.on('close', code => { clearTimeout(timeout); resolve(code) })
})

let report
try { report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) } catch {}
removeOwnedTestHome(home)
if (exit !== 0 || report?.status !== 'pass') {
  console.error(`Work home visual acceptance failed in ${report?.phase || 'launch'}`)
  process.exitCode = 1
} else {
  console.log('Work home visual acceptance passed: 1440x900')
}
