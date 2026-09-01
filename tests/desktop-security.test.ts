import assert from 'node:assert/strict'
import test from 'node:test'
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { bindStatusBridge, resourceForRequest, STATUS_URL, type StatusHost } from '../apps/desktop/security.ts'
import type { GuardianSnapshot } from '../packages/runtime-guardian/protocol.ts'

test('status bridge admits only the exact local main frame and zero-argument methods', async () => {
  type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  const handlers = new Map<string, Handler>()
  const calls: string[] = []
  const mainFrame = { url: STATUS_URL }
  const contents = { mainFrame, getURL: () => STATUS_URL, send: () => {}, isDestroyed: () => false }
  const window = { webContents: contents, isDestroyed: () => false }
  const ipcMain = {
    handle: (name: string, handler: Handler): void => { handlers.set(name, handler) },
    removeHandler: (name: string): void => { handlers.delete(name) },
  }
  const value: GuardianSnapshot = {
    state: 'stopped', code: null, canStart: true, canStop: false, canRecover: false,
  }
  const command = (name: string): GuardianSnapshot => { calls.push(name); return value }
  const host: StatusHost = {
    start: () => command('start'),
    stop: () => command('stop'),
    recover: () => command('recover'),
    snapshot: () => command('snapshot'),
    subscribe: () => () => {},
  }
  const dispose = bindStatusBridge({
    ipcMain: ipcMain as unknown as IpcMain,
    window: window as unknown as BrowserWindow,
    host,
  })
  const event = { sender: contents, senderFrame: mainFrame }
  const invoke = async (channel: string, candidate: unknown, ...args: unknown[]): Promise<unknown> => {
    const handler = handlers.get(channel)
    assert.ok(handler)
    return handler(candidate as IpcMainInvokeEvent, ...args)
  }
  assert.deepEqual(await invoke('dsh-work:start', event), value)
  assert.deepEqual(await invoke('dsh-work:recover', event), value)
  for (const invalid of [
    { ...event, sender: {} }, { ...event, senderFrame: { url: STATUS_URL } },
    { ...event, senderFrame: null },
  ]) await assert.rejects(() => invoke('dsh-work:start', invalid), /denied/)
  await assert.rejects(() => invoke('dsh-work:start', event, 'secret'), /denied/)
  mainFrame.url = 'https://example.com/'
  await assert.rejects(() => invoke('dsh-work:start', event), /denied/)
  assert.deepEqual(calls, ['start', 'recover'])
  assert.deepEqual([...handlers.keys()].sort(), ['dsh-work:recover', 'dsh-work:snapshot', 'dsh-work:start', 'dsh-work:stop'])
  dispose(); assert.equal(handlers.size, 0)
})

test('custom protocol exposes only three fixed local assets, never arbitrary paths', () => {
  assert.equal(resourceForRequest(STATUS_URL, 'GET'), 'index.html')
  assert.equal(resourceForRequest('dsh-work://status/renderer.js', 'GET'), 'renderer.js')
  for (const url of ['file:///etc/passwd', 'dsh-work://other/index.html',
    'dsh-work://status/index.html?secret=1', 'dsh-work://status/../package.json',
    'dsh-work://user@status/index.html', 'dsh-work://status/%2e%2e/package.json']) {
    assert.equal(resourceForRequest(url, 'GET'), null)
  }
  assert.equal(resourceForRequest(STATUS_URL, 'POST'), null)
})
