import assert from 'node:assert/strict'
import test from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

import {
  ClientWorkModel,
  WorksController,
  type WorkClientRemote,
} from '../packages/work-api/client-model.ts'
import type {
  WorkCreateSpec,
  WorkImportConversationSpec,
  WorkDispatchRequest,
  WorkListValue,
  WorkView,
  WorkDeliverableContent,
} from '../packages/work-api/index.ts'

function view(revision: number, status: WorkView['status'] = 'working'): WorkView {
  return {
    workId: 'work-client',
    revision,
    title: 'Client Work',
    goal: 'Keep one product projection.',
    turnCount: revision - 1,
    resources: [],
    deliverable: null,
    status,
    execution: 'idle',
    lastFailure: null,
  }
}

function successfulRemote(overrides: Partial<WorkClientRemote> = {}): WorkClientRemote {
  const unavailableFollow = async function* (): AsyncIterable<never> {}
  return {
    async create(_spec: WorkCreateSpec): Promise<RemoteResult<WorkView>> {
      return { ok: true, value: view(1) }
    },
    async dispatch(_request: WorkDispatchRequest): Promise<RemoteResult<WorkView>> {
      return { ok: true, value: view(2) }
    },
    async importConversation(_spec: WorkImportConversationSpec): Promise<RemoteResult<WorkView>> {
      return { ok: true, value: view(2) }
    },
    async readDeliverable(): Promise<RemoteResult<WorkDeliverableContent>> {
      return {
        ok: true,
        value: {
          path: 'deliverables/result.md',
          content: '# Review me\n',
          contentDigest: 'a'.repeat(64),
        },
      }
    },
    async showDelivery(): Promise<RemoteResult<{ readonly shown: true }>> {
      return { ok: true, value: { shown: true } }
    },
    async importSessionResource() {
      return {
        ok: true as const,
        value: {
          sessionId: 'session-client',
          name: 'notes.md',
          path: 'attachments/session/notes.md',
          bytes: 8,
          mediaType: 'text/markdown',
          contentDigest: 'b'.repeat(64),
        },
      }
    },
    async inspectSessionOutputs() {
      return { ok: true as const, value: { items: [] } }
    },
    async inspectSessionOutputSources() {
      return { ok: true as const, value: { items: [] } }
    },
    async prepareSessionOutputRevision() {
      return {
        ok: true as const,
        value: {
          sessionId: 'session-client', sourceTurn: 1, preparedAfterTurn: 1,
          name: 'report.md', path: 'report.md',
          reference: '@report.md', contentDigest: 'd'.repeat(64),
          revisionLease: {
            leaseId: 'c'.repeat(32), expectedContentDigest: 'd'.repeat(64), path: 'report.md',
          },
        },
      }
    },
    async inspectSessionRevision() {
      return { ok: true as const, value: null }
    },
    async saveSessionOutput() {
      return {
        ok: true as const,
        value: {
          sessionId: 'session-client', turn: 1, name: 'report.md', path: 'report.md',
          bytes: 9, mediaType: 'text/markdown', contentDigest: 'd'.repeat(64),
          saveId: 'e'.repeat(32), fileName: 'report.md', location: '/managed/saved',
        },
      }
    },
    async showSessionOutputSave() {
      return { ok: true as const, value: { shown: true as const } }
    },
    async listSessionOutputVersions() {
      return { ok: true as const, value: { items: [] } }
    },
    async readSessionOutputVersion() {
      return {
        ok: true as const,
        value: {
          fileId: 'f'.repeat(32), versionId: 'e'.repeat(32), ordinal: 1,
          origin: 'generated' as const, sessionId: 'session-client', turn: 1, throughSeq: 2,
          name: 'report.md', path: 'report.md', bytes: 9, mediaType: 'text/markdown',
          contentDigest: 'd'.repeat(64), createdAt: '2026-09-06T00:00:00.000Z', sources: [],
          content: '# Report\n',
        },
      }
    },
    async adoptSessionOutputVersion() {
      return {
        ok: true as const,
        value: {
          fileId: 'f'.repeat(32), versionId: 'e'.repeat(32), sessionId: 'session-client',
          path: 'report.md', contentDigest: 'd'.repeat(64), summary: 'Report',
          adoptedAt: '2026-09-06T00:00:00.000Z',
        },
      }
    },
    async readSessionOutput() {
      return {
        ok: true as const,
        value: {
          sessionId: 'session-client',
          turn: 1,
          name: 'report.md',
          path: 'report.md',
          bytes: 9,
          mediaType: 'text/markdown',
          content: '# Report\n',
          contentDigest: 'd'.repeat(64),
          sources: [],
        },
      }
    },
    async list(): Promise<RemoteResult<WorkListValue>> {
      return { ok: true, value: { items: [view(1)] } }
    },
    follow: unavailableFollow,
    ...overrides,
  }
}

