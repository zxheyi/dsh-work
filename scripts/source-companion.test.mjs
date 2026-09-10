import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { stageSourceCompanion, withSourceCompanion } from './source-companion.mjs'

test('source delivery pairs the application with a hash-bound archive and retains local notices', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-source-pair-'))
  try {
    const resources = path.join(root, 'resources')
    const native = path.join(resources, 'third-party/native')
    fs.mkdirSync(native, { recursive: true })
    const materials = [{ file: 'source.tar.gz', kind: 'source' }, { file: 'LICENSE', kind: 'license' }, { file: 'REBUILDING.md', kind: 'relinking' }]
    for (const item of materials) fs.writeFileSync(path.join(native, item.file), item.kind)
    const lockPath = path.join(native, 'materials.json')
    fs.writeFileSync(lockPath, JSON.stringify({ materials }))
    const output = path.join(root, 'sources')
    const descriptor = stageSourceCompanion({ resources, output, version: '0.0.1-alpha.1', platform: process.platform === 'win32' ? 'win32' : 'darwin', arch: process.platform === 'win32' ? 'x64' : 'arm64' })
    const archive = path.join(output, descriptor.file)
    assert.equal(fs.existsSync(path.join(native, 'source.tar.gz')), false)
    assert.equal(fs.readFileSync(path.join(native, 'LICENSE'), 'utf8'), 'license')
    assert.equal(fs.readFileSync(path.join(native, 'REBUILDING.md'), 'utf8'), 'relinking')
    const verify = () => withSourceCompanion(path.join(resources, 'third-party'), archive, nativeRoot => {
      assert.equal(fs.readFileSync(path.join(nativeRoot, 'source.tar.gz'), 'utf8'), 'source')
      assert.equal(fs.readFileSync(path.join(nativeRoot, 'LICENSE'), 'utf8'), 'license')
    })
    assert.doesNotThrow(verify)
    const original = fs.readFileSync(archive)
    fs.appendFileSync(archive, 'tampered')
    assert.throws(verify, /source archive/)
    fs.writeFileSync(archive, original)
    fs.writeFileSync(lockPath, 'changed lock')
    assert.throws(verify, /material lock/)
    fs.rmSync(archive)
    assert.throws(verify, /ENOENT|source archive/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
