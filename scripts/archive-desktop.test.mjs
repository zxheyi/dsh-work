import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { archiveDesktop, validateCandidateEvidence, verifyBundledDistribution, writeCandidateArchive } from './archive-desktop.mjs'
import { stageSourceCompanion, withSourceCompanion } from './source-companion.mjs'
import { bundleSHA256 } from './bundle-digest.mjs'

const digest = 'a'.repeat(64)
const fixture = () => ({
  current: { revision: 'b'.repeat(40), version: '0.0.1-alpha.1', platform: 'darwin', arch: 'arm64', lockfileSHA256: digest, bundleSHA256: digest, clean: true },
  receipt: { schema: 'dsh-work.desktop-package.v1', revision: 'b'.repeat(40), version: '0.0.1-alpha.1', platform: 'darwin', arch: 'arm64', lockfileSHA256: digest, distribution: 'unsigned-internal-test' },
  smoke: { status: 'pass', revision: 'b'.repeat(40), platform: 'darwin', arch: 'arm64', distribution: 'unsigned-internal-test', bundleSHA256: digest, relocated: true, launches: 2, cleanShutdown: true, developerNodeIgnored: true, nativeTools: { node: '24.11.1', npm: true, npx: true, pty: true, sharp: true } },
  inventory: { schema: 'dsh-work.distribution-notices.v1', platform: 'darwin', arch: 'arm64', lockfileSHA256: digest, blockers: [], packages: [{ name: '@img/sharp-libvips-darwin-arm64', nativeComponents: { vips: '8.18.6' }, notices: [{ file: 'texts/license.txt', sha256: digest }], nativeMaterials: [{ file: 'native/source.tar.gz', sha256: digest }], nativeBinaries: [{ file: 'lib/libvips.dylib', sha256: digest }] }] },
  replacement: { platform: 'darwin', arch: 'arm64', replacements: [{ file: 'libvips.dylib', before: digest, after: 'c'.repeat(64) }], result: { version: { semver: '8.18.6', isGlobal: false, isWasm: false }, formats: ['jpeg', 'png'] } },
  bundledManifest: { version: '0.0.1-alpha.1' },
})

test('candidate archive requires current native package, successful smoke and distribution evidence', () => {
  assert.doesNotThrow(() => validateCandidateEvidence(fixture()))
  const cases = [
    ['dirty checkout', value => { value.current.clean = false }, /clean/],
    ['stale package', value => { value.receipt.revision = 'old' }, /revision/],
    ['stale version', value => { value.receipt.version = '0.0.0' }, /version/],
    ['stale bundled version', value => { value.bundledManifest.version = '0.0.0' }, /version/],
    ['different runner', value => { value.receipt.platform = 'win32' }, /platform/],
    ['stale lock', value => { value.receipt.lockfileSHA256 = 'old' }, /lockfile/],
    ['missing smoke', value => { delete value.smoke }, /smoke/],
    ['failed smoke', value => { value.smoke.status = 'fail' }, /smoke/],
    ['stale smoke', value => { value.smoke.revision = 'old' }, /smoke/],
    ['missing bundle digest', value => { delete value.smoke.bundleSHA256 }, /bundle digest/],
    ['bundle edited after smoke', value => { value.current.bundleSHA256 = 'c'.repeat(64) }, /bundle digest/],
    ['missing native tool smoke', value => { delete value.smoke.nativeTools }, /native tools/],
    ['failed PTY smoke', value => { value.smoke.nativeTools.pty = false }, /native tools/],
    ['no relocation', value => { value.smoke.relocated = false }, /smoke/],
    ['one launch', value => { value.smoke.launches = 1 }, /smoke/],
    ['unclean shutdown', value => { value.smoke.cleanShutdown = false }, /smoke/],
    ['missing inventory', value => { delete value.inventory }, /inventory/],
    ['material blocker', value => { value.inventory.blockers.push({ reason: 'missing source' }) }, /blocker/],
    ['stale inventory', value => { value.inventory.lockfileSHA256 = 'old' }, /inventory/],
    ['missing native coverage', value => { value.inventory.packages = [] }, /native/],
    ['missing source list', value => { value.inventory.packages[0].nativeMaterials = [] }, /native/],
    ['missing notice', value => { value.inventory.packages[0].notices = [] }, /notice/],
    ['missing replacement', value => { delete value.replacement }, /replacement/],
    ['foreign replacement', value => { value.replacement.arch = 'x64' }, /replacement/],
    ['stale replacement', value => { value.replacement.replacements[0].before = 'old' }, /replacement/],
    ['unchanged bytes', value => { value.replacement.replacements[0].after = digest }, /replacement/],
    ['missing replacement library', value => { value.replacement.replacements = [] }, /replacement/],
    ['wrong libvips', value => { value.replacement.result.version.semver = '0.0.0' }, /replacement/],
    ['global libvips', value => { value.replacement.result.version.isGlobal = true }, /replacement/],
    ['WASM libvips', value => { value.replacement.result.version.isWasm = true }, /replacement/],
    ['invalid version shape', value => { value.replacement.result.version = '8.18.6' }, /replacement/],
  ]
  for (const [label, mutate, pattern] of cases) {
    const value = fixture()
    mutate(value)
    assert.throws(() => validateCandidateEvidence(value), pattern, label)
  }
})

