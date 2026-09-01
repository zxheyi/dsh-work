import assert from 'node:assert/strict'
import test from 'node:test'

import type { RuntimeStatus } from '../apps/desktop/contracts.ts'

test('Node executes erasable TypeScript while tsc owns runtime emission', () => {
  const status = {
    state: 'stopped',
    code: null,
    canStart: true,
    canStop: false,
    canRecover: false,
  } satisfies RuntimeStatus

  assert.equal(status.state, 'stopped')
})
