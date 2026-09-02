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
} from '../packages/work-api/index.ts'

function view(revision: number, status: WorkView['status'] = 'working'): WorkView {
  return {
    workId: 'work-client',
    revision,
    title: 'Client Work',
    goal: 'Keep one product projection.',
    turnCount: revision - 1,
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

test('provides ctx.works commands and throws typed Remote failures', async () => {
  const failure = new RemoteError('gateway/internal', 'Work create failed.', {})
  const model = new ClientWorkModel(successfulRemote({
    async create() {
      return { ok: false, error: failure }
    },
  }))
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
