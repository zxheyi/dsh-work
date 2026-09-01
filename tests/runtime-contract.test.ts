import assert from 'node:assert/strict'
import test from 'node:test'

import {
  RUNTIME_CODES,
  RUNTIME_COMMANDS,
  RUNTIME_HOST_CODES,
  RUNTIME_STATES,
  type RuntimeControl,
  type RuntimeSnapshot,
} from '../packages/runtime-contract/index.ts'

test('runtime contract is the single immutable lifecycle vocabulary', () => {
  assert.deepEqual(RUNTIME_STATES, ['stopped', 'starting', 'ready', 'stopping', 'failed'])
  assert.deepEqual(RUNTIME_COMMANDS, ['start', 'stop', 'recover', 'snapshot'])
  assert.deepEqual(RUNTIME_CODES, [
    ...RUNTIME_HOST_CODES,
    'recovery-required',
    'guardian-unavailable',
  ])
  assert.equal(Object.isFrozen(RUNTIME_STATES), true)
  assert.equal(Object.isFrozen(RUNTIME_COMMANDS), true)
  assert.equal(Object.isFrozen(RUNTIME_HOST_CODES), true)
  assert.equal(Object.isFrozen(RUNTIME_CODES), true)
  assert.equal(new Set(RUNTIME_CODES).size, RUNTIME_CODES.length)
})

test('runtime control keeps renderer-independent lifecycle semantics', async () => {
  const stopped: RuntimeSnapshot = Object.freeze({
    state: 'stopped', code: null, canStart: true, canStop: false, canRecover: false,
  })
  const control: RuntimeControl = {
    start: async () => stopped,
    stop: async () => stopped,
    recover: async () => stopped,
    snapshot: () => stopped,
    subscribe: () => () => {},
  }

  assert.equal(await control.start(), stopped)
  assert.equal(control.snapshot(), stopped)
})