test('starts pending and becomes ready only after a complete Work baseline', () => {
  const model = new ClientWorkModel(successfulRemote())

  assert.deepEqual(model.getSnapshot(), {
    items: [],
    state: 'loading',
    phase: 'pending',
    error: null,
  })

  model.replaceBaseline({ items: [view(1)] })

  assert.deepEqual(model.getSnapshot(), {
    items: [view(1)],
    state: 'idle',
    phase: 'ready',
    error: null,
  })
})

test('merges unary command echoes and rejects delayed older stream frames', async () => {
  const model = new ClientWorkModel(successfulRemote({
    async create() {
      return { ok: true, value: view(2) }
    },
  }))
  model.replaceBaseline({ items: [view(1)] })

  const created = await model.create({ title: 'Client Work', goal: 'Create it.' })
  model.upsertView(view(1))

  assert.deepEqual(created, { ok: true, value: view(2) })
  assert.deepEqual(model.getSnapshot().items, [view(2)])
})

test('keeps the last complete Work state while reconnecting and exposes terminal failures', () => {
  const model = new ClientWorkModel(successfulRemote())
  model.replaceBaseline({ items: [view(1)] })

  model.handleCarrierFailure()
  assert.deepEqual(model.getSnapshot(), {
    items: [view(1)],
    state: 'loading',
    phase: 'ready',
    error: null,
  })

  const failure = new RemoteError('gateway/internal', 'Work follow failed.', {})
  model.handleStreamFailure(failure)
  assert.deepEqual(model.getSnapshot(), {
    items: [view(1)],
    state: 'error',
    phase: 'ready',
    error: failure,
  })
})

test('rejects runtime-dependent writes while reconnecting without replaying them after recovery', async () => {
  const calls: string[] = []
  const model = new ClientWorkModel(successfulRemote({
    async create() { calls.push('create'); return { ok: true, value: view(2) } },
    async importSessionResource() {
      calls.push('import')
      return {
        ok: true,
        value: {
          sessionId: 'session-client', name: 'notes.md', path: 'notes.md', bytes: 4,
          mediaType: 'text/markdown', contentDigest: 'c'.repeat(64),
        },
      }
    },
  }))
  model.replaceBaseline({ items: [view(1)] })
  model.handleCarrierFailure()
  const works = new WorksController(new Context(), model)

  await assert.rejects(() => works.create({ title: 'Do not replay', goal: 'Wait for recovery.' }), /unavailable/)
  await assert.rejects(() => works.importSessionResource({
    sessionId: 'session-client', name: 'notes.md', dataBase64: 'dGVzdA==',
  }), /unavailable/)
  assert.deepEqual(calls, [])

  model.replaceBaseline({ items: [view(1)] })
  assert.deepEqual(calls, [])
  await works.create({ title: 'Explicit retry', goal: 'Run only after recovery.' })
  assert.deepEqual(calls, ['create'])
})

test('provides ctx.works commands and throws typed Remote failures', async () => {
  const failure = new RemoteError('gateway/internal', 'Work create failed.', {})
  const model = new ClientWorkModel(successfulRemote({
    async create() {
      return { ok: false, error: failure }
    },
  }))
  model.replaceBaseline({ items: [] })
  const ctx = new Context()
  const works = new WorksController(ctx, model)

  assert.ok(ctx.works)
  assert.equal(works.list, model)
  assert.equal(ctx.works.list, model)
  await assert.rejects(
    ctx.works.create({ title: 'Rejected', goal: 'Surface the failure.' }),
    (error: unknown) => error === failure,
  )
})

test('adds a unique mutation id and current revision to every client dispatch', async () => {
  const requests: WorkDispatchRequest[] = []
  const model = new ClientWorkModel(successfulRemote({
    async dispatch(request) {
      requests.push(request)
      return { ok: true, value: view(2) }
    },
  }))
  model.replaceBaseline({ items: [view(1)] })
  const ctx = new Context()
  const works = new WorksController(ctx, model, () => 'mutation-client')

  await works.dispatch({
    workId: 'work-client',
    command: { type: 'submit-turn', instruction: 'Continue once.' },
  })

  assert.deepEqual(requests, [{
    workId: 'work-client',
    mutationId: 'mutation-client',
    expectedRevision: 1,
    command: { type: 'submit-turn', instruction: 'Continue once.' },
  }])
})

