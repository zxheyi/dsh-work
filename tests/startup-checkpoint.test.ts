import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  readStartupCheckpoint,
  writeStartupCheckpoint,
} from '../packages/runtime-profile/checkpoint.ts'

test('healthy checkpoints retain only bounded startup identity', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-checkpoint-'))
  try {
    writeStartupCheckpoint(root, {
      kind: 'shared', profileId: 'a'.repeat(24), profileName: 'web', homePath: '/private/source',
    }, 'selected', () => '2026-09-07T12:00:00.000Z')
    assert.deepEqual(readStartupCheckpoint(root), {
      schema: 'dsh-work.startup-checkpoint.v1', runtime: '0.1.2-alpha.2', mode: 'selected',
      source: { kind: 'shared', profileId: 'a'.repeat(24), profileName: 'web' },
      readyAt: '2026-09-07T12:00:00.000Z',
    })
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'startup-checkpoint.json'), 'utf8'), /\/private\/source/u)
    assert.equal(fs.statSync(path.join(root, 'startup-checkpoint.json')).mode & 0o077, 0)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('safe-mode checkpoints are isolated and malformed checkpoints fail closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-checkpoint-safe-'))
  try {
    writeStartupCheckpoint(root, null, 'safe', () => '2026-09-07T12:00:00.000Z')
    assert.equal(readStartupCheckpoint(root)?.source.kind, 'isolated')
    fs.writeFileSync(path.join(root, 'startup-checkpoint.json'), '{}')
    assert.equal(readStartupCheckpoint(root), null)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
