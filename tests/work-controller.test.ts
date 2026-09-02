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
    resources: [],
    deliverable: null,
    status: 'working',
    execution: 'idle',
    lastFailure: null,
    lastMutationId: null,
    lastMutationDigest: null,
    importSource: null,
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

test('imports readable conversation content into a new managed Work without persisting a second transcript', async () => {
  const turns: Array<{ requestId: string; sessionId: string; instruction: string }> = []
  const store = createMemoryWorkStore()
  const controller = createWorkController({
    createId: () => 'work-imported',
    createSessionId: () => 'session-imported',
    createRequestId: () => 'request-imported',
    now: () => '2026-09-02T08:00:00.000Z',
    workspaceRoot: '/managed',
    store,
    harness: {
      ...testHarness(),
      async submitTurn(request) { turns.push(request) },
    },
  })
  const source = Object.freeze({
    sourceSystem: 'dsh-desktop' as const,
    sourceSessionId: 'external-session-1',
    sourceVersion: '0.1.2-alpha.2',
    content: 'User: Prepare a launch brief.\nAssistant: I drafted an outline.',
  })

  const imported = await controller.importConversation({
    title: 'Continue launch brief',
    goal: 'Finish the launch brief and produce a reviewable file.',
    source,
  })

  assert.equal(imported.workId, 'work-imported')
  assert.equal(imported.revision, 2)
  assert.deepEqual(imported.primarySession, { sessionId: 'session-imported', turnCount: 1 })
  assert.deepEqual(imported.importSource, {
    sourceSystem: 'dsh-desktop',
    sourceSessionId: 'external-session-1',
    sourceVersion: '0.1.2-alpha.2',
    importedAt: '2026-09-02T08:00:00.000Z',
    contentDigest: '357967653b4cf3ab9871362d9520e03ca1f0fe164c4b10b93af37156ebac1180',
  })
  assert.deepEqual(source, {
    sourceSystem: 'dsh-desktop',
    sourceSessionId: 'external-session-1',
    sourceVersion: '0.1.2-alpha.2',
    content: 'User: Prepare a launch brief.\nAssistant: I drafted an outline.',
  })
  assert.equal(turns.length, 1)
  assert.equal(turns[0]?.sessionId, 'session-imported')
  assert.match(turns[0]?.instruction ?? '', /仅作为参考上下文/u)
  assert.match(turns[0]?.instruction ?? '', /Prepare a launch brief/u)
  const persisted = await store.load()
  assert.equal(JSON.stringify(persisted).includes('I drafted an outline'), false)
})

