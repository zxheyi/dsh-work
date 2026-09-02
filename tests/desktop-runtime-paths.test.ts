import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { resolveDesktopNodePath } from '../apps/desktop/runtime-paths.ts'

test('packaged desktop uses only its owned Node runtime and ignores development overrides', () => {
  const resourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-packaged-runtime-'))
  try {
    const node = path.join(resourcesPath, 'runtime/node/bin/node')
    fs.mkdirSync(path.dirname(node), { recursive: true })
    fs.writeFileSync(node, 'packaged node')

    assert.equal(resolveDesktopNodePath({
      isPackaged: true,
      resourcesPath,
      platform: 'darwin',
      environment: { DSH_WORK_NODE: '/usr/local/bin/node' },
    }), node)
  } finally {
    fs.rmSync(resourcesPath, { recursive: true, force: true })
  }
})

test('packaged desktop rejects a missing or linked Node runtime', () => {
  const resourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-invalid-runtime-'))
  const outside = path.join(resourcesPath, 'outside-node')
  try {
    assert.throws(() => resolveDesktopNodePath({
      isPackaged: true,
      resourcesPath,
      platform: 'darwin',
      environment: {},
    }), /packaged runtime unavailable/)

    fs.writeFileSync(outside, 'outside')
    const node = path.join(resourcesPath, 'runtime/node/bin/node')
    fs.mkdirSync(path.dirname(node), { recursive: true })
    fs.symlinkSync(outside, node)
    assert.throws(() => resolveDesktopNodePath({
      isPackaged: true,
      resourcesPath,
      platform: 'darwin',
      environment: {},
    }), /packaged runtime unavailable/)
  } finally {
    fs.rmSync(resourcesPath, { recursive: true, force: true })
  }
})

test('development desktop requires an explicit absolute Node path', () => {
  assert.equal(resolveDesktopNodePath({
    isPackaged: false,
    resourcesPath: '/unused',
    platform: 'linux',
    environment: { DSH_WORK_NODE: process.execPath },
  }), process.execPath)
  assert.throws(() => resolveDesktopNodePath({
    isPackaged: false,
    resourcesPath: '/unused',
    platform: 'linux',
    environment: { DSH_WORK_NODE: 'node' },
  }), /development runtime unavailable/)
})
