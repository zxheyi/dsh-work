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
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-electron-persistence-'))
const output = path.resolve('artifacts/desktop/work-persistence')
fs.mkdirSync(output, { recursive: true })
const read = file => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}
const launch = async phase => {
  const reportPath = path.join(output, `${phase}-result.json`)
  fs.writeFileSync(reportPath, JSON.stringify({ status: 'fail', phase, step: 'launch', runId }))
  const child = spawn(electron, [`--user-data-dir=${userData}`, 'tests/desktop-work-persistence-e2e.ts'], {
    shell: false,
    env: {
      ...process.env,
      DSH_WORK_E2E_RUN_ID: runId,
      DSH_WORK_E2E_USER_DATA: userData,
      DSH_WORK_E2E_PHASE: phase,
      ELECTRON_ENABLE_SECURITY_WARNINGS: '1',
    },
    stdio: 'ignore',
  })
  const exit = await new Promise(resolve => {
    const timeout = setTimeout(() => child.kill('SIGKILL'), 75_000)
    child.on('error', () => { clearTimeout(timeout); resolve(-1) })
    child.on('close', code => { clearTimeout(timeout); resolve(code) })
  })
  const report = read(reportPath)
  if (exit !== 0 || report?.status !== 'pass' || report?.runId !== runId) {
    throw new Error(`Desktop persistence ${phase} failed in ${report?.step || 'launch'}`)
  }
  const active = read(path.join(userData, 'runtime/active.json'))
  if (!active?.generation) throw new Error(`Desktop persistence ${phase} has no active generation`)
  return { report, generation: active.generation }
}

let complete = false
try {
  const created = await launch('create')
  const restored = await launch('restore')
  if (created.generation !== restored.generation) throw new Error('Clean desktop restart did not reuse its generation')
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({
    status: 'pass',
    runId,
    generationReused: true,
    workRestored: true,
    screenshots: ['create.png', 'restore.png'],
  }, null, 2))
  complete = true
  console.log('Desktop Work persistence E2E passed: same Work after restart')
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Desktop Work persistence E2E failed')
  process.exitCode = 1
} finally {
  if (complete) removeOwnedTestHome(userData)
}
