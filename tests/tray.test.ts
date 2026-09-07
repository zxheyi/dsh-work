import assert from 'node:assert/strict'
import test from 'node:test'

import { createDesktopTray, type TrayMenuEntry } from '../apps/desktop/tray.ts'
import type { RuntimeSnapshot } from '../packages/runtime-contract/index.ts'

test('tray exposes show, stop, safe mode and explicit quit through bounded Host actions', async () => {
  let status: RuntimeSnapshot = {
    state: 'ready', code: null, canStart: false, canStop: true, canRecover: false,
  }
  let active = true
  let statusListener: (value: RuntimeSnapshot) => void = () => {}
  let activityListener: (value: boolean) => void = () => {}
  let entries: readonly TrayMenuEntry[] = []
  const calls: string[] = []
  const tooltips: string[] = []
  let trayClick = () => {}
  const result = async (name: string): Promise<RuntimeSnapshot> => { calls.push(name); return status }
  const controller = createDesktopTray({
    tray: {
      setToolTip: value => tooltips.push(value),
      setContextMenu: menu => { entries = menu as readonly TrayMenuEntry[] },
      on: (_event, listener) => { trayClick = listener },
      destroy: () => { calls.push('destroy') },
    },
    window: { isDestroyed: () => false, show: () => calls.push('show'), focus: () => calls.push('focus') },
    host: {
      snapshot: () => status, active: () => active,
      start: () => result('start'), stop: () => result('stop'), safeMode: () => result('safe'),
      subscribe: listener => { statusListener = listener; return () => calls.push('unsubscribe-status') },
      subscribeActivity: listener => { activityListener = listener; return () => calls.push('unsubscribe-activity') },
    },
    buildMenu: value => value,
    quit: () => calls.push('quit'),
  })
  assert.equal(tooltips.at(-1), 'DSH Work · 正在工作')
  trayClick()
  entries.find(item => item.label === '停止工作台')?.click?.()
  assert.equal(entries.find(item => item.label === '使用安全模式')?.enabled, false)

  status = { state: 'failed', code: 'recovery-required', canStart: false, canStop: false, canRecover: true }
  active = false
  statusListener(status); activityListener(active)
  entries.find(item => item.label === '使用安全模式')?.click?.()
  entries.find(item => item.label === '退出 DSH Work')?.click?.()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls.slice(0, 6), ['show', 'focus', 'stop', 'safe', 'quit'])
  assert.equal(tooltips.at(-1), 'DSH Work')
  controller.dispose()
  assert.deepEqual(calls.slice(-3), ['unsubscribe-status', 'unsubscribe-activity', 'destroy'])
})