test('rejects empty or oversized conversation imports before provisioning a Work', async () => {
  let workspaceCalls = 0
  const controller = createWorkController({
    workspaceRoot: '/managed',
    harness: {
      ...testHarness(),
      async ensureWorkspace(request) {
        workspaceCalls++
        return { workspaceId: 'workspace-import-validation', path: request.path }
      },
    },
  })

  for (const content of ['', 'x'.repeat(100_001)]) {
    await assert.rejects(controller.importConversation({
      title: 'Invalid import',
      goal: 'Do not provision.',
      source: { sourceSystem: 'other', content },
    }), (error: unknown) => error instanceof WorkError && error.code === 'work/import-invalid')
  }
  assert.equal(workspaceCalls, 0)
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

test('serializes new Work creation against conversation import provisioning', async () => {
  let releaseWorkspace!: () => void
  const workspaceBlocked = new Promise<void>(resolve => { releaseWorkspace = resolve })
  let enteredWorkspace!: () => void
  const workspaceEntered = new Promise<void>(resolve => { enteredWorkspace = resolve })
  let workspaceCalls = 0
  const controller = createWorkController({
    createId: () => 'work-provisioned-once',
    createSessionId: () => 'session-provisioned-once',
    workspaceRoot: '/managed',
    harness: {
      ...testHarness(),
      async ensureWorkspace(request) {
        workspaceCalls++
        enteredWorkspace()
        await workspaceBlocked
        return { workspaceId: 'workspace-provisioned-once', path: request.path }
      },
    },
  })

  const create = controller.create({ title: 'First command', goal: 'Win the creation lease.' })
  await workspaceEntered
  const imported = controller.importConversation({
    title: 'Concurrent import',
    goal: 'Must not provision a second aggregate.',
    source: { sourceSystem: 'other', content: 'Existing conversation.' },
  })
  releaseWorkspace()

  await create
  await assert.rejects(imported, (error: unknown) =>
    error instanceof WorkError && error.code === 'work/already-exists')
  assert.equal(workspaceCalls, 1)
  assert.equal((await controller.get())?.title, 'First command')
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

test('waits for the correlated completed Turn through the public Session follow stream', async () => {
  const calls: string[] = []
  const harness = createHarnessWorkPort({
    workspaceRegistry: {
      async create(workspacePath) { return { id: 'workspace-follow', path: workspacePath } },
    },
    sessionController: {
      async create(request) { return { sessionId: request.sessionId } },
      async prompt(request) {
        calls.push(`prompt:${request.requestId}`)
        return { accepted: true as const }
      },
      async *follow(request) {
        calls.push(`follow:${request.address.sessionId}`)
        yield { type: 'snapshot' }
        yield {
          type: 'event',
          event: {
            type: 'user/message',
            data: { source: { kind: 'user', rpcId: 'request-follow' } },
          },
        }
        yield { type: 'event', event: { type: 'turn/start', data: { turn: 4 } } }
        yield {
          type: 'event',
          event: { type: 'turn/end', data: { turn: 4, reason: { kind: 'completed' } } },
        }
      },
    },
  })

  await harness.submitTurn({
    requestId: 'request-follow',
    sessionId: 'session-follow',
    instruction: 'Produce Markdown.',
    waitForCompletion: true,
  })

  assert.deepEqual(calls, ['follow:session-follow', 'prompt:request-follow'])
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

test('imports selected file bytes into the managed Workspace as a Work resource', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-resource-'))
  const controller = createWorkController({
    createId: () => 'work-resource',
    createSessionId: () => 'session-resource',
    workspaceRoot,
    harness: testHarness(),
  })
  const created = await controller.create({ title: 'Resource', goal: 'Use the selected brief.' })
  await fs.mkdir(created.workspace.path, { recursive: true })

  const updated = await controller.dispatch({
    workId: created.workId,
    command: {
      type: 'add-file-resource',
      name: 'launch brief.txt',
      mediaType: 'text/plain',
      dataBase64: Buffer.from('trusted launch facts\n').toString('base64'),
    },
  })

  assert.deepEqual(updated.resources, [{
    resourceId: 'cd53702d2de9122ad190868a5ef52b22ca85f5eb67f06dc483c2c21958e92686',
    kind: 'file',
    name: 'launch brief.txt',
    path: 'resources/cd53702d2de9122ad190868a5ef52b22/launch brief.txt',
    bytes: 21,
    mediaType: 'text/plain',
    contentDigest: 'f03ff5595dc46c98228725abb9339077faaa993f5acdb365dd0bf81a7b9b932c',
  }])
  assert.equal(
    await fs.readFile(path.join(created.workspace.path, updated.resources[0]!.path), 'utf8'),
    'trusted launch facts\n',
  )
  assert.equal(updated.primarySession.turnCount, 0)
  assert.equal(updated.status, 'working')
  await fs.rm(workspaceRoot, { recursive: true, force: true })
})

test('rejects unsafe file resource names, malformed base64, and oversized bytes before writing', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-resource-invalid-'))
  const controller = createWorkController({
    createId: () => 'work-resource-invalid',
    createSessionId: () => 'session-resource-invalid',
    workspaceRoot,
    harness: testHarness(),
  })
  const created = await controller.create({ title: 'Invalid resource', goal: 'Reject unsafe bytes.' })
  await fs.mkdir(created.workspace.path, { recursive: true })
  const invalidCommands = [
    { type: 'add-file-resource' as const, name: '../outside.txt', dataBase64: 'dGVzdA==' },
    { type: 'add-file-resource' as const, name: 'bad.txt', dataBase64: 'not base64!' },
    {
      type: 'add-file-resource' as const,
      name: 'too-large.bin',
      dataBase64: Buffer.alloc(25 * 1024 * 1024 + 1).toString('base64'),
    },
  ]

  for (const command of invalidCommands) {
    await assert.rejects(controller.dispatch({ workId: created.workId, command }),
      (error: unknown) => error instanceof WorkError && error.code === 'work/resource-invalid')
  }
  assert.deepEqual((await controller.get())?.resources, [])
  await assert.rejects(fs.stat(path.join(created.workspace.path, 'resources')), { code: 'ENOENT' })
  await fs.rm(workspaceRoot, { recursive: true, force: true })
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

test('produces and registers one Markdown deliverable through the Primary Session', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-produce-markdown-'))
  let managedPath = ''
  const turns: Array<{ instruction: string; waitForCompletion?: boolean }> = []
  const controller = createWorkController({
    createId: () => 'work-markdown',
    createSessionId: () => 'session-markdown',
    createRequestId: () => 'request-markdown',
    workspaceRoot,
    harness: {
      ...testHarness(),
      async ensureWorkspace(request) {
        managedPath = request.path
        await fs.mkdir(request.path, { recursive: true })
        return { workspaceId: 'workspace-markdown', path: request.path }
      },
      async submitTurn(request) {
        turns.push(request)
        await fs.mkdir(path.join(managedPath, 'deliverables'), { recursive: true })
        await fs.writeFile(path.join(managedPath, 'deliverables', 'result.md'), '# Launch brief\n\nReady.')
      },
    },
  })
  const created = await controller.create({ title: 'Markdown', goal: 'Produce the launch brief.' })
  const withResource = await controller.dispatch({
    workId: created.workId,
    command: {
      type: 'add-file-resource',
      name: 'brief.txt',
      mediaType: 'text/plain',
      dataBase64: Buffer.from('source material').toString('base64'),
    },
  })

  const produced = await controller.dispatch({
    workId: created.workId,
    command: { type: 'produce-markdown', instruction: 'Draft a concise launch brief.' },
  })

  assert.equal(turns.length, 1)
  assert.equal(turns[0]?.waitForCompletion, true)
  assert.match(turns[0]?.instruction ?? '', /deliverables\/result\.md/u)
  assert.match(turns[0]?.instruction ?? '', new RegExp(withResource.resources[0]!.path.replace('.', '\\.')))
  assert.deepEqual(produced.deliverable, { kind: 'file', path: 'deliverables/result.md' })
  assert.equal(produced.primarySession.turnCount, 1)
  assert.equal(produced.status, 'awaiting-review')
  assert.equal(produced.execution, 'idle')
  await fs.rm(workspaceRoot, { recursive: true, force: true })
})

test('rejects a completed production Turn that did not create the Markdown deliverable', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-missing-markdown-'))
  const controller = createWorkController({
    createId: () => 'work-missing-markdown',
    createSessionId: () => 'session-missing-markdown',
    workspaceRoot,
    harness: testHarness(),
  })
  const created = await controller.create({ title: 'Missing Markdown', goal: 'Produce a result.' })
  await fs.mkdir(created.workspace.path, { recursive: true })

  await assert.rejects(controller.dispatch({
    workId: created.workId,
    command: { type: 'produce-markdown', instruction: 'Create the result.' },
  }), (error: unknown) => error instanceof WorkError && error.code === 'work/deliverable-invalid')
  assert.equal((await controller.get())?.deliverable, null)
  assert.equal((await controller.get())?.execution, 'failed')
  await fs.rm(workspaceRoot, { recursive: true, force: true })
})

test('rejects a non-Markdown file as the first-phase deliverable', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-non-markdown-'))
  const controller = createWorkController({
    createId: () => 'work-non-markdown',
    createSessionId: () => 'session-non-markdown',
    workspaceRoot,
    harness: testHarness(),
  })
  const created = await controller.create({ title: 'Markdown only', goal: 'Keep the first output simple.' })
  await fs.mkdir(created.workspace.path, { recursive: true })
  await fs.writeFile(path.join(created.workspace.path, 'result.txt'), 'not markdown')

  await assert.rejects(controller.dispatch({
    workId: created.workId,
    command: { type: 'record-file', path: 'result.txt' },
  }), (error: unknown) => error instanceof WorkError && error.code === 'work/deliverable-invalid')
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
