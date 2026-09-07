import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { discoverLocalProfiles } from '../packages/runtime-profile/discovery.ts'
import { prepareShadowProfile } from '../packages/runtime-profile/shadow.ts'

const treeDigest = (root: string): string => {
  const hash = createHash('sha256')
  const visit = (directory: string): void => {
    for (const name of fs.readdirSync(directory).sort()) {
      const item = path.join(directory, name)
      const stat = fs.lstatSync(item)
      hash.update(path.relative(root, item)).update('\0')
      if (stat.isSymbolicLink()) hash.update('link').update(fs.readlinkSync(item))
      else if (stat.isDirectory()) visit(item)
      else hash.update(fs.readFileSync(item))
    }
  }
  visit(root)
  return hash.digest('hex')
}

test('builds an owned shadow and shared-data overlay without changing the source profile', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-shadow-'))
  try {
    const sourceHome = path.join(root, 'source')
    const sourceProfile = path.join(sourceHome, 'profiles', 'team')
    const dependency = path.join(sourceProfile, 'node_modules', '@example', 'team-tools')
    fs.mkdirSync(dependency, { recursive: true })
    fs.writeFileSync(path.join(dependency, 'package.json'), `${JSON.stringify({
      name: '@example/team-tools',
      version: '1.0.0',
      type: 'module',
      main: 'index.js',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })}\n`)
    fs.writeFileSync(path.join(dependency, 'index.js'), 'export default () => {}\n')
    fs.writeFileSync(path.join(dependency, 'cordis.patch.yml'), '[]\n')
    fs.writeFileSync(path.join(sourceProfile, 'package.json'), `${JSON.stringify({
      private: true,
      dependencies: { '@example/team-tools': '1.0.0' },
      dsh: { profile: { bundles: [
        '@deepseek-ai/dsh-base',
        '@deepseek-ai/dsh-web-app',
        '@example/team-tools',
      ], patchReload: 'live' } },
    }, null, 2)}\n`)
    fs.writeFileSync(path.join(sourceProfile, 'cordis.patch.yml'), '- id: ui-theme\n  config:\n    preference: dark\n')
    const [source] = discoverLocalProfiles({
      environment: { DSH_HOME: sourceHome },
      userHome: root,
    }).profiles
    assert.ok(source)
    const before = treeDigest(sourceHome)
    const generationHome = path.join(root, 'generation')
    const selected = prepareShadowProfile(generationHome, source)

    assert.equal(treeDigest(sourceHome), before)
    assert.equal(selected.home, generationHome)
    assert.equal(selected.profile, 'dsh-work')
    assert.deepEqual(selected.patches, [path.join(generationHome, 'dsh-work-shared-data.patch.json')])
    const shadow = path.join(generationHome, 'profiles', 'dsh-work')
    const manifest = JSON.parse(fs.readFileSync(path.join(shadow, 'package.json'), 'utf8'))
    assert.deepEqual(manifest.dsh.profile.bundles, [
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      '@example/team-tools',
      '@dsh-work/work',
      '@dsh-work/lifecycle',
    ])
    assert.equal(fs.readFileSync(path.join(shadow, 'cordis.patch.yml'), 'utf8'),
      '- id: ui-theme\n  config:\n    preference: dark\n')
    assert.equal(fs.realpathSync(path.join(shadow, 'node_modules/@example/team-tools')),
      fs.realpathSync(dependency))

    const overlay = JSON.parse(fs.readFileSync(selected.patches[0]!, 'utf8')) as Array<Record<string, unknown>>
    assert.deepEqual(overlay.slice(0, 5), [
      { id: 'settings', config: { path: path.join(sourceHome, 'settings.yaml') } },
      { id: 'credentials', config: { path: path.join(sourceHome, '.credentials.yaml') } },
      { id: 'session-persistence-jsonl', config: { root: path.join(sourceHome, 'sessions') } },
      { id: 'attachment-local', config: { dshHome: sourceHome } },
      { id: 'storage-json', config: { root: path.join(sourceHome, 'storages') } },
    ])
    assert.equal(JSON.stringify(overlay).includes(sourceProfile), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('fails closed when the admitted source changes or a dependency escapes its declared package', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-shadow-fail-'))
  try {
    const sourceHome = path.join(root, 'source')
    const sourceProfile = path.join(sourceHome, 'profiles', 'web')
    fs.mkdirSync(sourceProfile, { recursive: true })
    fs.writeFileSync(path.join(sourceProfile, 'package.json'), `${JSON.stringify({
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
    })}\n`)
    const [source] = discoverLocalProfiles({
      environment: { DSH_HOME: sourceHome }, userHome: root,
    }).profiles
    assert.ok(source)
    fs.rmSync(sourceProfile, { recursive: true })
    fs.symlinkSync(root, sourceProfile, 'junction')
    assert.throws(() => prepareShadowProfile(path.join(root, 'generation'), source), /source Profile changed/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