test('imports an existing conversation through ctx.works and installs the returned Work', async () => {
  const imports: WorkImportConversationSpec[] = []
  const model = new ClientWorkModel(successfulRemote({
    async importConversation(spec) {
      imports.push(spec)
      return { ok: true, value: view(2) }
    },
  }))
  model.replaceBaseline({ items: [] })
  const ctx = new Context()
  const works = new WorksController(ctx, model)
  const spec: WorkImportConversationSpec = {
    title: 'Continue an existing conversation',
    goal: 'Produce a deliverable from the previous context.',
    source: { sourceSystem: 'dsh', content: 'Readable prior conversation.' },
  }

  const imported = await works.importConversation(spec)

  assert.deepEqual(imports, [spec])
  assert.deepEqual(imported, view(2))
  assert.deepEqual(model.getSnapshot().items, [view(2)])
})

test('reads deliverable content through ctx.works without installing it in the list projection', async () => {
  const model = new ClientWorkModel(successfulRemote())
  model.replaceBaseline({ items: [view(1)] })
  const works = new WorksController(new Context(), model)

  const content = await works.readDeliverable('work-client')

  assert.equal(content.path, 'deliverables/result.md')
  assert.equal(content.content, '# Review me\n')
  assert.deepEqual(model.getSnapshot().items, [view(1)])
})

test('shows a delivered Work through ctx.works', async () => {
  const shown: string[] = []
  const model = new ClientWorkModel(successfulRemote({
    async showDelivery(request) {
      shown.push(request.workId)
      return { ok: true, value: { shown: true } }
    },
  }))
  model.replaceBaseline({ items: [view(1)] })
  const works = new WorksController(new Context(), model)

  await works.showDelivery('work-client')

  assert.deepEqual(shown, ['work-client'])
})

test('imports a resource for the addressed Session without mutating the Work list', async () => {
  const received: unknown[] = []
  const model = new ClientWorkModel(successfulRemote({
    async importSessionResource(spec) {
      received.push(spec)
      return {
        ok: true,
        value: {
          sessionId: spec.sessionId,
          name: spec.name,
          path: 'attachment-session-digest-notes.md',
          bytes: 5,
          mediaType: spec.mediaType ?? null,
          contentDigest: 'c'.repeat(64),
        },
      }
    },
  }))
  model.replaceBaseline({ items: [view(1)] })
  const works = new WorksController(new Context(), model)
  const spec = {
    sessionId: 'session-addressed',
    name: 'notes.md',
    mediaType: 'text/markdown',
    dataBase64: 'aGVsbG8=',
  }

  const resource = await works.importSessionResource(spec)

  assert.deepEqual(received, [spec])
  assert.equal(resource.sessionId, 'session-addressed')
  assert.deepEqual(model.getSnapshot().items, [view(1)])
})

test('loads validated output files for the exact Session Turn without mutating Work state', async () => {
  const received: unknown[] = []
  const model = new ClientWorkModel(successfulRemote({
    async inspectSessionOutputs(spec) {
      received.push(spec)
      return {
        ok: true,
        value: {
          items: [{
            sessionId: spec.sessionId,
            turn: spec.turn,
            name: 'report.md',
            path: 'report.md',
            bytes: 9,
            mediaType: 'text/markdown',
          }],
        },
      }
    },
  }))
  model.replaceBaseline({ items: [view(1)] })
  const works = new WorksController(new Context(), model)
  const spec = { sessionId: 'session-exact', turn: 3, throughSeq: 18 }

  const outputs = await works.inspectSessionOutputs(spec)

  assert.deepEqual(received, [spec])
  assert.deepEqual(outputs, [{
    sessionId: 'session-exact',
    turn: 3,
    name: 'report.md',
    path: 'report.md',
    bytes: 9,
    mediaType: 'text/markdown',
  }])
  assert.deepEqual(model.getSnapshot().items, [view(1)])
})

