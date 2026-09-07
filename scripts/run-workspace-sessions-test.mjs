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
const mappedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-workspace-sessions-'))

for (const phase of ['empty', 'create', 'restore']) {
  const home = phase === 'empty'
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-workspace-empty-'))
    : mappedHome
  const reportPath = path.resolve(`artifacts/workspace-sessions/${phase}-result.json`)
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify({ status: 'fail', phase, step: 'launch' }, null, 2))
  const child = spawn(electron, ['tests/workspace-sessions-e2e.ts'], {
    shell: false,
    env: {
      ...process.env,
      DSH_WORK_NODE: node,
      DSH_WORK_E2E_HOME: home,
      DSH_WORK_E2E_PHASE: phase,
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
  if (phase === 'empty') removeOwnedTestHome(home)
  if (exit !== 0 || report?.status !== 'pass') {
    console.error(`Workspace/Session acceptance failed in ${phase}/${report?.step || 'launch'}`)
    process.exitCode = 1
    break
  }
}

removeOwnedTestHome(mappedHome)
if (process.exitCode === undefined) {
  console.log('Workspace/Session acceptance passed: empty selection, two Sessions, and restart mapping')
}
