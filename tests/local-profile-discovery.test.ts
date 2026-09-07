import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  discoverLocalProfiles,
  publicProfileCatalog,
} from '../packages/runtime-profile/discovery.ts'

const writeProfile = (home: string, name: string, bundles: readonly string[]): string => {
  const profile = path.join(home, 'profiles', name)
  fs.mkdirSync(profile, { recursive: true })
  fs.writeFileSync(path.join(profile, 'package.json'), `${JSON.stringify({
    private: true,
    dsh: { profile: { bundles } },
  }, null, 2)}\n`)
  fs.writeFileSync(path.join(profile, 'cordis.patch.yml'), '[]\n')
  return profile
}

test('discovers bounded base-plus-web profiles using only a symbolic home label', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-discovery-'))
  try {
    const configured = path.join(root, 'configured-home')
    writeProfile(configured, 'team', [
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      '@example/team-tools',
    ])
    writeProfile(configured, 'web', ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    writeProfile(configured, 'headless', ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'])

    const catalog = discoverLocalProfiles({
      environment: { DSH_HOME: configured },
      userHome: root,
    })
    assert.equal(catalog.homePath, configured)
    assert.equal(catalog.homeLabel, '$DSH_HOME')
    assert.deepEqual(catalog.profiles.map(profile => profile.name), ['web', 'team'])
    assert.equal(catalog.rejectedCount, 1)
    assert.equal(catalog.profiles.every(profile => profile.id.length === 24), true)

    const visible = publicProfileCatalog(catalog)
    assert.deepEqual(visible, {
      homeLabel: '$DSH_HOME',
      profiles: catalog.profiles.map(({ id, name }) => ({ id, name })),
      rejectedCount: 1,
    })
    assert.equal(JSON.stringify(visible).includes(configured), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('uses the official default home and refuses linked or malformed profile inputs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-discovery-boundary-'))
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-discovery-outside-'))
  try {
    const home = path.join(root, '.dsh')
    writeProfile(home, 'valid', ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    writeProfile(home, 'reversed', ['@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-base'])
    writeProfile(home, 'embedded', [
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      '@dsh-work/work',
    ])
    const linkedTarget = writeProfile(outside, 'linked-target', [
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
    ])
    fs.symlinkSync(linkedTarget, path.join(home, 'profiles', 'linked'), 'junction')
    const malformed = path.join(home, 'profiles', 'malformed')
    fs.mkdirSync(malformed)
    fs.writeFileSync(path.join(malformed, 'package.json'), '{')

    const catalog = discoverLocalProfiles({ environment: {}, userHome: root })
    assert.equal(catalog.homeLabel, '~/.dsh')
    assert.deepEqual(catalog.profiles.map(profile => profile.name), ['valid'])
    assert.equal(catalog.rejectedCount, 4)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  }
})

test('fails closed for relative, linked, missing and oversized homes or manifests', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-discovery-fail-'))
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-discovery-home-'))
  try {
    assert.deepEqual(discoverLocalProfiles({
      environment: { DSH_HOME: 'relative-home' },
      userHome: root,
    }).profiles, [])
    assert.deepEqual(discoverLocalProfiles({
      environment: { DSH_HOME: path.join(root, 'missing') },
      userHome: root,
    }).profiles, [])

    const linkedHome = path.join(root, 'linked-home')
    fs.symlinkSync(outside, linkedHome, 'junction')
    assert.deepEqual(discoverLocalProfiles({
      environment: { DSH_HOME: linkedHome },
      userHome: root,
    }).profiles, [])

    const home = path.join(root, 'large-home')
    const profile = writeProfile(home, 'large', ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    fs.writeFileSync(path.join(profile, 'package.json'), ' '.repeat(65 * 1024))
    assert.deepEqual(discoverLocalProfiles({
      environment: { DSH_HOME: home },
      userHome: root,
    }).profiles, [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  }
})
