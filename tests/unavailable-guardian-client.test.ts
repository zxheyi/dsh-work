import assert from 'node:assert/strict'
import test from 'node:test'

import { createUnavailableGuardianClient } from '../packages/runtime-guardian/unavailable-client.ts'

test('unavailable guardian is a bounded Runtime Control adapter', async () => {
  const client = createUnavailableGuardianClient()
  const observed: string[] = []
  const unsubscribe = client.subscribe(value => observed.push(`${value.state}:${value.code}`))

  assert.deepEqual(client.snapshot(), {
    state: 'stopped', code: null, canStart: true, canStop: false, canRecover: false,
  })
  assert.deepEqual(await client.start(), {
    state: 'failed', code: 'runtime-unavailable', canStart: true, canStop: false, canRecover: false,
  })
  assert.deepEqual(await client.stop(), client.snapshot())
  assert.deepEqual(await client.recover(), client.snapshot())
  assert.deepEqual(observed, ['failed:runtime-unavailable'])
  assert.equal(await client.dispose(), true)
  assert.equal(Object.isFrozen(client), true)

  unsubscribe()
})
