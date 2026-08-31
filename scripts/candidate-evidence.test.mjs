import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

test('an early verification failure replaces an old success report', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-evidence-test-'))
  try {
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ status: 'candidate-native-probe-pass' }))
    const runner = fileURLToPath(new URL('../prototypes/m0-runtime-upgrade/verify.mjs', import.meta.url))
    const result = spawnSync(process.execPath, [runner, path.join(dir, 'missing-context.json'), dir], { encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    const report = JSON.parse(fs.readFileSync(path.join(dir, 'result.json')))
    assert.equal(report.status, 'candidate-native-probe-fail')
    assert.equal(report.phase, 'read-context')
    assert.ok(report.testedAt)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
