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
    { method: 'importSessionResource', mode: 'unary' },
    { method: 'inspectSessionOutputs', mode: 'unary' },
    { method: 'inspectSessionOutputSources', mode: 'unary' },
    { method: 'prepareSessionOutputRevision', mode: 'unary' },
    { method: 'inspectSessionRevision', mode: 'unary' },
    { method: 'saveSessionOutput', mode: 'unary' },
    { method: 'showSessionOutputSave', mode: 'unary' },
    { method: 'listSessionOutputVersions', mode: 'unary' },
    { method: 'readSessionOutputVersion', mode: 'unary' },
    { method: 'readSessionOutput', mode: 'unary' },
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
    'work/importSessionResource',
    'work/list',
    'work/inspectSessionOutputs',
    'work/inspectSessionOutputSources',
    'work/readSessionOutput',
    'work/prepareSessionOutputRevision',
    'work/inspectSessionRevision',
    'work/saveSessionOutput',
    'work/showSessionOutputSave',
    'work/listSessionOutputVersions',
    'work/readSessionOutputVersion',
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

  const inspectOutputs = TYPERT_REMOTE.descriptors.find(
    descriptor => descriptor.method === 'inspectSessionOutputs',
  )
  assert.ok(inspectOutputs)
  const outputCodec = inspectOutputs.parameters[0]?.codec
  assert.equal(outputCodec?.mode, 'strict')
  if (!outputCodec || outputCodec.mode !== 'strict') {
    throw new Error('Session output inspection must publish a strict request codec')
  }
  assert.deepEqual(outputCodec.schema.parse({
    sessionId: 'session-remote', turn: 2, throughSeq: 12,
  }), { sessionId: 'session-remote', turn: 2, throughSeq: 12 })
  assert.throws(() => outputCodec.schema.parse({
    sessionId: 'session-remote', turn: 2, throughSeq: 12, staleTurn: 1,
  }))

  const inspectSources = TYPERT_REMOTE.descriptors.find(
    descriptor => descriptor.method === 'inspectSessionOutputSources',
  )
  assert.ok(inspectSources)
  const sourceResultCodec = inspectSources.result
  assert.equal(sourceResultCodec.mode, 'strict')
  assert.deepEqual(sourceResultCodec.schema.parse({
    items: [{
      sessionId: 'session-remote',
      turn: 2,
      name: 'brief.md',
      path: 'attachment-source-brief.md',
      reference: '@attachment-source-brief.md',
      bytes: 12,
      mediaType: 'text/markdown',
      contentDigest: 'a'.repeat(64),
      status: 'verified',
    }],
  }), {
    items: [{
      sessionId: 'session-remote',
      turn: 2,
      name: 'brief.md',
      path: 'attachment-source-brief.md',
      reference: '@attachment-source-brief.md',
      bytes: 12,
      mediaType: 'text/markdown',
      contentDigest: 'a'.repeat(64),
      status: 'verified',
    }],
  })
  assert.throws(() => sourceResultCodec.schema.parse({
    items: [{
      sessionId: 'session-remote', turn: 2, name: 'brief.md', path: 'brief.md',
      reference: '@brief.md', bytes: null, mediaType: null, contentDigest: null,
      status: 'invented',
    }],
  }))

  const readOutput = TYPERT_REMOTE.descriptors.find(
    descriptor => descriptor.method === 'readSessionOutput',
  )
  assert.ok(readOutput)
  const readOutputCodec = readOutput.parameters[0]?.codec
  assert.equal(readOutputCodec?.mode, 'strict')
  if (!readOutputCodec || readOutputCodec.mode !== 'strict') {
    throw new Error('Session output read must publish a strict request codec')
  }
  assert.deepEqual(readOutputCodec.schema.parse({
    sessionId: 'session-remote', turn: 2, throughSeq: 12, path: 'report.md',
  }), { sessionId: 'session-remote', turn: 2, throughSeq: 12, path: 'report.md' })

  const prepareRevision = TYPERT_REMOTE.descriptors.find(
    descriptor => descriptor.method === 'prepareSessionOutputRevision',
  )
  assert.ok(prepareRevision)
  const prepareRevisionCodec = prepareRevision.parameters[0]?.codec
  const prepareRevisionResultCodec = prepareRevision.result
  assert.equal(prepareRevisionCodec?.mode, 'strict')
  assert.equal(prepareRevisionResultCodec.mode, 'strict')
  if (!prepareRevisionCodec || prepareRevisionCodec.mode !== 'strict'
    || prepareRevisionResultCodec.mode !== 'strict') {
    throw new Error('Session output revision must publish strict codecs')
  }
  const versionSelection = { fileId: 'a'.repeat(32), versionId: 'b'.repeat(32) }
  assert.deepEqual(prepareRevisionCodec.schema.parse({
    sessionId: 'session-remote', turn: 2, throughSeq: 12, path: 'report.md',
    baseVersion: versionSelection,
  }), {
    sessionId: 'session-remote', turn: 2, throughSeq: 12, path: 'report.md',
    baseVersion: versionSelection,
  })
  assert.throws(() => prepareRevisionCodec.schema.parse({
    sessionId: 'session-remote', turn: 2, throughSeq: 12, path: 'report.md',
    baseVersion: { ...versionSelection, ordinal: 1 },
  }))
  const revisionValue = {
    sessionId: 'session-remote', sourceTurn: 2, name: 'report.md', path: 'report.md',
    reference: '@report.md', contentDigest: 'c'.repeat(64),
    baseVersion: {
      ...versionSelection, ordinal: 1, path: 'attachment-v1.md', reference: '@attachment-v1.md',
      contentDigest: 'd'.repeat(64),
    },
  }
  assert.deepEqual(prepareRevisionResultCodec.schema.parse(revisionValue), revisionValue)
  assert.throws(() => prepareRevisionResultCodec.schema.parse({
    ...revisionValue,
    baseVersion: { ...revisionValue.baseVersion, inventedAuthor: 'someone' },
  }))

  const saveOutput = TYPERT_REMOTE.descriptors.find(
    descriptor => descriptor.method === 'saveSessionOutput',
  )
  assert.ok(saveOutput)
  const saveCodec = saveOutput.parameters[0]?.codec
  const saveResultCodec = saveOutput.result
  assert.equal(saveCodec?.mode, 'strict')
  if (!saveCodec || saveCodec.mode !== 'strict' || saveResultCodec.mode !== 'strict') {
    throw new Error('Session output save must publish strict codecs')
  }
  assert.deepEqual(saveCodec.schema.parse({
    sessionId: 'session-remote', turn: 2, throughSeq: 12, path: 'report.md',
  }), { sessionId: 'session-remote', turn: 2, throughSeq: 12, path: 'report.md' })
  assert.throws(() => saveResultCodec.schema.parse({
    sessionId: 'session-remote', turn: 2, name: 'report.md', path: 'report.md',
    bytes: 12, mediaType: 'text/markdown', contentDigest: 'a'.repeat(64),
    saveId: '../escape', fileName: 'report.md', location: '/managed/saved',
  }))

  const listVersions = TYPERT_REMOTE.descriptors.find(
    descriptor => descriptor.method === 'listSessionOutputVersions',
  )
  const readVersion = TYPERT_REMOTE.descriptors.find(
    descriptor => descriptor.method === 'readSessionOutputVersion',
  )
  assert.ok(listVersions)
  assert.ok(readVersion)
  const listVersionsCodec = listVersions.parameters[0]?.codec
  const readVersionCodec = readVersion.parameters[0]?.codec
  assert.equal(listVersionsCodec?.mode, 'strict')
  assert.equal(readVersionCodec?.mode, 'strict')
  if (!listVersionsCodec || listVersionsCodec.mode !== 'strict'
    || !readVersionCodec || readVersionCodec.mode !== 'strict') {
    throw new Error('Session output versions must publish strict request codecs')
  }
  assert.deepEqual(listVersionsCodec.schema.parse({
    sessionId: 'session-remote', path: 'report.md',
  }), { sessionId: 'session-remote', path: 'report.md' })
  assert.throws(() => listVersionsCodec.schema.parse({
    sessionId: 'session-remote', path: 'report.md', unexpected: true,
  }))
  assert.deepEqual(readVersionCodec.schema.parse({
    fileId: 'a'.repeat(32), versionId: 'b'.repeat(32),
  }), { fileId: 'a'.repeat(32), versionId: 'b'.repeat(32) })
  assert.throws(() => readVersionCodec.schema.parse({
    fileId: '../escape', versionId: 'b'.repeat(32),
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
