import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  WorkError,
  createHarnessWorkPort,
  createMemoryWorkStore,
  createWorkController,
  type HarnessWorkPort,
} from '../packages/work-domain/index.ts'

function testHarness(): HarnessWorkPort {
  return {
    async ensureWorkspace(request) {
      return { workspaceId: 'workspace-1', path: request.path }
    },
    async ensurePrimarySession(request) {
      return { sessionId: request.sessionId }
    },
    async submitTurn() {},
  }
}

test('creates the only Work and returns it through the public controller', async () => {
  const controller = createWorkController({
    createId: () => 'work-1',
    createSessionId: () => 'session-1',
    workspaceRoot: '/managed',
    harness: testHarness(),
  })

  const created = await controller.create({
    title: 'Prepare launch brief',
    goal: 'Produce a launch brief that is ready to deliver.',
  })

  assert.deepEqual(created, {
    workId: 'work-1',
    revision: 1,
    title: 'Prepare launch brief',
    goal: 'Produce a launch brief that is ready to deliver.',
    workspace: {
      workspaceId: 'workspace-1',
      path: '/managed/work-1',
    },
    primarySession: {
      sessionId: 'session-1',
      turnCount: 0,
    },
    deliverable: null,
    status: 'working',
    execution: 'idle',
    lastFailure: null,
    lastMutationId: null,
    lastMutationDigest: null,
  })
  assert.deepEqual(await controller.get(), created)
})

test('lists the singleton Work through the public controller', async () => {
  const controller = createWorkController({
    createId: () => 'work-listed',
    createSessionId: () => 'session-listed',
    workspaceRoot: '/managed',
    harness: testHarness(),
  })

  assert.deepEqual(await controller.list(), [])

  const created = await controller.create({
    title: 'Listed Work',
    goal: 'Expose a product-owned list projection.',
  })

  assert.deepEqual(await controller.list(), [created])
})

test('follows a complete baseline and committed Work upserts', async () => {
  let persisted = false
  const controller = createWorkController({
    createId: () => 'work-followed',
    createSessionId: () => 'session-followed',
    workspaceRoot: '/managed',
    harness: testHarness(),
    store: {
      async load() {
        return null
      },
      async save() {
        persisted = true
      },
    },
  })
  const abort = new AbortController()
  const frames = controller.follow(abort.signal)[Symbol.asyncIterator]()

  assert.deepEqual(await frames.next(), {
    done: false,
    value: { type: 'baseline', value: { items: [] } },
  })

  const pendingUpsert = frames.next()
  const created = await controller.create({
    title: 'Followed Work',
    goal: 'Reconnect from a complete snapshot and continue with increments.',
  })
  const upsert = await pendingUpsert

  assert.equal(persisted, true)
  assert.deepEqual(upsert, {
    done: false,
    value: { type: 'upsert', work: created },
  })
  abort.abort()
  await frames.return?.()
})

test('rejects a second Work instead of silently replacing the first one', async () => {
  const controller = createWorkController({
    createId: () => 'work-1',
    createSessionId: () => 'session-1',
    workspaceRoot: '/managed',
    harness: testHarness(),
  })
  await controller.create({ title: 'First', goal: 'Keep this Work.' })

  await assert.rejects(
    controller.create({ title: 'Second', goal: 'Replace the Work.' }),
    (error: unknown) => error instanceof WorkError && error.code === 'work/already-exists',
  )
  assert.equal((await controller.get())?.title, 'First')
})

test('creates and registers a DSH Work managed Workspace', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-workspace-'))
  const calls: Array<{ path: string; title: string | undefined }> = []
  const harness = createHarnessWorkPort({
    workspaceRegistry: {
      async create(workspacePath, title) {
        calls.push({ path: workspacePath, title })
        assert.equal((await fs.stat(workspacePath)).isDirectory(), true)
        return { id: 'workspace-registered', path: workspacePath }
      },
    },
    sessionController: {
      async create(request) {
        return { sessionId: request.sessionId }
      },
      async prompt() {
        return { accepted: true as const }
      },
    },
  })
  const controller = createWorkController({
    createId: () => 'work-managed',
    createSessionId: () => 'session-managed',
    workspaceRoot,
    harness,
  })

  const created = await controller.create({ title: 'Managed Work', goal: 'Own the product boundary.' })

  const managedPath = path.join(workspaceRoot, 'work-managed')
  assert.deepEqual(calls, [{ path: managedPath, title: 'Managed Work' }])
  assert.deepEqual(created.workspace, {
    workspaceId: 'workspace-registered',
    path: managedPath,
  })
  await fs.rm(workspaceRoot, { recursive: true, force: true })
})

