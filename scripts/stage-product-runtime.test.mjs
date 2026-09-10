import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { stageProductRuntime } from './stage-product-runtime.mjs'

test('stages only a verified Node tree into the packaged resource layout', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-runtime-stage-'))
  try {
    const extracted = path.join(root, 'node-v24.11.1-darwin-arm64')
    const node = path.join(extracted, 'bin/node')
    fs.mkdirSync(path.dirname(node), { recursive: true })
    fs.writeFileSync(node, 'verified node bytes', { mode: 0o755 })
    for (const file of ['include/node/node.h', 'share/man/node.1', 'lib/node_modules/npm/bin/npm-cli.js', 'LICENSE']) {
      fs.mkdirSync(path.dirname(path.join(extracted, file)), { recursive: true })
      fs.writeFileSync(path.join(extracted, file), file)
    }
    if (process.platform !== 'win32') fs.symlinkSync('../lib/node_modules/npm/bin/npm-cli.js', path.join(extracted, 'bin/npm'))
    const destination = path.join(root, 'resources')
    let verified = 0

    const manifest = stageProductRuntime({ node }, destination, () => {
      verified++
      return { runtime: '0.1.2-alpha.2', node: '24.11.1', nodeSHA256: 'archive-sha256' }
    })

    assert.equal(verified, 1)
    if (process.platform !== 'win32') assert.equal(fs.readlinkSync(path.join(destination, 'runtime/node/bin/npm')), '../lib/node_modules/npm/bin/npm-cli.js')
    assert.equal(fs.existsSync(path.join(destination, 'runtime/node/include')), false)
    assert.equal(fs.existsSync(path.join(destination, 'runtime/node/share')), false)
    assert.ok(fs.existsSync(path.join(destination, 'runtime/node/lib/node_modules/npm/bin/npm-cli.js')))
    assert.ok(fs.existsSync(path.join(destination, 'runtime/node/LICENSE')))
    assert.equal(fs.readFileSync(path.join(destination, 'runtime/node/bin/node'), 'utf8'), 'verified node bytes')
    assert.deepEqual(manifest, {
      schema: 'dsh-work.packaged-runtime.v1',
      runtime: '0.1.2-alpha.2',
      node: '24.11.1',
      nodeArchiveSHA256: 'archive-sha256',
    })
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(destination, 'runtime/manifest.json'), 'utf8')), manifest)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
test('does not create packaged resources when provenance verification fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-runtime-stage-failure-'))
  try {
    const node = path.join(root, 'node-v24.11.1-darwin-arm64/bin/node')
    fs.mkdirSync(path.dirname(node), { recursive: true })
    fs.writeFileSync(node, 'unverified')
    const destination = path.join(root, 'resources')
    assert.throws(() => stageProductRuntime({ node }, destination, () => {
      throw new Error('provenance failed')
    }), /provenance failed/)
    assert.equal(fs.existsSync(destination), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
