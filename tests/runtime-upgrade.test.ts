import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { writeStartupCheckpoint, readStartupCheckpoint } from '../packages/runtime-profile/checkpoint.ts'
import { createGenerationStore } from '../packages/runtime-guardian/generation-store.ts'

const version = '0.1.5-rc.1'
test('runtime upgrade pins the official release and records its version in new state', () => {
  const baseline = JSON.parse(fs.readFileSync(new URL('../runtime/baseline.json', import.meta.url), 'utf8'))
  assert.equal(baseline.runtime.version, version)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-upgrade-'))
  try {
    writeStartupCheckpoint(root, null, 'safe')
    assert.equal(readStartupCheckpoint(root)?.runtime, version)
    const store = createGenerationStore(root)
    assert.equal(store.claim().status, 'claimed')
    assert.equal(JSON.parse(fs.readFileSync(store.paths.active, 'utf8')).runtime, version)
    const checkpoint = path.join(root, 'startup-checkpoint.json')
    const old = JSON.parse(fs.readFileSync(checkpoint, 'utf8'))
    old.runtime = '0.1.2-alpha.2'
    fs.writeFileSync(checkpoint, JSON.stringify(old))
    assert.equal(readStartupCheckpoint(root), null, 'old runtime readiness is not new runtime evidence')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('upgrading does not take over or rewrite an old active runtime claim', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-upgrade-owner-'))
  try {
    const store = createGenerationStore(root)
    store.claim()
    const old = JSON.parse(fs.readFileSync(store.paths.active, 'utf8'))
    old.runtime = '0.1.2-alpha.2'
    const bytes = JSON.stringify(old)
    fs.writeFileSync(store.paths.active, bytes)
    assert.deepEqual(createGenerationStore(root).claim(), { status: 'blocked', code: 'recovery-required' })
    assert.equal(fs.readFileSync(store.paths.active, 'utf8'), bytes)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