test('binds the Primary Session by workspaceId without forwarding cwd', async () => {
  const requests: unknown[] = []
  const harness = createHarnessWorkPort({
    workspaceRegistry: {
      async create(workspacePath) {
        return { id: 'workspace-adapter', path: workspacePath }
      },
    },
    sessionController: {
      async create(request) {
        requests.push(request)
        if ('cwd' in request) {
          throw new Error('session.create accepts workspaceId or cwd, not both')
        }
        return { sessionId: request.sessionId }
      },
      async prompt() {
        return { accepted: true as const }
      },
    },
  })
  const requestWithLegacyCwd = {
    sessionId: 'session-adapter',
    workspaceId: 'workspace-adapter',
    cwd: '/managed/work-adapter',
  }

  const session = await harness.ensurePrimarySession(requestWithLegacyCwd)

  assert.deepEqual(session, { sessionId: 'session-adapter' })
  assert.deepEqual(requests, [{
    sessionId: 'session-adapter',
    workspaceId: 'workspace-adapter',
  }])
})

test('creates one Primary Session bound to the managed Workspace', async () => {
  const sessionRequests: Array<{
    sessionId: string
    workspaceId: string
  }> = []
  const harness: HarnessWorkPort = {
    async ensureWorkspace(request) {
      return { workspaceId: 'workspace-primary', path: request.path }
    },
    async ensurePrimarySession(request) {
      sessionRequests.push(request)
      return { sessionId: request.sessionId }
    },
    async submitTurn() {},
  }
  const controller = createWorkController({
    createId: () => 'work-primary',
    createSessionId: () => 'session-primary',
    workspaceRoot: '/managed',
    harness,
  })

  const created = await controller.create({ title: 'Primary', goal: 'Use one execution context.' })

  assert.deepEqual(sessionRequests, [{
    sessionId: 'session-primary',
    workspaceId: 'workspace-primary',
  }])
  assert.deepEqual(created.primarySession, { sessionId: 'session-primary', turnCount: 0 })
})

test('dispatches multiple Turns through the same Primary Session', async () => {
  const turns: Array<{
    requestId: string
    sessionId: string
    instruction: string
  }> = []
  const requestIds = ['request-1', 'request-2']
  const harness: HarnessWorkPort = {
    async ensureWorkspace(request) {
      return { workspaceId: 'workspace-turns', path: request.path }
    },
    async ensurePrimarySession(request) {
      return { sessionId: request.sessionId }
    },
    async submitTurn(request) {
      turns.push(request)
    },
  }
  const controller = createWorkController({
    createId: () => 'work-turns',
    createSessionId: () => 'session-turns',
    createRequestId: () => requestIds.shift()!,
    workspaceRoot: '/managed',
    harness,
  })
  const created = await controller.create({ title: 'Turns', goal: 'Keep context across steps.' })

  await controller.dispatch({
    workId: created.workId,
    command: { type: 'submit-turn', instruction: 'Draft the outline.' },
  })
  const updated = await controller.dispatch({
    workId: created.workId,
    command: { type: 'submit-turn', instruction: 'Revise the introduction.' },
  })

  assert.deepEqual(turns, [
    { requestId: 'request-1', sessionId: 'session-turns', instruction: 'Draft the outline.' },
    { requestId: 'request-2', sessionId: 'session-turns', instruction: 'Revise the introduction.' },
  ])
  assert.deepEqual(updated.primarySession, { sessionId: 'session-turns', turnCount: 2 })
  assert.equal(updated.revision, 3)
})

test('records one existing file inside the managed Workspace as the deliverable', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-deliverable-'))
  const harness = testHarness()
  const controller = createWorkController({
    createId: () => 'work-file',
    createSessionId: () => 'session-file',
    workspaceRoot,
    harness,
  })
  const created = await controller.create({ title: 'File', goal: 'Produce one reviewable file.' })
  await fs.mkdir(created.workspace.path, { recursive: true })
  await fs.writeFile(path.join(created.workspace.path, 'launch-brief.md'), '# Launch brief\n')

  const updated = await controller.dispatch({
    workId: created.workId,
    command: { type: 'record-file', path: 'launch-brief.md' },
  })

  assert.deepEqual(updated.deliverable, {
    kind: 'file',
    path: 'launch-brief.md',
  })
  assert.equal(updated.primarySession.turnCount, 0)
  await fs.rm(workspaceRoot, { recursive: true, force: true })
})

