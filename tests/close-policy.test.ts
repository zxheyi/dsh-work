import assert from 'node:assert/strict'
import test from 'node:test'

import { windowCloseAction } from '../apps/desktop/close-policy.ts'

test('window close hides only while an Agent is active', () => {
  assert.equal(windowCloseAction(false, true), 'hide')
  assert.equal(windowCloseAction(false, false), 'quit')
  assert.equal(windowCloseAction(true, true), 'quit')
})