test('reads the exact Session output without mutating Work state', async () => {
  const received: unknown[] = []
  const model = new ClientWorkModel(successfulRemote({
    async readSessionOutput(spec) {
      received.push(spec)
      return {
        ok: true,
        value: {
          sessionId: spec.sessionId,
          turn: spec.turn,
          name: 'report.md',
          path: spec.path,
          bytes: 9,
          mediaType: 'text/markdown',
          content: '# Report\n',
          contentDigest: 'e'.repeat(64),
          sources: [],
        },
      }
    },
  }))
  model.replaceBaseline({ items: [view(1)] })
  const works = new WorksController(new Context(), model)
  const spec = { sessionId: 'session-exact', turn: 3, throughSeq: 18, path: 'report.md' }

  const content = await works.readSessionOutput(spec)

  assert.deepEqual(received, [spec])
  assert.equal(content.content, '# Report\n')
  assert.deepEqual(model.getSnapshot().items, [view(1)])
})

test('loads auditable sources for the exact Session Turn without mutating Work state', async () => {
  const received: unknown[] = []
  const model = new ClientWorkModel(successfulRemote({
    async inspectSessionOutputSources(spec) {
      received.push(spec)
      return {
        ok: true,
        value: {
          items: [{
            sessionId: spec.sessionId,
            turn: spec.turn,
            name: 'brief.md',
            path: 'attachment-source-brief.md',
            reference: '@attachment-source-brief.md',
            bytes: 12,
            mediaType: 'text/markdown',
            contentDigest: 'f'.repeat(64),
            status: 'verified',
          }],
        },
      }
    },
  }))
  model.replaceBaseline({ items: [view(1)] })
  const works = new WorksController(new Context(), model)
  const spec = { sessionId: 'session-exact', turn: 3, throughSeq: 18 }

  const sources = await works.inspectSessionOutputSources(spec)

  assert.deepEqual(received, [spec])
  assert.equal(sources[0]?.status, 'verified')
  assert.deepEqual(model.getSnapshot().items, [view(1)])
})

test('prepares and inspects a Session revision without changing the Work projection', async () => {
  const received: unknown[] = []
  const baseVersion = { fileId: 'a'.repeat(32), versionId: 'b'.repeat(32) }
  const model = new ClientWorkModel(successfulRemote({
    async prepareSessionOutputRevision(spec) {
      received.push(['prepare', spec])
      return {
        ok: true,
        value: {
          sessionId: spec.sessionId,
          sourceTurn: 1,
          preparedAfterTurn: spec.turn,
          name: 'report.md',
          path: spec.path,
          reference: '@report.md',
          contentDigest: 'f'.repeat(64),
          revisionLease: {
            leaseId: 'c'.repeat(32), expectedContentDigest: 'f'.repeat(64), path: 'report.md',
          },
          intent: 'restore',
          baseVersion: {
            ...baseVersion,
            ordinal: 1,
            path: 'attachment-v1.md',
            reference: '@attachment-v1.md',
            contentDigest: 'e'.repeat(64),
          },
        },
      }
    },
    async inspectSessionRevision(spec) {
      received.push(['inspect', spec])
      return { ok: true, value: null }
    },
    async inspectSessionOutputs(spec) {
      received.push(['outputs', spec])
      return { ok: true, value: { items: [{
        sessionId: spec.sessionId,
        turn: spec.turn,
        name: 'report.md',
        path: 'report.md',
        bytes: 12,
        mediaType: 'text/markdown',
      }] } }
    },
  }))
  model.replaceBaseline({ items: [view(1)] })
  const works = new WorksController(new Context(), model)
  const output = {
    sessionId: 'session-revision', turn: 4, throughSeq: 23, path: 'report.md', baseVersion,
    intent: 'restore' as const,
  }

  const revision = await works.prepareSessionOutputRevision(output)
  assert.equal(revision.reference, '@report.md')
  assert.equal(revision.baseVersion?.versionId, baseVersion.versionId)
  assert.equal(revision.intent, 'restore')
  await works.inspectSessionOutputs({ sessionId: output.sessionId, turn: 4, throughSeq: 23 })
  assert.equal(await works.inspectSessionRevision({
    sessionId: output.sessionId, turn: 5, throughSeq: 31,
  }), null)
  await works.inspectSessionOutputs({ sessionId: output.sessionId, turn: 5, throughSeq: 31 })
  await works.inspectSessionOutputs({ sessionId: output.sessionId, turn: 6, throughSeq: 35 })
  assert.deepEqual(received, [
    ['prepare', output],
    ['outputs', {
      sessionId: 'session-revision', turn: 4, throughSeq: 23,
      revisionLease: {
        leaseId: 'c'.repeat(32), expectedContentDigest: 'f'.repeat(64), path: 'report.md',
      },
    }],
    ['inspect', {
      sessionId: 'session-revision', turn: 5, throughSeq: 31,
      revisionLease: {
        leaseId: 'c'.repeat(32), expectedContentDigest: 'f'.repeat(64), path: 'report.md',
      },
    }],
    ['outputs', {
      sessionId: 'session-revision', turn: 5, throughSeq: 31,
      revisionLease: {
        leaseId: 'c'.repeat(32), expectedContentDigest: 'f'.repeat(64), path: 'report.md',
      },
    }],
    ['outputs', { sessionId: 'session-revision', turn: 6, throughSeq: 35 }],
  ])
  assert.deepEqual(model.getSnapshot().items, [view(1)])
})