test('failed candidate rerun clears earlier completion records before reading evidence', { skip: !['darwin-arm64', 'win32-x64'].includes(`${process.platform}-${process.arch}`) }, async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-candidate-stale-'))
  try {
    fs.writeFileSync(path.join(temporary, 'package.json'), JSON.stringify({ version: '0.0.1-alpha.1' }))
    const output = path.join(temporary, 'artifacts/release')
    fs.mkdirSync(output, { recursive: true })
    const stem = `DSH-Work-0.0.1-alpha.1-${process.platform}-${process.arch}`
    const outputs = ['receipt.json', 'sha256', process.platform === 'darwin' ? 'tar.gz' : 'zip'].map(extension => path.join(output, `${stem}.${extension}`))
    outputs.push(path.join(output, `${stem}-sources.tar.gz`))
    for (const file of outputs) fs.writeFileSync(file, 'old candidate')
    await assert.rejects(archiveDesktop({ projectRoot: temporary }), /receipt.json/)
    for (const file of outputs) assert.equal(fs.existsSync(file), false, 'failed evidence must invalidate prior candidate outputs')
  } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
})

test('bundle digest survives relocation and detects byte, path, executable and symlink changes', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bundle-digest-'))
  try {
    const original = path.join(temporary, 'original')
    fs.mkdirSync(original)
    fs.writeFileSync(path.join(original, 'app.js'), 'initial bytes', { mode: 0o644 })
    fs.writeFileSync(path.join(original, '.notice'), 'hidden file')
    fs.mkdirSync(path.join(original, 'empty'))
    if (process.platform !== 'win32') fs.symlinkSync('app.js', path.join(original, 'link'))
    const baseline = await bundleSHA256(original)
    const copy = path.join(temporary, 'relocated')
    fs.cpSync(original, copy, { recursive: true, verbatimSymlinks: true })
    assert.equal(await bundleSHA256(copy), baseline)
    fs.writeFileSync(path.join(copy, 'app.js'), 'changed bytes')
    assert.notEqual(await bundleSHA256(copy), baseline)
    fs.writeFileSync(path.join(copy, 'app.js'), 'initial bytes')
    fs.renameSync(path.join(copy, '.notice'), path.join(copy, '.renamed-notice'))
    assert.notEqual(await bundleSHA256(copy), baseline)
    fs.renameSync(path.join(copy, '.renamed-notice'), path.join(copy, '.notice'))
    if (process.platform !== 'win32') {
      fs.chmodSync(path.join(copy, 'app.js'), 0o755)
      assert.notEqual(await bundleSHA256(copy), baseline)
      fs.chmodSync(path.join(copy, 'app.js'), 0o644)
      fs.rmSync(path.join(copy, 'link'))
      fs.symlinkSync('.notice', path.join(copy, 'link'))
      assert.notEqual(await bundleSHA256(copy), baseline)
    }
  } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
})

