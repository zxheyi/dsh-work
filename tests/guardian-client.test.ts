import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'

import { createGuardianClient } from '../packages/runtime-guardian/client.ts'
import { GUARDIAN_PROTOCOL } from '../packages/runtime-guardian/protocol.ts'

class FakeGuardianProcess extends EventEmitter {
  connected = true
  exitCode: number | null = null

  send(): boolean { return true }
  disconnect(): void { this.connected = false }
}

test('verified standalone Node starts and cleanly disconnects an idle guardian', async () => {
  const productRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-guardian-client-'))
  try {
    const client = await createGuardianClient({ node: process.execPath, productRoot })
    assert.deepEqual(client.snapshot(), {
      state: 'stopped', code: null, canStart: true, canStop: false, canRecover: false,
    })
    assert.equal(await client.dispose(), true)
  } finally { fs.rmSync(productRoot, { recursive: true, force: true }) }
})

test('guardian client refuses relative paths and a mismatched Node version', async () => {
  await assert.rejects(() => createGuardianClient({ node: 'node', productRoot: os.tmpdir() }))
  await assert.rejects(() => createGuardianClient({ node: process.execPath, productRoot: os.tmpdir() }, { probe: () => 'v22.0.0\n' }))
})

test('guardian exit rejects every in-flight request even when close is delayed', async () => {
  const child = new FakeGuardianProcess()
  const creating = createGuardianClient({ node: process.execPath, productRoot: os.tmpdir() }, {
    probe: () => 'v24.11.1\n',
    spawnProcess: () => child as unknown as ChildProcess,
  })
  process.nextTick(() => child.emit('message', {
    protocol: GUARDIAN_PROTOCOL,
    event: 'guardian-ready',
    value: { state: 'stopped', code: null, canStart: true, canStop: false, canRecover: false },
  }))
  const client = await creating
  const pending = client.start()
  child.emit('exit', 0, null)
  await assert.rejects(pending, /guardian unavailable/)
})

test('command responses resolve callers without duplicating the guardian status stream', async () => {
  const child = new FakeGuardianProcess()
  const creating = createGuardianClient({ node: process.execPath, productRoot: os.tmpdir() }, {
    probe: () => 'v24.11.1\n', spawnProcess: () => child as unknown as ChildProcess,
  })
  const stopped = { state: 'stopped', code: null, canStart: true, canStop: false, canRecover: false }
  process.nextTick(() => child.emit('message', {
    protocol: GUARDIAN_PROTOCOL, event: 'guardian-ready', value: stopped,
  }))
  const client = await creating
  const observed: string[] = []
  client.subscribe(value => observed.push(value.state))
  const pending = client.start()
  child.emit('message', { protocol: GUARDIAN_PROTOCOL, event: 'status',
    value: { state: 'starting', code: null, canStart: false, canStop: true, canRecover: false } })
  child.emit('message', { protocol: GUARDIAN_PROTOCOL, id: 1, result: stopped })
  assert.deepEqual(await pending, stopped)
  assert.deepEqual(observed, ['starting'])
})

test('guardian readiness timeout disconnects the detached process for bounded cleanup', async () => {
  const child = new FakeGuardianProcess()
  let disconnects = 0
  child.disconnect = () => { child.connected = false; disconnects++; child.emit('exit', 0, null) }
  await assert.rejects(() => createGuardianClient({ node: process.execPath, productRoot: os.tmpdir() }, {
    probe: () => 'v24.11.1\n', spawnProcess: () => child as unknown as ChildProcess, readyMs: 5,
  }), /readiness timeout/)
  assert.equal(disconnects, 1)
})
