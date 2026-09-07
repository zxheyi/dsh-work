import assert from 'node:assert/strict'
import test from 'node:test'
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import {
  bindStatusBridge,
  isAllowedDesktopNavigation,
  resourceForRequest,
  STATUS_CONTENT_SECURITY_POLICY,
  STATUS_URL,
  type StatusHost,
} from '../apps/desktop/security.ts'
import type { RuntimeSnapshot } from '../packages/runtime-contract/index.ts'

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
  const value: RuntimeSnapshot = {
    state: 'stopped', code: null, canStart: true, canStop: false, canRecover: false,
  }
  const command = async (name: string): Promise<RuntimeSnapshot> => { calls.push(name); return value }
  const host: StatusHost = {
    start: () => command('start'),
    stop: () => command('stop'),
    recover: () => command('recover'),
    safeMode: () => command('safeMode'),
    snapshot: () => value,
    subscribe: () => () => {},
  }
  const dispose = bindStatusBridge({
    ipcMain: ipcMain as unknown as IpcMain,
    window: window as unknown as BrowserWindow,
    host,
    startup: {
      snapshot: () => ({ choiceRequired: false, homeLabel: '~/.dsh', profiles: [], rejectedCount: 0, selected: 'isolated' }),
      select: async () => value,
    },
  })
  const event = { sender: contents, senderFrame: mainFrame }
  const invoke = async (channel: string, candidate: unknown, ...args: unknown[]): Promise<unknown> => {
    const handler = handlers.get(channel)
    assert.ok(handler)
    return handler(candidate as IpcMainInvokeEvent, ...args)
  }
  assert.deepEqual(await invoke('dsh-work:start', event), value)
  assert.deepEqual(await invoke('dsh-work:recover', event), value)
  assert.equal((await invoke('dsh-work:startup', event) as { selected: string }).selected, 'isolated')
  assert.deepEqual(await invoke('dsh-work:select-profile', event, null), value)
  await assert.rejects(() => invoke('dsh-work:select-profile', event, '../web'), /denied/)
  for (const invalid of [
    { ...event, sender: {} }, { ...event, senderFrame: { url: STATUS_URL } },
    { ...event, senderFrame: null },
  ]) await assert.rejects(() => invoke('dsh-work:start', invalid), /denied/)
  await assert.rejects(() => invoke('dsh-work:start', event, 'secret'), /denied/)
  mainFrame.url = 'https://example.com/'
  await assert.rejects(() => invoke('dsh-work:start', event), /denied/)
  assert.deepEqual(calls, ['start', 'recover'])
  assert.deepEqual([...handlers.keys()].sort(), ['dsh-work:recover', 'dsh-work:safeMode', 'dsh-work:select-profile', 'dsh-work:snapshot', 'dsh-work:start', 'dsh-work:startup', 'dsh-work:stop'])
  dispose(); assert.equal(handlers.size, 0)
})

test('custom protocol exposes only fixed local assets, never arbitrary paths', () => {
  assert.equal(resourceForRequest(STATUS_URL, 'GET'), 'index.html')
  assert.equal(resourceForRequest('dsh-work://status/renderer.js', 'GET'), 'renderer.js')
  assert.equal(resourceForRequest('dsh-work://status/deepseek-whale.svg', 'GET'), 'deepseek-whale.svg')
  for (const url of ['file:///etc/passwd', 'dsh-work://other/index.html',
    'dsh-work://status/index.html?secret=1', 'dsh-work://status/../package.json',
    'dsh-work://user@status/index.html', 'dsh-work://status/%2e%2e/package.json']) {
    assert.equal(resourceForRequest(url, 'GET'), null)
  }
  assert.equal(resourceForRequest(STATUS_URL, 'POST'), null)
  assert.match(STATUS_CONTENT_SECURITY_POLICY, /img-src 'self'/u)
  assert.doesNotMatch(STATUS_CONTENT_SECURITY_POLICY, /https?:|data:/u)
})

test('desktop navigation admits only the private shell and one exact loopback surface origin', () => {
  const surfaceOrigin = 'http://127.0.0.1:43127'
  assert.equal(isAllowedDesktopNavigation(STATUS_URL, surfaceOrigin), true)
  assert.equal(isAllowedDesktopNavigation(`${surfaceOrigin}/`, surfaceOrigin), true)
  assert.equal(isAllowedDesktopNavigation(`${surfaceOrigin}/work/current`, surfaceOrigin), true)
  for (const url of [
    'http://127.0.0.1:43128/',
    'http://localhost:43127/',
    'https://127.0.0.1:43127/',
    'https://example.com/',
    'file:///tmp/work.html',
    'dsh-work://status/index.html?surface=private',
  ]) assert.equal(isAllowedDesktopNavigation(url, surfaceOrigin), false, url)
  assert.equal(isAllowedDesktopNavigation(`${surfaceOrigin}/`, null), false)
})
