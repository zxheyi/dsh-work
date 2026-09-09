import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { verifyNativeMaterials } from './native-distribution.mjs'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')

test('native release gate binds sources, notices, versions and actual library bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-native-notices-'))
  try {
    fs.writeFileSync(path.join(root, 'lib.dylib'), 'native bytes')
    fs.writeFileSync(path.join(root, 'source.tar.gz'), 'corresponding source')
    fs.writeFileSync(path.join(root, 'LICENSE.txt'), 'copyright and terms')
    const item = { name: '@img/sharp-libvips-darwin-arm64', version: '1.3.3', nativeComponents: { vips: '8.18.6' } }
    const record = { componentSources: { vips: 'vips-source' }, nativeComponents: { vips: '8.18.6' }, binaries: [{ file: 'lib.dylib', sha256: sha('native bytes') }],
      materials: [{ id: 'vips-source', kind: 'source', file: 'source.tar.gz', sha256: sha('corresponding source') }, { kind: 'license', file: 'LICENSE.txt', sha256: sha('copyright and terms') }, { kind: 'build', file: 'source.tar.gz', sha256: sha('corresponding source') }, { kind: 'relinking', file: 'LICENSE.txt', sha256: sha('copyright and terms') }] }
    assert.deepEqual(verifyNativeMaterials(item, record, root, root), [])
    fs.writeFileSync(path.join(root, 'crate-1.0+build.crate'), 'source with build metadata')
    assert.deepEqual(verifyNativeMaterials(item, { ...record, materials: [...record.materials, { kind: 'source', file: 'crate-1.0+build.crate', sha256: sha('source with build metadata') }] }, root, root), [])
    assert.match(verifyNativeMaterials(item, null, root, root).join(), /unreviewed/)
    assert.match(verifyNativeMaterials(item, { ...record, componentSources: {} }, root, root).join(), /missing corresponding source/)
    assert.match(verifyNativeMaterials(item, { ...record, materials: record.materials.filter(item => item.kind !== 'relinking') }, root, root).join(), /missing material category/)
    fs.writeFileSync(path.join(root, 'unexpected.dll'), 'unreviewed library')
    assert.match(verifyNativeMaterials(item, record, root, root).join(), /binary coverage/)
    fs.unlinkSync(path.join(root, 'unexpected.dll'))
    fs.writeFileSync(path.join(root, 'lib.dylib'), 'changed native bytes')
    assert.match(verifyNativeMaterials(item, record, root, root).join(), /binary digest/)
    fs.writeFileSync(path.join(root, 'lib.dylib'), 'native bytes')
    fs.unlinkSync(path.join(root, 'LICENSE.txt'))
    assert.match(verifyNativeMaterials(item, record, root, root).join(), /missing material/)
    fs.writeFileSync(path.join(root, 'LICENSE.txt'), 'changed license')
    assert.match(verifyNativeMaterials(item, record, root, root).join(), /material digest/)
    assert.match(verifyNativeMaterials({ ...item, nativeComponents: { vips: 'changed' } }, record, root, root).join(), /component versions/)
    assert.match(verifyNativeMaterials(item, { ...record, materials: [] }, root, root).join(), /empty/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})


test('locked native packages have complete source mappings and immutable material identities', () => {
  const repository = path.resolve(import.meta.dirname, '..')
  const lock = JSON.parse(fs.readFileSync(path.join(repository, 'third-party/native-materials.json')))
  const byId = new Map(lock.materials.map(item => [item.id, item]))
  assert.equal(byId.size, lock.materials.length)
  assert.equal(new Set(lock.materials.map(item => item.file)).size, lock.materials.length)
  for (const item of lock.materials) {
    assert.match(item.sha256, /^[a-f0-9]{64}$/u)
    assert.ok(item.bytes > 0)
    if (item.repositoryFile) assert.equal(sha(fs.readFileSync(path.join(repository, item.repositoryFile))), item.sha256)
    else assert.match(item.url, /^https:\/\//u)
  }
  for (const record of Object.values(lock.packages)) {
    for (const component of Object.keys(record.nativeComponents)) {
      assert.equal(byId.get(record.componentSources[component])?.kind, 'source')
      assert.ok(record.materials.includes(record.componentSources[component]))
    }
    for (const id of record.materials) assert.ok(byId.has(id))
    for (const kind of ['source', 'license', 'build', 'relinking']) assert.ok(record.materials.some(id => byId.get(id).kind === kind))
  }
})
