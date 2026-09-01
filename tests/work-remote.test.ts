import assert from 'node:assert/strict'
import test from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import { RemoteError, remoteMethods } from '@deepseek-ai/dsh-typert-protocol'

import { createWorkController, type HarnessWorkPort } from '../packages/work-domain/index.ts'
import WorkRemoteController from '../packages/work-api/index.ts'
import { TYPERT_REMOTE } from '../packages/work-api/remote.ts'

function harness(): HarnessWorkPort {
  return {
    async ensureWorkspace(request) {
      return { workspaceId: 'workspace-remote', path: request.path }
    },
    async ensurePrimarySession(request) {
      return { sessionId: request.sessionId }
    },
    async submitTurn() {},
  }
}

function remoteController(): WorkRemoteController {
  const ctx = new Context()
  const controller = createWorkController({
    createId: () => 'work-remote',
    createSessionId: () => 'session-remote',
    createRequestId: () => 'request-remote',
    workspaceRoot: '/managed',
    harness: harness(),
  })
  ctx.provide('workController', controller)
  return new WorkRemoteController(ctx)
}

test('exports the narrow Work surface through public Typert markers', () => {
  const remote = remoteController()

  assert.deepEqual(remote.typertRemote, {
    service: remote,
    serviceKey: 'workApi',
    namespace: 'work',
  })
  assert.deepEqual(remoteMethods(remote).map(marker => ({
    method: marker.method,
    mode: marker.mode ?? 'unary',
  })), [
    { method: 'create', mode: 'unary' },
    { method: 'dispatch', mode: 'unary' },
    { method: 'list', mode: 'unary' },
    { method: 'follow', mode: 'stream' },
  ])
})

test('publishes strict Work descriptors for the Client Remote mount', () => {
  assert.deepEqual(TYPERT_REMOTE.descriptors.map(descriptor =>
    `${descriptor.namespace}/${descriptor.method}`), [
    'work/create',
    'work/dispatch',
    'work/list',
    'work/follow',
  ])
  const dispatch = TYPERT_REMOTE.descriptors.find(descriptor => descriptor.method === 'dispatch')
  assert.ok(dispatch)
  const request = dispatch.parameters[0]
  const codec = request?.codec
  assert.equal(codec?.mode, 'strict')
  if (!codec || codec.mode !== 'strict') {
    throw new Error('Work dispatch must publish a strict request codec')
  }
  assert.throws(() => codec.schema.parse({
    workId: 'work-1',
    command: { type: 'deliver', unexpected: true },
  }))
})

test('projects Work state without exposing Harness Workspace or Session internals', async () => {
  const remote = remoteController()

  const created = await remote.create({
    title: 'Remote Work',
    goal: 'Expose only product-owned state.',
  })

  assert.deepEqual(created, {
    workId: 'work-remote',
    revision: 1,
    title: 'Remote Work',
    goal: 'Expose only product-owned state.',
    turnCount: 0,
    deliverable: null,
    status: 'working',
    execution: 'idle',
    lastFailure: null,
  })
  assert.equal('workspace' in created, false)
  assert.equal('primarySession' in created, false)
  assert.deepEqual(await remote.list(), { items: [created] })
})

test('streams a product-safe baseline followed by Work upserts', async () => {
  const remote = remoteController()
  const abort = new AbortController()
  const frames = remote.follow(abort.signal)[Symbol.asyncIterator]()

  assert.deepEqual(await frames.next(), {
    done: false,
    value: { type: 'baseline', value: { items: [] } },
  })

  const pendingUpsert = frames.next()
  const created = await remote.create({ title: 'Follow Remote', goal: 'Carry reconnect-safe state.' })
  assert.deepEqual(await pendingUpsert, {
    done: false,
    value: { type: 'upsert', work: created },
  })
  abort.abort()
  await frames.return?.()
})

test('preserves stable Work failure codes across the Remote boundary', async () => {
  const remote = remoteController()
  await remote.create({ title: 'Only Work', goal: 'Keep singleton semantics.' })

  await assert.rejects(
    remote.create({ title: 'Second Work', goal: 'Must fail.' }),
    (error: unknown) => error instanceof RemoteError && error.code === 'work/already-exists',
  )
})
