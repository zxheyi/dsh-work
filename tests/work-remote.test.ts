import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
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
    { method: 'importConversation', mode: 'unary' },
    { method: 'dispatch', mode: 'unary' },
    { method: 'readDeliverable', mode: 'unary' },
    { method: 'showDelivery', mode: 'unary' },
    { method: 'list', mode: 'unary' },
    { method: 'follow', mode: 'stream' },
  ])
})

test('publishes strict Work descriptors for the Client Remote mount', () => {
  assert.deepEqual(TYPERT_REMOTE.descriptors.map(descriptor =>
    `${descriptor.namespace}/${descriptor.method}`), [
    'work/create',
    'work/importConversation',
    'work/dispatch',
    'work/readDeliverable',
    'work/showDelivery',
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
    command: { type: 'deliver' },
  }))
  assert.deepEqual(codec.schema.parse({
    workId: 'work-1',
    mutationId: 'mutation-resource',
    expectedRevision: 2,
    command: {
      type: 'add-file-resource',
      name: 'brief.txt',
      mediaType: 'text/plain',
      dataBase64: 'YnJpZWY=',
    },
  }), {
    workId: 'work-1',
    mutationId: 'mutation-resource',
    expectedRevision: 2,
    command: {
      type: 'add-file-resource',
      name: 'brief.txt',
      mediaType: 'text/plain',
      dataBase64: 'YnJpZWY=',
    },
  })
  assert.deepEqual(codec.schema.parse({
    workId: 'work-1',
    mutationId: 'mutation-1',
    expectedRevision: 2,
    command: { type: 'produce-markdown', instruction: 'Create a concise report.' },
  }), {
    workId: 'work-1',
    mutationId: 'mutation-1',
    expectedRevision: 2,
    command: { type: 'produce-markdown', instruction: 'Create a concise report.' },
  })
  assert.deepEqual(codec.schema.parse({
    workId: 'work-1',
    mutationId: 'mutation-revision',
    expectedRevision: 3,
    command: { type: 'revise-markdown', instruction: 'Make the recommendation more specific.' },
  }), {
    workId: 'work-1',
    mutationId: 'mutation-revision',
    expectedRevision: 3,
    command: { type: 'revise-markdown', instruction: 'Make the recommendation more specific.' },
  })
  assert.deepEqual(codec.schema.parse({
    workId: 'work-1',
    mutationId: 'mutation-2',
    expectedRevision: 2,
    command: { type: 'deliver' },
  }), {
    workId: 'work-1',
    mutationId: 'mutation-2',
    expectedRevision: 2,
    command: { type: 'deliver' },
  })
  assert.throws(() => codec.schema.parse({
    workId: 'work-1',
    mutationId: 'mutation-1',
    expectedRevision: 2,
    command: { type: 'deliver', unexpected: true },
  }))

  const importConversation = TYPERT_REMOTE.descriptors.find(
    descriptor => descriptor.method === 'importConversation',
  )
  assert.ok(importConversation)
  const importCodec = importConversation.parameters[0]?.codec
  assert.equal(importCodec?.mode, 'strict')
  if (!importCodec || importCodec.mode !== 'strict') {
    throw new Error('Conversation import must publish a strict request codec')
  }
  assert.throws(() => importCodec.schema.parse({
    title: 'Too large',
    goal: 'Reject oversized context.',
    source: { sourceSystem: 'other', content: 'x'.repeat(100_001) },
  }))
})

test('imports conversation content through the product Remote without exposing provenance internals', async () => {
  const remote = remoteController()

  const imported = await remote.importConversation({
    title: 'Imported Work',
    goal: 'Continue safely.',
    source: {
      sourceSystem: 'dsh-desktop',
      sourceSessionId: 'external-session',
      content: 'A readable exported conversation.',
    },
  })

  assert.equal(imported.turnCount, 1)
  assert.equal('importSource' in imported, false)
  assert.equal('workspace' in imported, false)
  assert.equal('primarySession' in imported, false)
})

test('reads only bounded Markdown content through the product Remote', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-remote-read-'))
  const ctx = new Context()
  const controller = createWorkController({
    createId: () => 'work-remote-read',
    createSessionId: () => 'session-remote-read',
    workspaceRoot,
    harness: harness(),
  })
  ctx.provide('workController', controller)
  const remote = new WorkRemoteController(ctx)
  const created = await remote.create({ title: 'Read result', goal: 'Review safely.' })
  const workspacePath = path.join(workspaceRoot, created.workId)
  await fs.mkdir(path.join(workspacePath, 'deliverables'), { recursive: true })
  await fs.writeFile(path.join(workspacePath, 'deliverables', 'result.md'), '# Safe preview\n')
  await remote.dispatch({
    workId: created.workId,
    mutationId: 'record-for-read',
    expectedRevision: created.revision,
    command: { type: 'record-file', path: 'deliverables/result.md' },
  })

  const content = await remote.readDeliverable({ workId: created.workId })

  assert.deepEqual(content, {
    path: 'deliverables/result.md',
    content: '# Safe preview\n',
    contentDigest: 'f8c420147280db99c816fcb16fc624c30af28bd00bbcb6ec5fbb88332728bf76',
  })
  assert.equal('workspacePath' in content, false)
  await fs.rm(workspaceRoot, { recursive: true, force: true })
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
    resources: [],
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
