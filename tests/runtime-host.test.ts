import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { createRuntimeHost } from '../packages/runtime-host/index.ts'
import type {
  RuntimeChild,
  RuntimeHostOptions,
  RuntimeHostSnapshot,
  RuntimeHostState,
} from '../packages/runtime-host/index.ts'

interface FixtureChild extends RuntimeChild {
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
  killRequested?: boolean
}

interface FixtureChildren extends Array<FixtureChild> {
  0: FixtureChild
  1: FixtureChild
}

function fixture(options: Partial<RuntimeHostOptions> = {}) {
  const children = [] as unknown as FixtureChildren
  const host = createRuntimeHost({ launch: () => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    }) as unknown as FixtureChild
    child.kill = () => { child.killRequested = true; return true }
    children.push(child)
    return child
  }, startupMs: 50, stopMs: 30, reapMs: 20, ...options })
  return { host, children, message: (event: 'ready' | 'disposed', child = children.at(-1)) => {
    if (!child) throw new Error('fixture child unavailable')
    child.emit('message', { protocol: 'dsh-work.lifecycle.v1', event })
  } }
}

test('one child reaches committed Ready, observes disposal and EOF close, and restarts', async () => {
  const { host, children, message } = fixture()
  const states: RuntimeHostState[] = []
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

test('early EOF preserves startup allowance for a later native rejection', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { host, children } = fixture({ startupMs: 300, stopMs: 80 })
  const starting = host.start()
  const stopping = host.stop()
  t.mock.timers.tick(81)
  assert.equal(children[0].killRequested, undefined)
  children[0].emit('close', 1, null)
  assert.equal((await stopping).code, 'runtime-exit-failed')
  assert.equal((await starting).code, 'runtime-exit-failed')
})

test('late Ready starts one stop budget without publishing ready or extending it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { host, children, message } = fixture({ startupMs: 300, stopMs: 80 })
  const states: RuntimeHostState[] = []
  host.subscribe(value => states.push(value.state))
  const starting = host.start()
  const stopping = host.stop()
  t.mock.timers.tick(81)
  assert.equal(children[0].killRequested, undefined)
  message('ready')
  t.mock.timers.tick(79)
  assert.equal(children[0].killRequested, undefined)
  const duplicate = host.stop()
  t.mock.timers.tick(1)
  assert.equal(children[0].killRequested, true)
  children[0].emit('close', null, 'SIGKILL')
  assert.equal((await stopping).code, 'forced-stop')
  assert.deepEqual(await duplicate, await starting)
  assert.deepEqual(states, ['starting', 'stopping', 'failed'])
})

test('early stop near the original startup deadline cannot reset or discard it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { host, children } = fixture({ startupMs: 100, stopMs: 30 })
  const starting = host.start()
  t.mock.timers.tick(90)
  const stopping = host.stop()
  t.mock.timers.tick(10) // Original startup deadline; now bounded failure cleanup.
  t.mock.timers.tick(29)
  const duplicate = host.stop()
  assert.equal(children[0].killRequested, undefined)
  t.mock.timers.tick(1)
  assert.equal(children[0].killRequested, true)
  t.mock.timers.tick(20)
  assert.equal((await stopping).code, 'cleanup-unconfirmed')
  assert.equal((await starting).canStart, false)
  assert.equal((await duplicate).canStart, false)
  await host.start()
  assert.equal(children.length, 1)
  children[0].emit('close', null, 'SIGKILL')
  assert.equal(host.snapshot().code, 'forced-stop')
  assert.equal(host.snapshot().canStart, true)
})

test('startup timeout wins before a later Ready even when already stopping', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { host, children, message } = fixture({ startupMs: 100, stopMs: 30 })
  const starting = host.start()
  const stopping = host.stop()
  t.mock.timers.tick(100)
  message('ready')
  message('disposed')
  children[0].emit('close', 0, null)
  assert.equal((await stopping).code, 'startup-timeout')
  assert.equal((await starting).code, 'startup-timeout')
})

test('explicit startup faults keep bounded cleanup before and after an early stop', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const earlyStop of [false, true]) {
    for (const fault of ['error', 'message', 'output', 'pipe', 'disconnect']) {
      const { host, children } = fixture({ startupMs: 300, stopMs: 30, outputLimit: 4 })
      const starting = host.start()
      if (earlyStop) void host.stop()
      const child = children[0]
      if (fault === 'output') child.stderr.write('private')
      else if (fault === 'message') child.emit('message', { secret: 'private' })
      else if (fault === 'pipe') child.stdin.emit('error', Error('private'))
      else if (fault === 'disconnect') child.emit('disconnect')
      else child.emit('error', Error('private'))
      t.mock.timers.tick(30)
      assert.equal(child.killRequested, true, `${earlyStop}/${fault}`)
      child.emit('close', null, 'SIGKILL')
      assert.equal((await starting).code, 'forced-stop')
    }
  }
})

