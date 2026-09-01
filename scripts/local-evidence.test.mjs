import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

test('an unreadable context invalidates previous local verification before any work', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-local-evidence-'))
  try {
    fs.mkdirSync(path.join(root, 'scripts'))
    for (const file of ['verify-local.mjs', 'verify-product-runtime.mjs', 'runtime-provenance.mjs']) {
      fs.copyFileSync(new URL(file, import.meta.url), path.join(root, 'scripts', file))
    }
    const output = path.join(root, 'artifacts/verification')
    fs.mkdirSync(output, { recursive: true })
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ status: 'local-development-pass' }))
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/verify-local.mjs'), path.join(root, 'missing-context.json')])
    assert.equal(result.status, 1)
    const report = JSON.parse(fs.readFileSync(path.join(output, 'result.json')))
    assert.equal(report.status, 'fail')
    assert.equal(report.phase, 'read-context')
    assert.deepEqual(report.checks, [])
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
