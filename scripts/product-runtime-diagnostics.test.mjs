import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { verifyProductRuntime } from './verify-product-runtime.mjs'

test('product provenance failures expose only a fixed diagnostic code', () => {
  const missing = path.resolve('test-owned-missing-upstream')
  assert.throws(
    () => verifyProductRuntime({ source: missing, tarball: missing, node: missing, nodeArchive: missing }),
    error => error?.message === 'Product runtime provenance check failed' &&
      error?.code === 'source-provenance-failed' &&
      !String(error).includes(missing),
  )
})