test('control-channel closure during early stop preserves the native exit classification', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const fault of ['pipe', 'disconnect']) {
    const { host, children, message } = fixture({ startupMs: 300, stopMs: 30 })
    const starting = host.start()
    const stopping = host.stop()
    if (fault === 'pipe') children[0].stdin.emit('error', Error('private'))
    else children[0].emit('disconnect')
    t.mock.timers.tick(20)
    if (fault === 'pipe') children[0].stdin.emit('error', Error('private'))
    else children[0].emit('disconnect')
    message('disposed')
    children[0].emit('close', 1, null)
    assert.equal((await starting).code, 'runtime-exit-failed')
    assert.equal((await stopping).code, 'runtime-exit-failed')
  }
})

test('repeated channel closure and late Ready cannot extend failure cleanup', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { host, children, message } = fixture({ startupMs: 300, stopMs: 30 })
  const starting = host.start()
  const stopping = host.stop()
  children[0].emit('disconnect')
  t.mock.timers.tick(20)
  children[0].stdin.emit('error', Error('private'))
  message('ready')
  t.mock.timers.tick(9)
  assert.equal(children[0].killRequested, undefined)
  t.mock.timers.tick(1)
  assert.equal(children[0].killRequested, true)
  children[0].emit('close', null, 'SIGKILL')
  assert.equal((await starting).code, 'forced-stop')
  assert.equal((await stopping).code, 'forced-stop')
})

test('an early EOF write failure starts bounded stop cleanup immediately', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { host, children } = fixture({ startupMs: 300, stopMs: 30 })
  const starting = host.start()
  children[0].stdin.end = () => { throw Error('private path') }
  const stopping = host.stop()
  t.mock.timers.tick(30)
  assert.equal(children[0].killRequested, true)
  children[0].emit('close', null, 'SIGKILL')
  assert.equal((await starting).code, 'forced-stop')
  assert.equal((await stopping).code, 'forced-stop')
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

test('observed exit forbids later signals and retains ownership until stdio closes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { host, children, message } = fixture({ startupMs: 100, stopMs: 30, reapMs: 20 })
  const started = host.start(); message('ready'); await started
  const child = children[0]
  child.emit('exit', 1, null)
  const stopped = host.stop()
  t.mock.timers.tick(30)
  assert.equal(child.killRequested, undefined)
  assert.equal((await stopped).code, 'cleanup-unconfirmed')
  assert.equal(host.snapshot().canStart, false)
  await host.start()
  assert.equal(children.length, 1)
  child.emit('close', 1, null)
  assert.equal(host.snapshot().code, 'unexpected-exit')
  assert.equal(host.snapshot().canStart, true)
})

test('exit during startup rejects late Ready and cannot be revived by stale events', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { host, children, message } = fixture()
  const states: RuntimeHostState[] = []
  host.subscribe(value => states.push(value.state))
  const started = host.start()
  children[0].emit('exit', 1, null)
  message('ready')
  children[0].emit('disconnect')
  children[0].stdin.emit('error', Error('private'))
  t.mock.timers.tick(50)
  assert.equal(states.includes('ready'), false)
  assert.equal((await started).code, 'cleanup-unconfirmed')
  assert.equal(children[0].killRequested, undefined)
  children[0].emit('close', 1, null)
  const retry = host.start()
  children[0].emit('disconnect')
  children[0].emit('exit', 1, null)
  assert.equal(host.snapshot().state, 'starting')
  message('ready'); await retry
  const stop = host.stop(); message('disposed'); children[1].emit('close', 0, null)
  assert.equal((await stop).state, 'stopped')
})

test('a queued disposal fact after exit still permits a confirmed normal stop', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { host, children, message } = fixture()
  const started = host.start(); message('ready'); await started
  const stopped = host.stop()
  children[0].emit('exit', 0, null)
  t.mock.timers.tick(19)
  message('disposed')
  children[0].emit('close', 0, null)
  assert.equal((await stopped).state, 'stopped')
  assert.equal(children[0].killRequested, undefined)
})

test('forced stop remains failed and unreaped ownership blocks restart until close', async () => {
  const { host, children, message } = fixture()
  const first = host.start(); message('ready'); await first
  const result = await host.stop()
  assert.equal(children[0].killRequested, true)
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
  await new Promise<void>(resolve => host.subscribe(s => { if (s.state === 'stopping') resolve() }))
  message('disposed'); children[0].emit('close', 0, null)
  assert.equal((await started).code, 'startup-timeout')
})

test('missing runtime, process errors, disconnect, EPIPE and hostile messages stay safe', async () => {
  const missing = fixture({ launch: () => { throw Error('secret:/Users/private') } }).host
  assert.equal((await missing.start()).code, 'runtime-unavailable')
  for (const fault of ['error', 'disconnect', 'pipe', 'message', 'output']) {
    const { host, children, message } = fixture({ outputLimit: 16 })
    const snapshots: RuntimeHostSnapshot[] = []
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
  const seen: RuntimeHostState[] = []
  let next: Promise<RuntimeHostSnapshot> | undefined
  host.subscribe(value => { if (value.state === 'failed' && children.length === 1) next = host.start() })
  host.subscribe(value => seen.push(value.state))
  const first = host.start()
  children[0].emit('close', 1, null)
  assert.equal((await first).state, 'failed')
  assert.deepEqual(seen, ['starting', 'failed', 'starting'])
  message('ready'); await next!
  const end = host.stop(); message('disposed'); children[1].emit('close', 0, null)
  assert.equal((await end).state, 'stopped')
})
