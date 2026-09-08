import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { prepareProductProfile } from '../packages/runtime-host/official-launcher.ts'

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
    fs.mkdirSync(path.join(sourceHome, '.agent-presets'))
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

const nativeRequire = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json'))
const nativeWebRequire = createRequire(nativeRequire.resolve('@deepseek-ai/dsh-web-app/package.json'))
const nativePresets = await import(pathToFileURL(nativeWebRequire.resolve('@deepseek-ai/dsh-agent-presets')).href)

function presetFixture(root: string) {
  const sourceHome = path.join(root, 'source')
  const sourceProfile = path.join(sourceHome, 'profiles', 'web')
  fs.mkdirSync(sourceProfile, { recursive: true })
  fs.writeFileSync(path.join(sourceProfile, 'package.json'), JSON.stringify({
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  }))
  const customPatch = JSON.stringify([{ id: 'agent-presets', config: {
    default: 'custom', roots: [{ path: path.join(root, 'team-presets'), trust: 'user' }],
    includeShippedRoot: false, includeUserRoot: false,
  } }])
  fs.writeFileSync(path.join(sourceProfile, 'cordis.patch.yml'), customPatch)
  const [source] = discoverLocalProfiles({ environment: { DSH_HOME: sourceHome }, userHome: root }).profiles
  assert.ok(source)
  return { source, sourceHome, sourceProfile, customPatch, generation: path.join(root, 'generation') }
}

test('shared user presets use native discovery and authoring without replacing custom configuration', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-presets-'))
  try {
    const fixture = presetFixture(root)
    const preset = path.join(fixture.sourceHome, '.agent-presets', 'workbench-readonly')
    fs.mkdirSync(preset, { recursive: true })
    fs.writeFileSync(path.join(preset, 'preset.yml'), 'name: Workbench 只读巡检\n')
    fs.writeFileSync(path.join(preset, 'agent.cordis.yml'), '[]\n')
    const before = treeDigest(fixture.sourceHome)
    const prepared = prepareShadowProfile(fixture.generation, fixture.source)
    prepareShadowProfile(fixture.generation, fixture.source)
    assert.equal(treeDigest(fixture.sourceHome), before)
    assert.equal(fs.readFileSync(path.join(fixture.generation, 'profiles/dsh-work/cordis.patch.yml'), 'utf8'), fixture.customPatch)
    assert.equal(fs.readFileSync(prepared.patches[0]!, 'utf8').includes('agent-presets'), false)
    const roots = [{ path: path.join(fixture.generation, '.agent-presets'), trust: 'user' }]
    const found = await nativePresets.discoverPresets(roots, pathToFileURL(fixture.sourceProfile + path.sep))
    assert.equal(found.length, 1)
    assert.equal(found[0].id, 'workbench-readonly')
    assert.equal(found[0].name, 'Workbench 只读巡检')
    assert.equal(found[0].broken, undefined)
    await nativePresets.copyComposition(roots, found[0], 'copied-preset')
    assert.ok(fs.existsSync(path.join(fixture.sourceHome, '.agent-presets/copied-preset/agent.cordis.yml')))
    const copied = (await nativePresets.discoverPresets(roots, pathToFileURL(fixture.sourceProfile + path.sep))).find((item: { id: string }) => item.id === 'copied-preset')
    await nativePresets.deleteComposition(roots, copied)
    assert.equal(treeDigest(fixture.sourceHome), before)
    const isolated = path.join(root, 'isolated')
    prepareProductProfile(isolated)
    assert.equal(fs.existsSync(path.join(isolated, '.agent-presets')), false)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('missing shared preset roots permit authoring, while conflicting owned paths are preserved', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-presets-empty-'))
  try {
    const fixture = presetFixture(root)
    prepareShadowProfile(fixture.generation, fixture.source)
    fs.mkdirSync(path.join(fixture.generation, '.agent-presets/new-preset'))
    assert.ok(fs.statSync(path.join(fixture.sourceHome, '.agent-presets/new-preset')).isDirectory())
    fs.unlinkSync(path.join(fixture.generation, '.agent-presets'))
    fs.mkdirSync(path.join(fixture.generation, '.agent-presets'))
    fs.writeFileSync(path.join(fixture.generation, '.agent-presets/keep'), 'owned data')
    assert.throws(() => prepareShadowProfile(fixture.generation, fixture.source), /preset directory conflict/)
    assert.equal(fs.readFileSync(path.join(fixture.generation, '.agent-presets/keep'), 'utf8'), 'owned data')
    fs.rmSync(path.join(fixture.generation, '.agent-presets'), { recursive: true })
    fs.symlinkSync(path.join(root, 'wrong-target'), path.join(fixture.generation, '.agent-presets'), 'junction')
    assert.throws(() => prepareShadowProfile(fixture.generation, fixture.source), /preset directory conflict/)
    assert.equal(fs.readlinkSync(path.join(fixture.generation, '.agent-presets')), path.join(root, 'wrong-target'))

  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
