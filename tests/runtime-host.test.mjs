import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { createRuntimeHost } from '../packages/runtime-host/index.mjs'

function fixture(options = {}) {
  const children = []
  const host = createRuntimeHost({ launch: () => {
    const child = new EventEmitter()
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => { child.killed = true; return true }
    children.push(child)
    return child
  }, startupMs: 50, stopMs: 30, reapMs: 20, ...options })
  return { host, children, message: (event, child = children.at(-1)) => child.emit('message', { protocol: 'dsh-work.lifecycle.v1', event }) }
}

test('one child reaches committed Ready, observes disposal and EOF close, and restarts', async () => {
  const { host, children, message } = fixture()
  const states = []
  const unsubscribe = host.subscribe(s => states.push(s.state))
  const first = host.start()
  const duplicate = host.start()
  assert.equal(children.length, 1)
  assert.equal(host.snapshot().state, 'starting')
  message('ready')
  assert.equal((await first).state, 'ready')
  await duplicate
  const stopping = host.stop()
  const duplicateStop = host.stop()
  assert.equal(children[0].stdin.writableEnded, true)
  message('disposed')
  children[0].emit('close', 0, null)
  assert.equal((await stopping).state, 'stopped')
  await duplicateStop
  const second = host.start()
  message('ready', children[0])
  assert.equal(host.snapshot().state, 'starting')
  message('ready')
  await second
  const end = host.stop()
  message('disposed')
  children[1].emit('close', 0, null)
  await end
  unsubscribe()
  assert.deepEqual(states, ['starting', 'ready', 'stopping', 'stopped', 'starting', 'ready', 'stopping', 'stopped'])
})

test('early stop ignores late Ready but cannot hide startup rejection', async () => {
  const { host, children, message } = fixture()
  const starting = host.start()
  const stopping = host.stop()
  message('ready')
  assert.equal(host.snapshot().state, 'stopping')
  message('disposed')
  children[0].emit('close', 1, null)
  assert.equal((await stopping).code, 'runtime-exit-failed')
  assert.equal((await starting).canStart, true)
})

test('unexpected exit zero is failure; missing disposal is not successful stop', async () => {
  const { host, children, message } = fixture()
  const first = host.start(); message('ready'); await first
  children[0].emit('close', 0, null)
  assert.equal(host.snapshot().code, 'unexpected-exit')
  const second = host.start(); message('ready'); await second
  const end = host.stop(); children[1].emit('close', 0, null); await end
  assert.equal(host.snapshot().code, 'disposal-unconfirmed')
})

test('forced stop remains failed and unreaped ownership blocks restart until close', async () => {
  const { host, children, message } = fixture()
  const first = host.start(); message('ready'); await first
  const result = await host.stop()
  assert.equal(children[0].killed, true)
  assert.equal(result.code, 'cleanup-unconfirmed')
  assert.equal(result.canStart, false)
  await host.start()
  assert.equal(children.length, 1)
  children[0].emit('close', null, 'SIGKILL')
  assert.equal(host.snapshot().code, 'forced-stop')
  assert.equal(host.snapshot().canStart, true)
})

test('startup deadline is bounded and failed even after a successful EOF exit', async () => {
  const { host, children, message } = fixture({ startupMs: 5 })
  const started = host.start()
  await new Promise(resolve => host.subscribe(s => s.state === 'stopping' && resolve()))
  message('disposed'); children[0].emit('close', 0, null)
  assert.equal((await started).code, 'startup-timeout')
})

test('missing runtime, process errors, disconnect, EPIPE and hostile messages stay safe', async () => {
  const missing = fixture({ launch: () => { throw Error('secret:/Users/private') } }).host
  assert.equal((await missing.start()).code, 'runtime-unavailable')
  for (const fault of ['error', 'disconnect', 'pipe', 'message', 'output']) {
    const { host, children, message } = fixture({ outputLimit: 16 })
    const snapshots = []
    host.subscribe(value => snapshots.push(value))
    const first = host.start(); message('ready'); await first
    const child = children[0]
    if (fault === 'pipe') child.stdin.emit('error', Error('secret'))
    else if (fault === 'message') child.emit('message', { protocol: 'dsh-work.lifecycle.v1', event: 'ready', token: 'secret' })
    else if (fault === 'output') child.stderr.write('secret token=secret too many bytes')
    else child.emit(fault, Error('secret'))
    message('disposed'); child.emit('close', 0, null)
    assert.equal(host.snapshot().state, 'failed', fault)
    assert.equal(JSON.stringify(snapshots).includes('secret'), false)
  }
})

test('presentation callbacks may stop synchronously without losing child ownership', async () => {
  const { host, children, message } = fixture()
  host.subscribe(value => { if (value.state === 'starting') void host.stop() })
  const started = host.start()
  assert.equal(children[0].stdin.writableEnded, true)
  message('disposed'); children[0].emit('close', 0, null)
  assert.equal((await started).state, 'stopped')
})

test('a terminal subscriber can retry without changing the previous command result', async () => {
  const { host, children, message } = fixture()
  const seen = []
  let next
  host.subscribe(value => { if (value.state === 'failed' && children.length === 1) next = host.start() })
  host.subscribe(value => seen.push(value.state))
  const first = host.start()
  children[0].emit('close', 1, null)
  assert.equal((await first).state, 'failed')
  assert.deepEqual(seen, ['starting', 'failed', 'starting'])
  message('ready'); await next
  const end = host.stop(); message('disposed'); children[1].emit('close', 0, null)
  assert.equal((await end).state, 'stopped')
})