test('rejects a second file deliverable', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-one-file-'))
  const controller = createWorkController({
    createId: () => 'work-one-file',
    createSessionId: () => 'session-one-file',
    workspaceRoot,
    harness: testHarness(),
  })
  const created = await controller.create({ title: 'One file', goal: 'Keep one clear outcome.' })
  await fs.mkdir(created.workspace.path, { recursive: true })
  await fs.writeFile(path.join(created.workspace.path, 'first.md'), 'first')
  await fs.writeFile(path.join(created.workspace.path, 'second.md'), 'second')
  await controller.dispatch({
    workId: created.workId,
    command: { type: 'record-file', path: 'first.md' },
  })

  await assert.rejects(
    controller.dispatch({
      workId: created.workId,
      command: { type: 'record-file', path: 'second.md' },
    }),
    (error: unknown) => error instanceof WorkError && error.code === 'work/deliverable-exists',
  )
  await fs.rm(workspaceRoot, { recursive: true, force: true })
})

test('moves a file deliverable through review, completion, and delivery', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-status-'))
  const controller = createWorkController({
    createId: () => 'work-status',
    createSessionId: () => 'session-status',
    workspaceRoot,
    harness: testHarness(),
  })
  const created = await controller.create({ title: 'Status', goal: 'Make progress understandable.' })
  await fs.mkdir(created.workspace.path, { recursive: true })
  await fs.writeFile(path.join(created.workspace.path, 'result.md'), 'ready')

  const awaitingReview = await controller.dispatch({
    workId: created.workId,
    command: { type: 'record-file', path: 'result.md' },
  })
  const completed = await controller.dispatch({
    workId: created.workId,
    command: { type: 'complete' },
  })
  const delivered = await controller.dispatch({
    workId: created.workId,
    command: { type: 'deliver' },
  })

  assert.equal(created.status, 'working')
  assert.equal(awaitingReview.status, 'awaiting-review')
  assert.equal(completed.status, 'completed')
  assert.equal(delivered.status, 'delivered')
  await fs.rm(workspaceRoot, { recursive: true, force: true })
})

test('does not deliver a Work before review completion', async () => {
  const controller = createWorkController({
    createId: () => 'work-order',
    createSessionId: () => 'session-order',
    workspaceRoot: '/managed',
    harness: testHarness(),
  })
  const created = await controller.create({ title: 'Order', goal: 'Preserve the review gate.' })

  await assert.rejects(
    controller.dispatch({ workId: created.workId, command: { type: 'deliver' } }),
    (error: unknown) => error instanceof WorkError && error.code === 'work/invalid-transition',
  )
})

test('restores the Work, managed Workspace, and Primary Session after restart', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-restart-'))
  const store = createMemoryWorkStore()
  const first = createWorkController({
    createId: () => 'work-restored',
    createSessionId: () => 'session-restored',
    createRequestId: () => 'request-before-restart',
    workspaceRoot,
    harness: testHarness(),
    store,
  })
  const created = await first.create({ title: 'Restore', goal: 'Continue after restarting.' })
  await fs.mkdir(created.workspace.path, { recursive: true })
  await fs.writeFile(path.join(created.workspace.path, 'restored.md'), 'durable')
  await first.dispatch({
    workId: created.workId,
    command: { type: 'submit-turn', instruction: 'Produce the durable result.' },
  })
  const beforeRestart = await first.dispatch({
    workId: created.workId,
    command: { type: 'record-file', path: 'restored.md' },
  })

  const recoveries: string[] = []
  const restartedHarness: HarnessWorkPort = {
    async ensureWorkspace(request) {
      recoveries.push(`workspace:${request.path}`)
      return { workspaceId: 'workspace-1', path: request.path }
    },
    async ensurePrimarySession(request) {
      recoveries.push(`session:${request.sessionId}`)
      return { sessionId: request.sessionId }
    },
    async submitTurn() {},
  }
  const restarted = createWorkController({
    workspaceRoot,
    harness: restartedHarness,
    store,
  })

  assert.deepEqual(await restarted.get(), beforeRestart)
  assert.deepEqual(recoveries, [
    `workspace:${beforeRestart.workspace.path}`,
    'session:session-restored',
  ])
  await fs.rm(workspaceRoot, { recursive: true, force: true })
})

