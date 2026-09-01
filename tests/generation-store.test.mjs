import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createGenerationStore } from '../packages/runtime-guardian/generation-store.mjs'

const ownedRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-generation-store-'))

test('one active lease excludes a second guardian without consulting its PID', () => {
  const root = ownedRoot()
  try {
    const first = createGenerationStore(root, { pid: 101, id: () => 'generation-one', now: () => '2026-09-01T00:00:00.000Z' })
    const second = createGenerationStore(root, { pid: 202, id: () => 'generation-two', now: () => '2026-09-01T00:00:01.000Z' })
    const claimed = first.claim()
    assert.equal(claimed.status, 'claimed')
    assert.equal(second.claim().code, 'recovery-required')
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'runtime/active.json'))).guardianPid, 101)
    assert.equal(fs.existsSync(path.join(root, 'runtime/generations/generation-two')), false)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('only a confirmed clean release makes one generation reusable', () => {
  const root = ownedRoot()
  try {
    const first = createGenerationStore(root, { pid: 101, id: () => 'generation-clean', now: () => '2026-09-01T00:00:00.000Z' })
    const claimed = first.claim()
    fs.writeFileSync(path.join(claimed.home, 'preserved.txt'), 'clean-profile')
    assert.equal(first.releaseClean(claimed.generation), true)
    const second = createGenerationStore(root, { pid: 202, id: () => 'unused-generation', now: () => '2026-09-01T00:00:01.000Z' })
    const reused = second.claim()
    assert.equal(reused.generation, 'generation-clean')
    assert.equal(fs.readFileSync(path.join(reused.home, 'preserved.txt'), 'utf8'), 'clean-profile')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('explicit recovery quarantines the old record and preserves uncertain generation bytes', () => {
  const root = ownedRoot()
  try {
    const ids = ['generation-old', 'generation-new']
    const store = createGenerationStore(root, { pid: 101, id: () => ids.shift(), now: () => '2026-09-01T00:00:00.000Z' })
    const old = store.claim()
    fs.writeFileSync(path.join(old.home, 'uncertain.txt'), 'do-not-touch')
    const oldLease = fs.readFileSync(path.join(root, 'runtime/active.json'))
    const recovered = store.recover()
    assert.equal(recovered.generation, 'generation-new')
    assert.equal(fs.readFileSync(path.join(old.home, 'uncertain.txt'), 'utf8'), 'do-not-touch')
    const quarantined = fs.readdirSync(path.join(root, 'runtime/quarantine'))
    assert.equal(quarantined.length, 1)
    assert.deepEqual(fs.readFileSync(path.join(root, 'runtime/quarantine', quarantined[0])), oldLease)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('a stale guardian cannot release or overwrite a newer generation lease', () => {
  const root = ownedRoot()
  try {
    const old = createGenerationStore(root, { pid: 101, id: () => 'generation-old', now: () => '2026-09-01T00:00:00.000Z' })
    old.claim()
    const fresh = createGenerationStore(root, { pid: 202, id: () => 'generation-new', now: () => '2026-09-01T00:00:01.000Z' })
    assert.equal(fresh.recover().generation, 'generation-new')
    assert.equal(old.releaseClean('generation-old'), false)
    const active = JSON.parse(fs.readFileSync(path.join(root, 'runtime/active.json')))
    assert.equal(active.generation, 'generation-new')
    assert.equal(fs.existsSync(path.join(root, 'runtime/last-clean.json')), false)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('invalid records fail closed and never escape the product root', () => {
  const root = ownedRoot()
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-unrelated-'))
  try {
    fs.mkdirSync(path.join(root, 'runtime'), { recursive: true })
    fs.writeFileSync(path.join(root, 'runtime/active.json'), JSON.stringify({ generation: '../../escape' }))
    fs.writeFileSync(path.join(outside, 'sentinel'), 'alive')
    const store = createGenerationStore(root, { pid: 101, id: () => 'generation-new', now: () => '2026-09-01T00:00:00.000Z' })
    assert.equal(store.claim().code, 'recovery-required')
    assert.equal(store.recover().generation, 'generation-new')
    assert.equal(fs.readFileSync(path.join(outside, 'sentinel'), 'utf8'), 'alive')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  }
})

test('linked runtime directories are rejected without writing through them', () => {
  const root = ownedRoot()
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-unrelated-runtime-'))
  try {
    fs.symlinkSync(outside, path.join(root, 'runtime'), 'junction')
    assert.throws(() => createGenerationStore(root), /runtime path must be an owned directory/)
    assert.deepEqual(fs.readdirSync(outside), [])
  } finally {
    fs.unlinkSync(path.join(root, 'runtime'))
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  }
})

test('partial or forged terminal records never make an active generation reusable', () => {
  const root = ownedRoot()
  try {
    const first = createGenerationStore(root, { pid: 101, id: () => 'generation-active',
      now: () => '2026-09-01T00:00:00.000Z' })
    const claimed = first.claim()
    fs.writeFileSync(path.join(claimed.home, 'dsh-work-terminal.json'), JSON.stringify({
      schema: 'dsh-work.runtime-generation.v1', generation: claimed.generation, status: 'clean',
    }))
    const second = createGenerationStore(root, { pid: 202, id: () => 'must-not-launch',
      now: () => '2026-09-01T00:00:01.000Z' })
    assert.equal(second.claim().code, 'recovery-required')
    assert.equal(fs.existsSync(path.join(root, 'runtime/generations/must-not-launch')), false)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
