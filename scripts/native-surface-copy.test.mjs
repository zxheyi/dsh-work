import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectNativeSurfaceCopy } from '../tests/support/native-surface-copy.ts'

test('recognizes the native navigation chrome in Simplified Chinese', () => {
  assert.deepEqual(inspectNativeSurfaceCopy('DSH Work 新会话 工作区 设置'), {
    brand: true,
    newSession: true,
    workspace: true,
    settings: true,
  })
})

test('recognizes the native navigation chrome in English', () => {
  assert.deepEqual(inspectNativeSurfaceCopy('DSH Work New Session Workspaces Settings'), {
    brand: true,
    newSession: true,
    workspace: true,
    settings: true,
  })
})

test('does not accept product copy without the native navigation controls', () => {
  assert.deepEqual(inspectNativeSurfaceCopy('DSH Work recent projects'), {
    brand: true,
    newSession: false,
    workspace: false,
    settings: false,
  })
})