test('continues in the same Primary Session after a failed Turn dispatch', async () => {
  const store = createMemoryWorkStore()
  let attempt = 0
  const requestIds = ['request-failed', 'request-continued']
  const sessionIds: string[] = []
  const harness: HarnessWorkPort = {
    async ensureWorkspace(request) {
      return { workspaceId: 'workspace-continue', path: request.path }
    },
    async ensurePrimarySession(request) {
      return { sessionId: request.sessionId }
    },
    async submitTurn(request) {
      sessionIds.push(request.sessionId)
      attempt++
      if (attempt === 1) throw new Error('upstream detail must not be persisted')
    },
  }
  const first = createWorkController({
    createId: () => 'work-continue',
    createSessionId: () => 'session-continue',
    createRequestId: () => requestIds.shift()!,
    workspaceRoot: '/managed',
    harness,
    store,
  })
  const created = await first.create({ title: 'Continue', goal: 'Recover without losing context.' })

  await assert.rejects(
    first.dispatch({
      workId: created.workId,
      command: { type: 'submit-turn', instruction: 'Attempt the work.' },
    }),
    (error: unknown) => error instanceof WorkError && error.code === 'work/turn-failed',
  )
  assert.deepEqual((await first.get())?.lastFailure, {
    requestId: 'request-failed',
    message: 'Harness did not accept the Turn.',
  })

  const restarted = createWorkController({
    createRequestId: () => requestIds.shift()!,
    workspaceRoot: '/managed',
    harness,
    store,
  })
  const continued = await restarted.dispatch({
    workId: created.workId,
    command: { type: 'submit-turn', instruction: 'Continue after the failure.' },
  })

  assert.deepEqual(sessionIds, ['session-continue', 'session-continue'])
  assert.equal(continued.execution, 'idle')
  assert.equal(continued.lastFailure, null)
  assert.equal(continued.primarySession.turnCount, 1)
})

test('deduplicates a retried remote mutation without submitting the Turn twice', async () => {
  const turns: string[] = []
  const controller = createWorkController({
    createId: () => 'work-idempotent',
    createSessionId: () => 'session-idempotent',
    workspaceRoot: '/managed',
    harness: {
      ...testHarness(),
      async submitTurn(request) { turns.push(request.instruction) },
    },
  })
  const created = await controller.create({ title: 'Retry', goal: 'Do not duplicate remote commands.' })
  const request = {
    workId: created.workId,
    mutationId: 'mutation-retried',
    expectedRevision: created.revision,
    command: { type: 'submit-turn' as const, instruction: 'Run exactly once.' },
  }

  const first = await controller.dispatch(request)
  const retried = await controller.dispatch(request)

  assert.deepEqual(turns, ['Run exactly once.'])
  assert.deepEqual(retried, first)
})

test('rejects a reused mutation id carrying a different command', async () => {
  const turns: string[] = []
  const controller = createWorkController({
    createId: () => 'work-mutation-collision',
    createSessionId: () => 'session-mutation-collision',
    workspaceRoot: '/managed',
    harness: {
      ...testHarness(),
      async submitTurn(request) { turns.push(request.instruction) },
    },
  })
  const created = await controller.create({ title: 'Collision', goal: 'Bind idempotency to command content.' })
  await controller.dispatch({
    workId: created.workId,
    mutationId: 'mutation-collision',
    expectedRevision: created.revision,
    command: { type: 'submit-turn', instruction: 'Original command.' },
  })

  await assert.rejects(controller.dispatch({
    workId: created.workId,
    mutationId: 'mutation-collision',
    expectedRevision: created.revision,
    command: { type: 'submit-turn', instruction: 'Different command.' },
  }), (error: unknown) => error instanceof WorkError && error.code === 'work/mutation-conflict')
  assert.deepEqual(turns, ['Original command.'])
})

test('serializes concurrent remote mutations and rejects the stale revision', async () => {
  let release: (() => void) | undefined
  const entered = new Promise<void>(resolve => { release = resolve })
  let unblock: (() => void) | undefined
  const blocked = new Promise<void>(resolve => { unblock = resolve })
  const turns: string[] = []
  const controller = createWorkController({
    createId: () => 'work-leased',
    createSessionId: () => 'session-leased',
    workspaceRoot: '/managed',
    harness: {
      ...testHarness(),
      async submitTurn(request) {
        turns.push(request.instruction)
        release?.()
        await blocked
      },
    },
  })
  const created = await controller.create({ title: 'Lease', goal: 'Accept one concurrent mutation.' })
  const first = controller.dispatch({
    workId: created.workId,
    mutationId: 'mutation-first',
    expectedRevision: created.revision,
    command: { type: 'submit-turn', instruction: 'First client.' },
  })
  await entered
  const second = controller.dispatch({
    workId: created.workId,
    mutationId: 'mutation-second',
    expectedRevision: created.revision,
    command: { type: 'submit-turn', instruction: 'Second client.' },
  })
  unblock?.()
  await first

  await assert.rejects(second, (error: unknown) =>
    error instanceof WorkError && error.code === 'work/mutation-conflict')
  assert.deepEqual(turns, ['First client.'])
})
