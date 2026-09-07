import assert from 'node:assert/strict'
import test from 'node:test'

import { hasActiveAgent, inject } from '../packages/lifecycle-bundle/index.ts'

test('lifecycle activity follows running Agent state only', () => {
  assert.equal(hasActiveAgent([]), false)
  assert.equal(hasActiveAgent([{ status: 'idle' }, { status: 'running' }]), true)
  assert.equal(hasActiveAgent([{ status: 'idle' }, {}]), false)
  assert.deepEqual(inject, ['appReady', 'appExit', 'connection', 'webServer', 'agents'])
})