test('archive verifies materials and dependency inventory inside the shipped bundle', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-candidate-materials-'))
  try {
    const application = path.join(temporary, 'resources/app')
    const resources = path.join(temporary, 'resources')
    const item = { name: '@img/sharp-libvips-darwin-arm64', version: '1.0.0', path: 'node_modules/@img/sharp-libvips-darwin-arm64', nativeComponents: { vips: '1.0.0' } }
    const write = (base, file, bytes) => {
      const target = path.join(base, file)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, bytes)
      return { file, sha256: createHash('sha256').update(bytes).digest('hex') }
    }
    const packageRoot = path.join(application, item.path)
    write(packageRoot, 'package.json', JSON.stringify({ name: item.name, version: item.version, license: 'MIT' }))
    const native = path.join(resources, 'third-party/native')
    const materials = ['source', 'license', 'build', 'relinking'].map(kind => ({ id: kind, kind, ...write(native, `${kind}.txt`, `${kind} content`) }))
    const binaries = [write(packageRoot, 'lib/native.dylib', 'native library')]
    const record = { nativeComponents: item.nativeComponents, binaries, materials: materials.map(value => value.id), componentSources: { vips: 'source' } }
    const materialLock = { materials, packages: { [`${item.name}@${item.version}`]: record } }
    const materialLockPath = path.join(temporary, 'native-materials.json')
    fs.writeFileSync(materialLockPath, JSON.stringify(materialLock))
    write(native, 'materials.json', JSON.stringify(materialLock))
    for (const file of ['LICENSE.dsh-work.txt', 'runtime/node/LICENSE', 'third-party/electron-LICENSE', 'third-party/electron-LICENSES.chromium.html']) write(resources, file, 'license')
    item.notices = [write(path.join(resources, 'third-party'), 'texts/license.txt', 'notice')]
    item.nativeMaterials = materials.map(({ id, kind, file, sha256 }) => ({ id, file: `native/${file}`, sha256, kind }))
    item.nativeBinaries = binaries
    const inventory = { packages: [item] }
    const verify = () => verifyBundledDistribution({ application, resources, inventory, materialLock, materialLockPath })
    assert.doesNotThrow(verify)
    write(native, 'source.txt', 'tampered')
    assert.throws(verify, /material digest mismatch/)
    fs.rmSync(path.join(native, 'source.txt'))
    assert.throws(verify, /missing material/)
    write(native, 'source.txt', 'source content')
    write(packageRoot, 'lib/native.dylib', 'tampered')
    assert.throws(verify, /binary digest mismatch/)
    write(packageRoot, 'lib/native.dylib', 'native library')
    write(path.join(resources, 'third-party'), 'texts/license.txt', 'tampered')
    assert.throws(verify, /notice digest mismatch/)
    write(path.join(resources, 'third-party'), 'texts/license.txt', 'notice')
    write(path.join(application, 'node_modules/unlisted'), 'package.json', JSON.stringify({ name: 'unlisted', version: '1.0.0', license: 'MIT' }))
    assert.throws(verify, /actual dependencies/)
    fs.rmSync(path.join(application, 'node_modules/unlisted'), { recursive: true })
    const sources = path.join(temporary, 'sources')
    const descriptor = stageSourceCompanion({ resources, output: sources, version: '0.0.1-alpha.1', platform: process.platform, arch: process.arch })
    const paired = () => withSourceCompanion(path.join(resources, 'third-party'), path.join(sources, descriptor.file), nativeRoot =>
      verifyBundledDistribution({ application, resources, inventory, materialLock, materialLockPath, nativeRoot }))
    assert.doesNotThrow(paired)
    assert.throws(verify, /missing material/)
    write(native, 'license.txt', 'tampered bundled license')
    assert.throws(paired, /bundled native notice/)
    write(native, 'license.txt', 'license content')
    write(packageRoot, 'lib/native.dylib', 'changed after source split')
    assert.throws(paired, /binary digest/)

  } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
})

test('native archive retains the complete folder and macOS symlink/executable metadata', { skip: !['darwin', 'win32'].includes(process.platform) }, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-candidate-archive-'))
  try {
    const bundle = path.join(temporary, 'DSH Work-native')
    fs.mkdirSync(path.join(bundle, 'resources'), { recursive: true })
    fs.writeFileSync(path.join(bundle, 'resources', '.hidden-notice'), 'retained')
    fs.writeFileSync(path.join(bundle, 'launch'), 'executable', { mode: 0o755 })
    if (process.platform === 'darwin') fs.symlinkSync('launch', path.join(bundle, 'launch-link'))
    const archive = path.join(temporary, process.platform === 'darwin' ? 'candidate.tar.gz' : 'candidate.zip')
    writeCandidateArchive(bundle, archive, process.platform)
    const restored = path.join(temporary, 'restored')
    fs.mkdirSync(restored)
    execFileSync('tar', ['-xf', archive, '-C', restored])
    const result = path.join(restored, path.basename(bundle))
    assert.equal(fs.readFileSync(path.join(result, 'resources', '.hidden-notice'), 'utf8'), 'retained')
    assert.equal(fs.readFileSync(path.join(result, 'launch'), 'utf8'), 'executable')
    if (process.platform === 'darwin') {
      assert.equal(fs.readlinkSync(path.join(result, 'launch-link')), 'launch')
      assert.equal(fs.statSync(path.join(result, 'launch')).mode & 0o777, 0o755)
    }
  } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
})
