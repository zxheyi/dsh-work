import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'

import type { RuntimeChild } from '../packages/runtime-host/index.ts'
import {
  createGenerationStore,
  type ClaimedGeneration,
  type GenerationSelection,
  type GenerationStore,
} from '../packages/runtime-guardian/generation-store.ts'
import { boundedGuardianSnapshot, GUARDIAN_PROTOCOL, validGuardianCommand } from '../packages/runtime-guardian/protocol.ts'
import { createGuardianService, type GuardianService } from '../packages/runtime-guardian/service.ts'

class FakeRuntimeChild extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly home: string

  constructor(home: string) {
    super()
    this.home = home
  }

  kill(): boolean { return true }
}

interface Fixture {
  readonly productRoot: string
  readonly store: GenerationStore
  readonly service: GuardianService
  readonly children: FakeRuntimeChild[]
  readonly homes: string[]
  readonly message: (event: 'ready' | 'disposed', child?: FakeRuntimeChild) => void
}

const claimed = (selection: GenerationSelection): ClaimedGeneration => {
  assert.equal(selection.status, 'claimed')
  if (selection.status !== 'claimed') throw new Error('expected a claimed generation')
  return selection
}

const inspectedGeneration = (store: GenerationStore): string => {
  const value = store.inspect()
  assert.ok(value && typeof value === 'object' && 'generation' in value && typeof value.generation === 'string')
  return value.generation
}

const childAt = (owned: Fixture, index: number): FakeRuntimeChild => {
  const child = owned.children[index]
  assert.ok(child)
  return child
}

const fixture = (): Fixture => {
  const productRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-guardian-service-'))
  const children: FakeRuntimeChild[] = []
  const homes: string[] = []
  let next = 0
  const store = createGenerationStore(productRoot, { id: () => `generation-${++next}` })
  const service = createGuardianService({ store,
    prepare: home => { homes.push(home) },
    launcher: home => () => {
      const child = new FakeRuntimeChild(home)
      children.push(child)
      return child as unknown as RuntimeChild
    },
  })
  const message = (event: 'ready' | 'disposed', child = children.at(-1)): void => {
    assert.ok(child)
    child.emit('message', { protocol: 'dsh-work.lifecycle.v1', event })
  }
  return { productRoot, store, service, children, homes, message }
}

test('a clean guardian stop is reusable across guardian processes', async () => {
  const owned = fixture()
  try {
    const starting = owned.service.start(); owned.message('ready'); await starting
    const generation = inspectedGeneration(owned.store)
    const stopping = owned.service.stop(); owned.message('disposed'); childAt(owned, 0).emit('close', 0, null); await stopping
    assert.equal(await owned.service.dispose(), true)

    const next = createGuardianService({
      store: createGenerationStore(owned.productRoot, { id: () => 'should-not-be-used' }),
      prepare: home => owned.homes.push(home),
      launcher: home => () => {
        const child = new FakeRuntimeChild(home)
        owned.children.push(child)
        return child as unknown as RuntimeChild
      },
    })
    const restarted = next.start()
    owned.message('ready')
    await restarted
    assert.equal(path.basename(childAt(owned, 1).home), generation)
    const stop = next.stop(); owned.message('disposed'); childAt(owned, 1).emit('close', 0, null); await stop
    await next.dispose()
  } finally { fs.rmSync(owned.productRoot, { recursive: true, force: true }) }
})

test('collision fails closed and explicit recovery starts a distinct generation', async () => {
  const owned = fixture()
  try {
    const stale = claimed(owned.store.claim())
    fs.writeFileSync(path.join(stale.home, 'uncertain'), 'preserved')
    const status = await owned.service.start()
    assert.deepEqual(status, { state: 'failed', code: 'recovery-required', canStart: false, canStop: false, canRecover: true })
    assert.equal(owned.children.length, 0)
    const recovery = owned.service.recover()
    owned.message('ready')
    await recovery
    assert.notEqual(inspectedGeneration(owned.store), stale.generation)
    assert.equal(fs.readFileSync(path.join(stale.home, 'uncertain'), 'utf8'), 'preserved')
    const stop = owned.service.stop(); owned.message('disposed'); childAt(owned, 0).emit('close', 0, null); await stop
    await owned.service.dispose()
  } finally { fs.rmSync(owned.productRoot, { recursive: true, force: true }) }
})

test('runtime failure requires isolated recovery and never auto-restarts', async () => {
  const owned = fixture()
  try {
    const start = owned.service.start(); owned.message('ready'); await start
    const failedGeneration = inspectedGeneration(owned.store)
    childAt(owned, 0).emit('exit', 9, null); childAt(owned, 0).emit('close', 9, null)
    assert.equal(owned.service.snapshot().canRecover, true)
    assert.equal(owned.service.snapshot().canStart, false)
    assert.equal(owned.children.length, 1)
    const recovery = owned.service.recover(); owned.message('ready'); await recovery
    assert.notEqual(inspectedGeneration(owned.store), failedGeneration)
    assert.equal(owned.children.length, 2)
    const stop = owned.service.stop(); owned.message('disposed'); childAt(owned, 1).emit('close', 0, null); await stop
    await owned.service.dispose()
  } finally { fs.rmSync(owned.productRoot, { recursive: true, force: true }) }
})

test('recovery is a no-op while the current generation is clean and reusable', async () => {
  const owned = fixture()
  try {
    assert.equal(owned.service.snapshot().canRecover, false)
    assert.deepEqual(await owned.service.recover(), owned.service.snapshot())
    assert.equal(owned.store.inspect(), null)
    const starting = owned.service.start(); owned.message('ready'); await starting
    const generation = inspectedGeneration(owned.store)
    const stopping = owned.service.stop(); owned.message('disposed'); childAt(owned, 0).emit('close', 0, null); await stopping
    assert.deepEqual(await owned.service.recover(), owned.service.snapshot())
    assert.equal(inspectedGeneration(owned.store), generation)
    await owned.service.dispose()
  } finally { fs.rmSync(owned.productRoot, { recursive: true, force: true }) }
})

test('guardian protocol accepts only exact versioned commands and bounded snapshots', () => {
  assert.equal(validGuardianCommand({ protocol: GUARDIAN_PROTOCOL, id: 1, command: 'recover' }), true)
  for (const value of [
    { protocol: GUARDIAN_PROTOCOL, id: 1, command: 'recover', path: '/secret' },
    { protocol: GUARDIAN_PROTOCOL, id: 0, command: 'start' },
    { protocol: 'other', id: 1, command: 'start' },
    { protocol: GUARDIAN_PROTOCOL, id: 1, command: 'kill' },
  ]) assert.equal(validGuardianCommand(value), false)
  const status = { state: 'failed', code: 'recovery-required', canStart: false, canStop: false, canRecover: true }
  assert.deepEqual(boundedGuardianSnapshot(status), status)
  assert.equal(boundedGuardianSnapshot({ ...status, pid: 123 }), null)
  assert.equal(boundedGuardianSnapshot({ ...status, code: '/private/path' }), null)
})
