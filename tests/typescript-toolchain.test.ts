import assert from 'node:assert/strict'
import fs from 'node:fs'
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

test('product build emits JavaScript entries and required desktop assets', () => {
  for (const relativePath of [
    '../dist/apps/desktop/main.js',
    '../dist/apps/desktop/preload.cjs',
    '../dist/apps/desktop/renderer.js',
    '../dist/apps/desktop/index.html',
    '../dist/apps/desktop/style.css',
    '../dist/packages/lifecycle-bundle/index.js',
    '../dist/packages/lifecycle-bundle/package.json',
  ]) {
    assert.equal(fs.existsSync(new URL(relativePath, import.meta.url)), true, relativePath)
  }
  assert.equal(fs.existsSync(new URL('../dist/packages/lifecycle-bundle/index.ts', import.meta.url)), false)
})