test('saves and opens a Session output without changing the Work projection', async () => {
  const received: unknown[] = []
  const saved = {
    sessionId: 'session-save', turn: 2, name: 'report.md', path: 'report.md',
    bytes: 9, mediaType: 'text/markdown', contentDigest: 'a'.repeat(64),
    sourceVersion: { fileId: 'c'.repeat(32), versionId: 'd'.repeat(32), ordinal: 1 },
    saveId: 'b'.repeat(32), fileName: 'report.md', location: '/managed/saved',
  }
  const model = new ClientWorkModel(successfulRemote({
    async saveSessionOutput(spec) {
      received.push(['save', spec])
      return { ok: true, value: saved }
    },
    async showSessionOutputSave(spec) {
      received.push(['show', spec])
      return { ok: true, value: { shown: true } }
    },
  }))
  model.replaceBaseline({ items: [view(1)] })
  const works = new WorksController(new Context(), model)
  const output = {
    sessionId: 'session-save', turn: 2, throughSeq: 9, path: 'report.md',
    version: { fileId: saved.sourceVersion.fileId, versionId: saved.sourceVersion.versionId },
  }

  assert.deepEqual(await works.saveSessionOutput(output), saved)
  await works.showSessionOutputSave({
    saveId: saved.saveId,
    fileName: saved.fileName,
    contentDigest: saved.contentDigest,
  })
  assert.deepEqual(received, [
    ['save', output],
    ['show', { saveId: saved.saveId, fileName: saved.fileName, contentDigest: saved.contentDigest }],
  ])
  assert.deepEqual(model.getSnapshot().items, [view(1)])
})

test('lists and reads immutable Session output versions without changing Work state', async () => {
  const received: unknown[] = []
  const version = {
    fileId: 'a'.repeat(32), versionId: 'b'.repeat(32), ordinal: 1,
    origin: 'generated' as const, sessionId: 'session-version', turn: 2, throughSeq: 9,
    name: 'report.md', path: 'report.md', bytes: 9, mediaType: 'text/markdown',
    contentDigest: 'c'.repeat(64), createdAt: '2026-09-06T00:00:00.000Z', sources: [],
  }
  const adoption = {
    fileId: version.fileId, versionId: version.versionId, sessionId: version.sessionId,
    path: version.path, contentDigest: version.contentDigest, summary: 'Report',
    adoptedAt: '2026-09-06T00:01:00.000Z',
  }
  const model = new ClientWorkModel(successfulRemote({
    async listSessionOutputVersions(spec) {
      received.push(['list', spec])
      return { ok: true, value: { items: [version] } }
    },
    async readSessionOutputVersion(spec) {
      received.push(['read', spec])
      return { ok: true, value: { ...version, content: '# Report\n' } }
    },
    async adoptSessionOutputVersion(spec) {
      received.push(['adopt', spec])
      return { ok: true, value: adoption }
    },
  }))
  model.replaceBaseline({ items: [view(1)] })
  const works = new WorksController(new Context(), model)

  assert.deepEqual(await works.listSessionOutputVersions({
    sessionId: version.sessionId, path: version.path,
  }), [version])
  assert.equal((await works.readSessionOutputVersion({
    fileId: version.fileId, versionId: version.versionId,
  })).content, '# Report\n')
  assert.deepEqual(await works.adoptSessionOutputVersion({
    fileId: version.fileId, versionId: version.versionId,
  }), adoption)
  assert.deepEqual(received, [
    ['list', { sessionId: 'session-version', path: 'report.md' }],
    ['read', { fileId: version.fileId, versionId: version.versionId }],
    ['adopt', { fileId: version.fileId, versionId: version.versionId }],
  ])
  assert.deepEqual(model.getSnapshot().items, [view(1)])
})
