import assert from 'node:assert/strict'
import test from 'node:test'

import { presentStartup, type PresentationStatus } from '../apps/desktop/startup-presentation.ts'

const status = (
  state: PresentationStatus['state'],
  options: Partial<PresentationStatus> = {},
): PresentationStatus => ({
  state,
  code: null,
  canStart: false,
  canStop: false,
  canRecover: false,
  ...options,
})

test('startup presentation maps truthful runtime states to four user scenes', () => {
  assert.equal(presentStartup(status('stopped', { canStart: true }), true, false).scene, 'profile')
  assert.deepEqual(presentStartup(status('starting', { canStop: true }), false, false), {
    scene: 'preparing',
    title: '正在准备你的工作台',
    detail: '正在恢复最近的工作并连接本机服务。',
    diagnostic: null,
    retained: false,
    actions: { start: false, stop: true, recover: false, safeMode: false },
  })
  assert.equal(presentStartup(status('ready'), false, false).scene, 'preparing')
  assert.equal(presentStartup(status('stopping'), false, false).scene, 'preparing')
  assert.equal(presentStartup(status('failed'), false, false).scene, 'recovery')
  assert.equal(presentStartup(status('stopped', { canStart: true }), false, false).scene, 'stopped')
})

test('startup presentation keeps recovery actions and retained work explicit', () => {
  const value = presentStartup(status('failed', {
    code: 'recovery-required',
    canRecover: true,
  }), false, true)
  assert.equal(value.scene, 'recovery')
  assert.match(value.detail, /原有数据不会被自动删除/u)
  assert.equal(value.diagnostic, 'recovery-required')
  assert.equal(value.retained, true)
  assert.deepEqual(value.actions, {
    start: false,
    stop: false,
    recover: true,
    safeMode: true,
  })
})

test('startup presentation exposes ordinary retry without claiming safe recovery', () => {
  const value = presentStartup(status('failed', {
    code: 'runtime-unavailable',
    canStart: true,
  }), false, false)
  assert.equal(value.scene, 'recovery')
  assert.equal(value.actions.start, true)
  assert.equal(value.actions.recover, false)
  assert.equal(value.actions.safeMode, false)
  assert.match(value.detail, /安装完整/u)
})
