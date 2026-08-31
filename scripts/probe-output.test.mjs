import assert from 'node:assert/strict'
import test from 'node:test'
import { createOutputGuard } from '../prototypes/m0-runtime-upgrade/output-guard.mjs'

test('probe detects auth output even across chunks without retaining credential bytes', () => {
  const guard = createOutputGuard(1024)
  guard.observe(Buffer.from('ordinary log\nhttp://127.0.0.1:123/?to'))
  guard.observe(Buffer.from('ken=not-a-real-secret\n'))
  assert.deepEqual(guard.status(), { sensitive: true, overflow: false })
  assert.equal(JSON.stringify(guard.status()).includes('not-a-real-secret'), false)
})

test('probe bounds stream output and accepts ordinary lifecycle facts', () => {
  const guard = createOutputGuard(40)
  guard.observe(Buffer.from('dsh-work-probe:ready\n'))
  assert.deepEqual(guard.status(), { sensitive: false, overflow: false })
  guard.observe(Buffer.alloc(50, 97))
  assert.equal(guard.status().overflow, true)
})

test('interleaved stderr cannot hide a split stdout token', () => {
  const guard = createOutputGuard()
  guard.observe(Buffer.from('http://127.0.0.1/?to'), 'stdout')
  guard.observe(Buffer.from('stderr noise\n'), 'stderr')
  guard.observe(Buffer.from('ken=not-a-real-secret'), 'stdout')
  assert.equal(guard.status().sensitive, true)
})
