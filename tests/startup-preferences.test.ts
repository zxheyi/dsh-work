import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { discoverLocalProfiles } from '../packages/runtime-profile/discovery.ts'
import {
  readStartupSelection,
  resolveSelectedProfile,
  writeStartupSelection,
} from '../packages/runtime-profile/preferences.ts'

test('persists isolated and shared startup choices without exposing them through a public catalog', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-startup-choice-'))
  try {
    assert.equal(readStartupSelection(root), null)
    writeStartupSelection(root, { kind: 'isolated' })
    assert.deepEqual(readStartupSelection(root), { kind: 'isolated' })

    const sourceHome = path.join(root, 'source')
    const profile = path.join(sourceHome, 'profiles', 'web')
    fs.mkdirSync(profile, { recursive: true })
    fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
    }))
    const [selected] = discoverLocalProfiles({
      environment: { DSH_HOME: sourceHome }, userHome: root,
    }).profiles
    assert.ok(selected)
    writeStartupSelection(root, {
      kind: 'shared',
      profileId: selected.id,
      profileName: selected.name,
      homePath: selected.homePath,
    })
    const stored = readStartupSelection(root)
    assert.deepEqual(stored, {
      kind: 'shared',
      profileId: selected.id,
      profileName: 'web',
      homePath: sourceHome,
    })
    assert.equal(resolveSelectedProfile(stored)?.profilePath, profile)
    assert.equal(fs.statSync(path.join(root, 'startup-preferences.json')).mode & 0o077, 0)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('rejects malformed, linked, stale and traversal selections', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-startup-choice-fail-'))
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-startup-choice-outside-'))
  try {
    const file = path.join(root, 'startup-preferences.json')
    fs.writeFileSync(file, '{}')
    assert.equal(readStartupSelection(root), null)
    fs.rmSync(file)
    fs.writeFileSync(path.join(outside, 'choice.json'), JSON.stringify({ schema: 'dsh-work.startup.v1', selection: { kind: 'isolated' } }))
    fs.symlinkSync(path.join(outside, 'choice.json'), file)
    assert.equal(readStartupSelection(root), null)
    fs.rmSync(file)
    assert.throws(() => writeStartupSelection(root, {
      kind: 'shared', profileId: 'a'.repeat(24), profileName: '../web', homePath: outside,
    }))
    assert.equal(resolveSelectedProfile({
      kind: 'shared', profileId: 'b'.repeat(24), profileName: 'web', homePath: outside,
    }), null)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  }
})
