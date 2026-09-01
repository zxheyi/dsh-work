import assert from 'node:assert/strict'
import test from 'node:test'
import { bindStatusBridge, resourceForRequest, STATUS_URL } from '../apps/desktop/security.ts'

test('status bridge admits only the exact local main frame and zero-argument methods', async () => {
  const handlers = new Map(), calls = []
  const mainFrame = { url: STATUS_URL }
  const contents = { mainFrame, getURL: () => STATUS_URL, send: () => {}, isDestroyed: () => false }
  const window = { webContents: contents, isDestroyed: () => false }
  const ipcMain = { handle: (name, fn) => handlers.set(name, fn), removeHandler: name => handlers.delete(name) }
  const value = { state: 'stopped', code: null, canStart: true, canStop: false }
  const host = Object.fromEntries(['start', 'stop', 'recover', 'snapshot'].map(method => [method, () => { calls.push(method); return value }]))
  host.subscribe = () => () => {}
  const dispose = bindStatusBridge({ ipcMain, window, host })
  const event = { sender: contents, senderFrame: mainFrame }
  assert.deepEqual(await handlers.get('dsh-work:start')(event), value)
  assert.deepEqual(await handlers.get('dsh-work:recover')(event), value)
  for (const invalid of [
    { ...event, sender: {} }, { ...event, senderFrame: { url: STATUS_URL } },
    { ...event, senderFrame: null },
  ]) await assert.rejects(async () => handlers.get('dsh-work:start')(invalid), /denied/)
  await assert.rejects(async () => handlers.get('dsh-work:start')(event, 'secret'), /denied/)
  mainFrame.url = 'https://example.com/'
  await assert.rejects(async () => handlers.get('dsh-work:start')(event), /denied/)
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
