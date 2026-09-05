import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  WorkError,
  MAX_WORK_FILE_RESOURCE_BYTES,
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

test('hands an approved delivery directory to the public native path opener', async () => {
  const opened: string[] = []
  const harness = createHarnessWorkPort({
    workspaceRegistry: {
      async create(workspacePath) { return { id: 'workspace-open', path: workspacePath } },
    },
    sessionController: {
      async create(request) { return { sessionId: request.sessionId } },
      async prompt() { return { accepted: true as const } },
      async openWorkspacePath(request) {
        opened.push(request.path)
        return { opened: true as const }
      },
    },
  })

  await harness.openPath!('/managed/deliveries/work-1')

  assert.deepEqual(opened, ['/managed/deliveries/work-1'])
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
  let workspaceEnsures = 0
  const controller = createWorkController({
    createId: () => 'work-resource',
    createSessionId: () => 'session-resource',
    workspaceRoot,
    harness: {
      ...testHarness(),
      async ensureWorkspace(request) {
        workspaceEnsures += 1
        return { workspaceId: 'workspace-1', path: request.path }
      },
    },
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
  assert.equal(workspaceEnsures, 1)
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

test('reads the Markdown deliverable and revises the same file through natural language', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-revise-markdown-'))
  let managedPath = ''
  const turns: string[] = []
  const controller = createWorkController({
    createId: () => 'work-revise-markdown',
    createSessionId: () => 'session-revise-markdown',
    createRequestId: () => 'request-revise-markdown',
    workspaceRoot,
    harness: {
      ...testHarness(),
      async ensureWorkspace(request) {
        managedPath = request.path
        await fs.mkdir(request.path, { recursive: true })
        return { workspaceId: 'workspace-revise-markdown', path: request.path }
      },
      async submitTurn(request) {
        turns.push(request.instruction)
        await fs.writeFile(
          path.join(managedPath, 'deliverables', 'result.md'),
          '# Revised launch brief\n\n- Add owners\n- Add dates\n',
        )
      },
    },
  })
  const created = await controller.create({ title: 'Revise Markdown', goal: 'Prepare a clear launch brief.' })
  await fs.mkdir(path.join(created.workspace.path, 'deliverables'), { recursive: true })
  await fs.writeFile(path.join(created.workspace.path, 'deliverables', 'result.md'), '# First draft\n')
  const recorded = await controller.dispatch({
    workId: created.workId,
    command: { type: 'record-file', path: 'deliverables/result.md' },
  })

  const before = await controller.readDeliverable(created.workId)
  const revised = await controller.dispatch({
    workId: created.workId,
    command: { type: 'revise-markdown', instruction: 'Add a clear owner and date to every action.' },
  })
  const after = await controller.readDeliverable(created.workId)

  assert.equal(before.content, '# First draft\n')
  assert.equal(before.path, 'deliverables/result.md')
  assert.match(before.contentDigest, /^[a-f0-9]{64}$/u)
  assert.match(turns[0] ?? '', /Add a clear owner and date/u)
  assert.match(turns[0] ?? '', /deliverables\/result\.md/u)
  assert.equal(revised.deliverable?.path, recorded.deliverable?.path)
  assert.equal(revised.status, 'awaiting-review')
  assert.equal(revised.primarySession.turnCount, 1)
  assert.match(after.content, /Revised launch brief/u)
  assert.notEqual(after.contentDigest, before.contentDigest)
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
  const deliveryRoot = path.join(workspaceRoot, 'exports')
  const opened: string[] = []
  const controller = createWorkController({
    createId: () => 'work-status',
    createSessionId: () => 'session-status',
    workspaceRoot,
    deliveryRoot,
    harness: {
      ...testHarness(),
      async openPath(target) { opened.push(target) },
    },
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
  const exportDirectories = await fs.readdir(deliveryRoot)
  assert.equal(exportDirectories.length, 1)
  const exportDirectory = path.join(deliveryRoot, exportDirectories[0]!)
  const exportedFiles = await fs.readdir(exportDirectory)
  assert.deepEqual(exportedFiles, ['Status.md'])
  assert.equal(await fs.readFile(path.join(exportDirectory, 'Status.md'), 'utf8'), 'ready')

  await controller.showDelivery(created.workId)

  assert.deepEqual(opened, [await fs.realpath(exportDirectory)])
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

test('does not overwrite different bytes at the managed delivery path', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-delivery-conflict-'))
  const deliveryRoot = path.join(workspaceRoot, 'exports')
  const controller = createWorkController({
    createId: () => 'work-delivery-conflict',
    createSessionId: () => 'session-delivery-conflict',
    workspaceRoot,
    deliveryRoot,
    harness: testHarness(),
  })
  const created = await controller.create({ title: 'Conflict', goal: 'Never overwrite another export.' })
  await fs.mkdir(created.workspace.path, { recursive: true })
  await fs.writeFile(path.join(created.workspace.path, 'result.md'), 'accepted bytes')
  const review = await controller.dispatch({
    workId: created.workId,
    command: { type: 'record-file', path: 'result.md' },
  })
  const completed = await controller.dispatch({
    workId: created.workId,
    command: { type: 'complete' },
  })
  const deliveryDirectory = path.join(
    deliveryRoot,
    createHash('sha256').update(created.workId).digest('hex').slice(0, 32),
  )
  await fs.mkdir(deliveryDirectory, { recursive: true })
  await fs.writeFile(path.join(deliveryDirectory, 'Conflict.md'), 'different bytes')

  await assert.rejects(controller.dispatch({
    workId: created.workId,
    command: { type: 'deliver' },
  }), (error: unknown) => error instanceof WorkError && error.code === 'work/delivery-failed')

  assert.equal((await controller.get())?.status, 'completed')
  assert.equal(await fs.readFile(path.join(deliveryDirectory, 'Conflict.md'), 'utf8'), 'different bytes')
  assert.equal(review.status, 'awaiting-review')
  assert.equal(completed.status, 'completed')
  await fs.rm(workspaceRoot, { recursive: true, force: true })
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

  await Promise.all([restarted.initialize(), restarted.initialize()])
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

test('publishes immutable Session output versions and reads historical bytes after restart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-session-versions-'))
  const workspace = path.join(root, 'workspace')
  const versionRoot = path.join(root, 'versions')
  await fs.mkdir(workspace)
  const events: unknown[] = []
  const addCompletedWrite = (turn: number, firstSeq: number, content: string): void => {
    const callId = `write-${String(turn)}`
    events.push(
      { seq: firstSeq, type: 'tool/call', data: {
        turn, callId, name: 'write',
        arguments: JSON.stringify({ file_path: 'report.md', content }),
      } },
      { seq: firstSeq + 1, type: 'tool/result', surfaceOp: 'append', data: {
        turn,
        message: { source: { callId }, content: [{ type: 'tool-result', isError: false }] },
      } },
      { seq: firstSeq + 2, type: 'turn/end', data: { turn, reason: { kind: 'completed' } } },
    )
  }
  const harness: HarnessWorkPort = {
    ...testHarness(),
    async inspectSession() { return { cwd: workspace, events } },
    async inspectSessionWorkspace() { return workspace },
  }
  const times = [
    '2026-09-06T01:00:00.000Z',
    '2026-09-06T01:00:30.000Z',
    '2026-09-06T01:01:00.000Z',
  ]
  const controller = createWorkController({
    workspaceRoot: path.join(root, 'managed'),
    sessionOutputVersionRoot: versionRoot,
    now: () => times.shift()!,
    harness,
  })

  await fs.writeFile(path.join(workspace, 'report.md'), '# Version one\n')
  addCompletedWrite(1, 1, '# Version one\n')
  await controller.inspectSessionOutputs({ sessionId: 'session-versioned', turn: 1, throughSeq: 2 })
  const first = await controller.listSessionOutputVersions({
    sessionId: 'session-versioned', path: 'report.md',
  })
  assert.equal(first.length, 1)
  assert.equal(first[0]?.origin, 'generated')
  assert.equal(first[0]?.ordinal, 1)
  assert.equal(first[0]?.contentDigest, createHash('sha256').update('# Version one\n').digest('hex'))
  await fs.writeFile(path.join(workspace, 'report.md'), '# Drift after publication\n')
  await controller.inspectSessionOutputs({ sessionId: 'session-versioned', turn: 1, throughSeq: 3 })
  const retried = await controller.listSessionOutputVersions({
    sessionId: 'session-versioned', path: 'report.md',
  })
  assert.equal(retried.length, 1)
  assert.equal((await controller.readSessionOutputVersion({
    fileId: retried[0]!.fileId, versionId: retried[0]!.versionId,
  })).content, '# Version one\n')

  await fs.writeFile(path.join(workspace, 'report.md'), '# Version two\n')
  addCompletedWrite(2, 4, '# Version two\n')
  await controller.inspectSessionOutputs({ sessionId: 'session-versioned', turn: 2, throughSeq: 5 })
  const versions = await controller.listSessionOutputVersions({
    sessionId: 'session-versioned', path: 'report.md',
  })
  assert.equal(versions.length, 2)
  assert.deepEqual(versions.map(version => version.ordinal), [1, 2])
  assert.notEqual(versions[0]?.versionId, versions[1]?.versionId)
  assert.deepEqual((await controller.readSessionOutputVersion({
    fileId: versions[0]!.fileId,
    versionId: versions[0]!.versionId,
  })).content, '# Version one\n')

  await assert.rejects(controller.prepareSessionOutputRevision({
    sessionId: 'other-session', turn: 2, throughSeq: 6, path: 'report.md',
    baseVersion: { fileId: versions[0]!.fileId, versionId: versions[0]!.versionId },
  }), (error: unknown) => error instanceof WorkError && error.code === 'work/session-output-invalid')
  const revision = await controller.prepareSessionOutputRevision({
    sessionId: 'session-versioned', turn: 2, throughSeq: 6, path: 'report.md',
    baseVersion: { fileId: versions[0]!.fileId, versionId: versions[0]!.versionId },
  })
  assert.equal(revision.contentDigest, versions[1]!.contentDigest)
  assert.deepEqual(revision.baseVersion, {
    fileId: versions[0]!.fileId,
    versionId: versions[0]!.versionId,
    ordinal: 1,
    path: `attachment-${createHash('sha256').update('session-versioned').digest('hex').slice(0, 12)}-${versions[0]!.contentDigest.slice(0, 12)}-version-${versions[0]!.fileId.slice(0, 8)}-v1-${versions[0]!.contentDigest.slice(0, 12)}.md`,
    reference: `@attachment-${createHash('sha256').update('session-versioned').digest('hex').slice(0, 12)}-${versions[0]!.contentDigest.slice(0, 12)}-version-${versions[0]!.fileId.slice(0, 8)}-v1-${versions[0]!.contentDigest.slice(0, 12)}.md`,
    contentDigest: versions[0]!.contentDigest,
  })
  assert.equal(await fs.readFile(path.join(workspace, revision.baseVersion!.path), 'utf8'), '# Version one\n')
  assert.equal(await fs.readFile(path.join(workspace, 'report.md'), 'utf8'), '# Version two\n')
  assert.equal((await controller.listSessionOutputVersions({
    sessionId: 'session-versioned', path: 'report.md',
  })).length, 2)

  const restarted = createWorkController({
    workspaceRoot: path.join(root, 'managed'),
    sessionOutputVersionRoot: versionRoot,
    harness,
  })
  assert.deepEqual(await restarted.listSessionOutputVersions({
    sessionId: 'session-versioned', path: 'report.md',
  }), versions)
  assert.equal((await restarted.readSessionOutputVersion({
    fileId: versions[1]!.fileId,
    versionId: versions[1]!.versionId,
  })).content, '# Version two\n')
  await fs.rm(root, { recursive: true, force: true })
})

test('rejects invalid revision version identities before inspecting Session or journal paths', async () => {
  let inspections = 0
  const controller = createWorkController({
    workspaceRoot: '/managed',
    sessionOutputVersionRoot: '/versions',
    harness: {
      ...testHarness(),
      async inspectSession() {
        inspections++
        throw new Error('must not inspect')
      },
    },
  })

  await assert.rejects(controller.prepareSessionOutputRevision({
    sessionId: 'session-invalid-version', turn: 1, throughSeq: 2, path: 'report.md',
    baseVersion: { fileId: '../escape', versionId: 'b'.repeat(32) },
  }), (error: unknown) => error instanceof WorkError && error.code === 'work/session-output-invalid')
  assert.equal(inspections, 0)
})

test('publishes no incomplete version and recovers an interrupted immutable record', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-session-version-recovery-'))
  const workspace = path.join(root, 'workspace')
  const versionRoot = path.join(root, 'versions')
  await fs.mkdir(workspace)
  await fs.writeFile(path.join(workspace, 'report.md'), '# Recover me\n')
  const events: unknown[] = [
    { seq: 1, type: 'tool/call', data: {
      turn: 1, callId: 'write', name: 'write',
      arguments: JSON.stringify({ file_path: 'report.md', content: '# Recover me\n' }),
    } },
    { seq: 2, type: 'tool/result', surfaceOp: 'append', data: {
      turn: 1,
      message: { source: { callId: 'write' }, content: [{ type: 'tool-result', isError: false }] },
    } },
  ]
  const harness: HarnessWorkPort = {
    ...testHarness(),
    async inspectSession() { return { cwd: workspace, events } },
    async inspectSessionWorkspace() { return workspace },
  }
  let interrupt = true
  const interrupted = createWorkController({
    workspaceRoot: path.join(root, 'managed'),
    sessionOutputVersionRoot: versionRoot,
    harness,
    sessionOutputVersionInternals: {
      afterBlobPublish() {
        if (!interrupt) return
        interrupt = false
        throw new Error('injected interruption')
      },
    },
  })
  const spec = { sessionId: 'session-recovery', turn: 1, throughSeq: 2 }

  assert.deepEqual(await interrupted.inspectSessionOutputs(spec), [])
  assert.deepEqual(await interrupted.listSessionOutputVersions({
    sessionId: spec.sessionId, path: 'report.md',
  }), [])
  events.push({ seq: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  await assert.rejects(interrupted.inspectSessionOutputs(spec), (error: unknown) =>
    error instanceof WorkError && error.code === 'work/session-output-version-failed')
  const recordEntries = await fs.readdir(path.join(versionRoot, 'records'), { recursive: true })
  assert.equal(recordEntries.some(entry => entry.endsWith('.json')), false)

  const recovered = createWorkController({
    workspaceRoot: path.join(root, 'managed'),
    sessionOutputVersionRoot: versionRoot,
    harness,
  })
  const versions = await recovered.listSessionOutputVersions({
    sessionId: spec.sessionId, path: 'report.md',
  })
  assert.equal(versions.length, 1)
  await recovered.inspectSessionOutputs(spec)
  assert.equal((await recovered.listSessionOutputVersions({
    sessionId: spec.sessionId, path: 'report.md',
  })).length, 1)
  assert.ok((await fs.readdir(path.join(versionRoot, 'intents', versions[0]!.fileId)))
    .some(name => name.endsWith('.pending')))
  await fs.rm(root, { recursive: true, force: true })
})

test('recovers a published capsule and ignores a pre-publication pending file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-session-version-pending-'))
  const workspace = path.join(root, 'workspace')
  const versionRoot = path.join(root, 'versions')
  await fs.mkdir(workspace)
  await fs.writeFile(path.join(workspace, 'report.md'), '# Pending recovery\n')
  const events: unknown[] = [
    { seq: 1, type: 'tool/call', data: {
      turn: 1, callId: 'write', name: 'write',
      arguments: JSON.stringify({ file_path: 'report.md', content: '# Pending recovery\n' }),
    } },
    { seq: 2, type: 'tool/result', surfaceOp: 'append', data: {
      turn: 1,
      message: { source: { callId: 'write' }, content: [{ type: 'tool-result', isError: false }] },
    } },
    { seq: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  const harness: HarnessWorkPort = {
    ...testHarness(),
    async inspectSession() { return { cwd: workspace, events: [...events] } },
    async inspectSessionWorkspace() { return workspace },
  }
  let interruptBeforeIntentLink = true
  const beforeLink = createWorkController({
    workspaceRoot: path.join(root, 'managed'), sessionOutputVersionRoot: versionRoot, harness,
    sessionOutputVersionInternals: {
      afterPendingWrite({ targetPath }) {
        if (!interruptBeforeIntentLink) return
        interruptBeforeIntentLink = false
        throw new Error('interrupt before intent link')
      },
    },
  })
  await assert.rejects(beforeLink.inspectSessionOutputs({
    sessionId: 'session-pending', turn: 1, throughSeq: 2,
  }))
  const pendingFileIds = await fs.readdir(path.join(versionRoot, 'intents'))
  assert.equal(pendingFileIds.length, 1)
  assert.ok((await fs.readdir(path.join(versionRoot, 'intents', pendingFileIds[0]!)))
    .some(name => name.endsWith('.pending')))

  let interruptAfterIntent = true
  const afterIntent = createWorkController({
    workspaceRoot: path.join(root, 'managed'), sessionOutputVersionRoot: versionRoot, harness,
    sessionOutputVersionInternals: {
      afterIntentPublish() {
        if (!interruptAfterIntent) return
        interruptAfterIntent = false
        throw new Error('interrupt after intent publication')
      },
    },
  })
  await assert.rejects(afterIntent.inspectSessionOutputs({
    sessionId: 'session-pending', turn: 1, throughSeq: 2,
  }))
  const recovered = createWorkController({
    workspaceRoot: path.join(root, 'managed'), sessionOutputVersionRoot: versionRoot, harness,
  })
  const [version] = await recovered.listSessionOutputVersions({
    sessionId: 'session-pending', path: 'report.md',
  })
  assert.ok(version)
  assert.equal((await recovered.readSessionOutputVersion({
    fileId: version.fileId, versionId: version.versionId,
  })).content, '# Pending recovery\n')
  await fs.rm(root, { recursive: true, force: true })
})

test('guards journal directories while recovering a published intent', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-session-version-recovery-swap-'))
  const workspace = path.join(root, 'workspace')
  const versionRoot = path.join(root, 'versions')
  await fs.mkdir(workspace)
  await fs.writeFile(path.join(workspace, 'report.md'), '# Recovery guard\n')
  const events: readonly unknown[] = Object.freeze([
    { seq: 1, type: 'tool/call', data: {
      turn: 1, callId: 'write', name: 'write',
      arguments: JSON.stringify({ file_path: 'report.md', content: '# Recovery guard\n' }),
    } },
    { seq: 2, type: 'tool/result', surfaceOp: 'append', data: {
      turn: 1,
      message: { source: { callId: 'write' }, content: [{ type: 'tool-result', isError: false }] },
    } },
    { seq: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ])
  const harness: HarnessWorkPort = {
    ...testHarness(),
    async inspectSession() { return { cwd: workspace, events: [...events] } },
    async inspectSessionWorkspace() { return workspace },
  }
  const interrupted = createWorkController({
    workspaceRoot: path.join(root, 'managed'), sessionOutputVersionRoot: versionRoot, harness,
    sessionOutputVersionInternals: { afterIntentPublish() { throw new Error('retain intent') } },
  })
  await assert.rejects(interrupted.inspectSessionOutputs({
    sessionId: 'session-recovery-swap', turn: 1, throughSeq: 2,
  }))

  let swapped = false
  const recovering = createWorkController({
    workspaceRoot: path.join(root, 'managed'), sessionOutputVersionRoot: versionRoot, harness,
    sessionOutputVersionInternals: {
      async afterPendingOpen({ targetPath }) {
        if (swapped) return
        swapped = true
        await fs.rename(path.join(versionRoot, 'blobs'), path.join(versionRoot, 'blobs-original'))
        await fs.mkdir(path.join(versionRoot, 'blobs'))
        await fs.writeFile(path.join(versionRoot, 'blobs', 'sentinel'), 'replacement untouched')
      },
    },
  })
  await assert.rejects(recovering.listSessionOutputVersions({
    sessionId: 'session-recovery-swap', path: 'report.md',
  }), (error: unknown) => error instanceof WorkError
    && error.code === 'work/session-output-version-failed')
  assert.equal(await fs.readFile(path.join(versionRoot, 'blobs', 'sentinel'), 'utf8'), 'replacement untouched')
  await fs.rm(root, { recursive: true, force: true })
})

test('fails closed when the version journal is linked or replaced during publication', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-session-version-swap-'))
  const workspace = path.join(root, 'workspace')
  const versionRoot = path.join(root, 'versions')
  await fs.mkdir(workspace)
  await fs.writeFile(path.join(workspace, 'report.md'), '# Guard journal\n')
  const events: unknown[] = [
    { seq: 1, type: 'tool/call', data: {
      turn: 1, callId: 'write', name: 'write',
      arguments: JSON.stringify({ file_path: 'report.md', content: '# Guard journal\n' }),
    } },
    { seq: 2, type: 'tool/result', surfaceOp: 'append', data: {
      turn: 1,
      message: { source: { callId: 'write' }, content: [{ type: 'tool-result', isError: false }] },
    } },
    { seq: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  const harness: HarnessWorkPort = {
    ...testHarness(),
    async inspectSession() { return { cwd: workspace, events } },
    async inspectSessionWorkspace() { return workspace },
  }
  let replaced = false
  const controller = createWorkController({
    workspaceRoot: path.join(root, 'managed'),
    sessionOutputVersionRoot: versionRoot,
    harness,
    sessionOutputVersionInternals: {
      async afterIntentPublish() {
        if (replaced) return
        replaced = true
        await fs.rename(path.join(versionRoot, 'records'), path.join(versionRoot, 'records-original'))
        await fs.mkdir(path.join(versionRoot, 'records'))
        await fs.writeFile(path.join(versionRoot, 'records', 'sentinel'), 'replacement')
      },
    },
  })
  await assert.rejects(controller.inspectSessionOutputs({
    sessionId: 'session-swap', turn: 1, throughSeq: 2,
  }), (error: unknown) => error instanceof WorkError && error.code === 'work/session-output-version-failed')
  assert.equal(await fs.readFile(path.join(versionRoot, 'records', 'sentinel'), 'utf8'), 'replacement')

  const outside = path.join(root, 'outside')
  const linked = path.join(root, 'linked-versions')
  await fs.mkdir(outside)
  await fs.symlink(outside, linked)
  const linkedController = createWorkController({
    workspaceRoot: path.join(root, 'managed'),
    sessionOutputVersionRoot: linked,
    harness,
  })
  await assert.rejects(linkedController.inspectSessionOutputs({
    sessionId: 'session-linked', turn: 1, throughSeq: 2,
  }), (error: unknown) => error instanceof WorkError && error.code === 'work/session-output-version-failed')
  assert.deepEqual(await fs.readdir(outside), [])
  await fs.rm(root, { recursive: true, force: true })
})

test('does not write or link through a version directory replaced around a pending file', async () => {
  for (const phase of ['open', 'write'] as const) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `dsh-work-session-version-${phase}-swap-`))
    const workspace = path.join(root, 'workspace')
    const versionRoot = path.join(root, 'versions')
    await fs.mkdir(workspace)
    await fs.writeFile(path.join(workspace, 'report.md'), '# Guard pending\n')
    const events: readonly unknown[] = Object.freeze([
      { seq: 1, type: 'tool/call', data: {
        turn: 1, callId: 'write', name: 'write',
        arguments: JSON.stringify({ file_path: 'report.md', content: '# Guard pending\n' }),
      } },
      { seq: 2, type: 'tool/result', surfaceOp: 'append', data: {
        turn: 1,
        message: { source: { callId: 'write' }, content: [{ type: 'tool-result', isError: false }] },
      } },
      { seq: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ])
    let swapped = false
    const replaceIntentRoot = async ({ targetPath }: { readonly targetPath: string }): Promise<void> => {
      if (swapped) return
      swapped = true
      await fs.rename(path.join(versionRoot, 'intents'), path.join(versionRoot, 'intents-original'))
      await fs.mkdir(path.join(versionRoot, 'intents'))
      await fs.writeFile(path.join(versionRoot, 'intents', 'sentinel'), 'replacement untouched')
    }
    const controller = createWorkController({
      workspaceRoot: path.join(root, 'managed'), sessionOutputVersionRoot: versionRoot,
      harness: {
        ...testHarness(),
        async inspectSession() { return { cwd: workspace, events: [...events] } },
        async inspectSessionWorkspace() { return workspace },
      },
      sessionOutputVersionInternals: phase === 'open'
        ? { afterPendingOpen: replaceIntentRoot }
        : { afterPendingWrite: replaceIntentRoot },
    })
    await assert.rejects(controller.inspectSessionOutputs({
      sessionId: `session-${phase}-swap`, turn: 1, throughSeq: 2,
    }), (error: unknown) => error instanceof WorkError
      && error.code === 'work/session-output-version-failed')
    assert.equal(
      await fs.readFile(path.join(versionRoot, 'intents', 'sentinel'), 'utf8'),
      'replacement untouched',
    )
    assert.deepEqual(await fs.readdir(path.join(versionRoot, 'blobs')), [])
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('does not expose a record linked after its records directory is replaced', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-session-version-link-swap-'))
  const workspace = path.join(root, 'workspace')
  const versionRoot = path.join(root, 'versions')
  await fs.mkdir(workspace)
  await fs.writeFile(path.join(workspace, 'report.md'), '# Guard final link\n')
  const events: readonly unknown[] = Object.freeze([
    { seq: 1, type: 'tool/call', data: {
      turn: 1, callId: 'write', name: 'write',
      arguments: JSON.stringify({ file_path: 'report.md', content: '# Guard final link\n' }),
    } },
    { seq: 2, type: 'tool/result', surfaceOp: 'append', data: {
      turn: 1,
      message: { source: { callId: 'write' }, content: [{ type: 'tool-result', isError: false }] },
    } },
    { seq: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ])
  const harness: HarnessWorkPort = {
    ...testHarness(),
    async inspectSession() { return { cwd: workspace, events: [...events] } },
    async inspectSessionWorkspace() { return workspace },
  }
  let swapped = false
  const controller = createWorkController({
    workspaceRoot: path.join(root, 'managed'), sessionOutputVersionRoot: versionRoot, harness,
    sessionOutputVersionInternals: {
      async beforePendingLink({ pendingPath, targetPath }) {
        if (swapped || path.basename(path.dirname(path.dirname(targetPath))) !== 'records') return
        swapped = true
        const fileId = path.basename(path.dirname(targetPath))
        await fs.rename(path.join(versionRoot, 'records'), path.join(versionRoot, 'records-original'))
        const replacementDirectory = path.join(versionRoot, 'records', fileId)
        await fs.mkdir(replacementDirectory, { recursive: true })
        await fs.writeFile(path.join(replacementDirectory, path.basename(pendingPath)), 'wrong record')
      },
    },
  })
  await assert.rejects(controller.inspectSessionOutputs({
    sessionId: 'session-link-swap', turn: 1, throughSeq: 2,
  }), (error: unknown) => error instanceof WorkError
    && error.code === 'work/session-output-version-failed')
  const replacementFileId = (await fs.readdir(path.join(versionRoot, 'records')))[0]!
  const replacementEntries = await fs.readdir(path.join(versionRoot, 'records', replacementFileId))
  assert.ok(replacementEntries.some(name => /^\d{6}-[a-f0-9]{32}\.json$/u.test(name)))
  assert.equal(replacementEntries.some(name => name.endsWith('.commit')), false)
  const reader = createWorkController({
    workspaceRoot: path.join(root, 'managed'), sessionOutputVersionRoot: versionRoot, harness,
  })
  await assert.rejects(reader.listSessionOutputVersions({
    sessionId: 'session-link-swap', path: 'report.md',
  }), (error: unknown) => error instanceof WorkError
    && error.code === 'work/session-output-version-failed')
  await fs.rm(root, { recursive: true, force: true })
})

test('recovers an unconfirmed final record after interruption', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-session-version-confirmation-'))
  const workspace = path.join(root, 'workspace')
  const versionRoot = path.join(root, 'versions')
  await fs.mkdir(workspace)
  await fs.writeFile(path.join(workspace, 'report.md'), '# Confirm after restart\n')
  const events: readonly unknown[] = Object.freeze([
    { seq: 1, type: 'tool/call', data: {
      turn: 1, callId: 'write', name: 'write',
      arguments: JSON.stringify({ file_path: 'report.md', content: '# Confirm after restart\n' }),
    } },
    { seq: 2, type: 'tool/result', surfaceOp: 'append', data: {
      turn: 1,
      message: { source: { callId: 'write' }, content: [{ type: 'tool-result', isError: false }] },
    } },
    { seq: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ])
  const harness: HarnessWorkPort = {
    ...testHarness(),
    async inspectSession() { return { cwd: workspace, events: [...events] } },
    async inspectSessionWorkspace() { return workspace },
  }
  const interrupted = createWorkController({
    workspaceRoot: path.join(root, 'managed'), sessionOutputVersionRoot: versionRoot, harness,
    sessionOutputVersionInternals: { afterRecordPublish() { throw new Error('before confirmation') } },
  })
  await assert.rejects(interrupted.inspectSessionOutputs({
    sessionId: 'session-confirmation', turn: 1, throughSeq: 2,
  }))
  const fileId = (await fs.readdir(path.join(versionRoot, 'records')))[0]!
  const interruptedEntries = await fs.readdir(path.join(versionRoot, 'records', fileId))
  assert.ok(interruptedEntries.some(name => /^\d{6}-[a-f0-9]{32}\.json$/u.test(name)))
  assert.equal(interruptedEntries.some(name => name.endsWith('.commit')), false)

  const recovered = createWorkController({
    workspaceRoot: path.join(root, 'managed'), sessionOutputVersionRoot: versionRoot, harness,
  })
  const versions = await recovered.listSessionOutputVersions({
    sessionId: 'session-confirmation', path: 'report.md',
  })
  assert.equal(versions.length, 1)
  assert.ok((await fs.readdir(path.join(versionRoot, 'records', fileId)))
    .some(name => name.endsWith('.commit')))
  await fs.rm(root, { recursive: true, force: true })
})

test('does not attribute later Workspace bytes to an earlier unobserved Turn', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-session-version-frontier-'))
  const workspace = path.join(root, 'workspace')
  await fs.mkdir(workspace)
  await fs.writeFile(path.join(workspace, 'report.md'), '# Later bytes\n')
  const pair = (turn: number, seq: number, content: string) => [
    { seq, type: 'tool/call', data: {
      turn, callId: `write-${String(turn)}`, name: 'write',
      arguments: JSON.stringify({ file_path: 'report.md', content }),
    } },
    { seq: seq + 1, type: 'tool/result', surfaceOp: 'append', data: {
      turn,
      message: { source: { callId: `write-${String(turn)}` }, content: [{ type: 'tool-result', isError: false }] },
    } },
    { seq: seq + 2, type: 'turn/end', data: { turn, reason: { kind: 'completed' } } },
  ]
  const events = [
    ...pair(1, 1, '# Earlier bytes\n'),
    ...pair(2, 4, '# Later bytes\n'),
  ]
  const controller = createWorkController({
    workspaceRoot: path.join(root, 'managed'),
    sessionOutputVersionRoot: path.join(root, 'versions'),
    harness: {
      ...testHarness(),
      async inspectSession() { return { cwd: workspace, events } },
      async inspectSessionWorkspace() { return workspace },
    },
  })

  await controller.inspectSessionOutputs({ sessionId: 'session-late', turn: 1, throughSeq: 2 })
  assert.deepEqual(await controller.listSessionOutputVersions({
    sessionId: 'session-late', path: 'report.md',
  }), [])
  await controller.inspectSessionOutputs({ sessionId: 'session-late', turn: 2, throughSeq: 5 })
  const versions = await controller.listSessionOutputVersions({
    sessionId: 'session-late', path: 'report.md',
  })
  assert.equal(versions.length, 1)
  assert.equal(versions[0]?.turn, 2)
  assert.equal((await controller.readSessionOutputVersion({
    fileId: versions[0]!.fileId,
    versionId: versions[0]!.versionId,
  })).content, '# Later bytes\n')
  await fs.rm(root, { recursive: true, force: true })
})

test('reinspects the live Session frontier before publishing captured edit bytes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-session-version-live-frontier-'))
  const workspace = path.join(root, 'workspace')
  await fs.mkdir(workspace)
  await fs.writeFile(path.join(workspace, 'report.md'), '# Earlier edit\n')
  const earlierEvents: readonly unknown[] = Object.freeze([
    { seq: 1, type: 'tool/call', data: {
      turn: 1, callId: 'edit-1', name: 'edit',
      arguments: JSON.stringify({ file_path: 'report.md', old_string: 'old', new_string: 'new' }),
    } },
    { seq: 2, type: 'tool/result', surfaceOp: 'append', data: {
      turn: 1,
      message: { source: { callId: 'edit-1' }, content: [{ type: 'tool-result', isError: false }] },
    } },
    { seq: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ])
  const laterEvents: readonly unknown[] = Object.freeze([
    ...earlierEvents,
    { seq: 4, type: 'user/message', data: {
      source: { kind: 'user' }, content: [{ type: 'text', text: 'Start another edit' }],
    } },
    { seq: 5, type: 'turn/start', data: { turn: 2 } },
  ])
  let liveEvents = earlierEvents
  let advanced = false
  const controller = createWorkController({
    workspaceRoot: path.join(root, 'managed'),
    sessionOutputVersionRoot: path.join(root, 'versions'),
    harness: {
      ...testHarness(),
      async inspectSession() { return { cwd: workspace, events: [...liveEvents] } },
      async inspectSessionWorkspace() { return workspace },
    },
    sessionOutputVersionInternals: {
      async beforeOutputCapture() {
        if (advanced) return
        advanced = true
        await fs.writeFile(path.join(workspace, 'report.md'), '# Later edit\n')
        liveEvents = laterEvents
      },
    },
  })

  await controller.inspectSessionOutputs({ sessionId: 'session-live-frontier', turn: 1, throughSeq: 2 })
  assert.deepEqual(await controller.listSessionOutputVersions({
    sessionId: 'session-live-frontier', path: 'report.md',
  }), [])
  assert.equal(await fs.readFile(path.join(workspace, 'report.md'), 'utf8'), '# Later edit\n')
  await fs.rm(root, { recursive: true, force: true })
})

test('freezes verified source metadata with the generated file version', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-session-version-source-'))
  const sessionId = 'session-version-source'
  const sourceBytes = Buffer.from('# Source evidence\n')
  const sourceDigest = createHash('sha256').update(sourceBytes).digest('hex')
  const sourcePath = `attachment-${createHash('sha256').update(sessionId).digest('hex').slice(0, 12)}-${sourceDigest.slice(0, 12)}-brief.md`
  await fs.writeFile(path.join(root, sourcePath), sourceBytes)
  await fs.writeFile(path.join(root, 'report.md'), '# Report from source\n')
  const events: unknown[] = [
    { seq: 1, type: 'user/message', data: {
      source: { kind: 'user' }, content: [{ type: 'text', text: `Use @${sourcePath}` }],
    } },
    { seq: 2, type: 'turn/start', data: { turn: 1 } },
    { seq: 3, type: 'tool/call', data: {
      turn: 1, callId: 'read-source', name: 'read',
      arguments: JSON.stringify({ file_path: sourcePath }),
    } },
    { seq: 4, type: 'tool/result', surfaceOp: 'append', data: {
      turn: 1,
      message: { source: { callId: 'read-source' }, content: [{ type: 'tool-result', isError: false }] },
    } },
    { seq: 5, type: 'tool/call', data: {
      turn: 1, callId: 'write-report', name: 'write',
      arguments: JSON.stringify({ file_path: 'report.md', content: '# Report from source\n' }),
    } },
    { seq: 6, type: 'tool/result', surfaceOp: 'append', data: {
      turn: 1,
      message: { source: { callId: 'write-report' }, content: [{ type: 'tool-result', isError: false }] },
    } },
    { seq: 7, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  const controller = createWorkController({
    workspaceRoot: path.join(root, 'managed'),
    sessionOutputVersionRoot: path.join(root, 'versions'),
    harness: {
      ...testHarness(),
      async inspectSession() { return { cwd: root, events } },
      async inspectSessionWorkspace() { return root },
    },
  })

  await controller.inspectSessionOutputs({ sessionId, turn: 1, throughSeq: 6 })
  const [version] = await controller.listSessionOutputVersions({ sessionId, path: 'report.md' })
  assert.deepEqual(version?.sources.map(source => ({
    path: source.path,
    status: source.status,
    contentDigest: source.contentDigest,
  })), [{ path: sourcePath, status: 'verified', contentDigest: sourceDigest }])
  await fs.rm(root, { recursive: true, force: true })
})

test('rejects version 513 while preserving the bounded 512-record history', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-session-version-limit-'))
  const workspace = path.join(root, 'workspace')
  await fs.mkdir(workspace)
  let events: readonly unknown[] = []
  const controller = createWorkController({
    workspaceRoot: path.join(root, 'managed'),
    sessionOutputVersionRoot: path.join(root, 'versions'),
    harness: {
      ...testHarness(),
      async inspectSession() { return { cwd: workspace, events: [...events] } },
      async inspectSessionWorkspace() { return workspace },
    },
  })
  const inspectTurn = async (turn: number): Promise<void> => {
    const content = `# Version ${String(turn)}\n`
    await fs.writeFile(path.join(workspace, 'report.md'), content)
    events = Object.freeze([
      { seq: 1, type: 'tool/call', data: {
        turn, callId: `write-${String(turn)}`, name: 'write',
        arguments: JSON.stringify({ file_path: 'report.md', content }),
      } },
      { seq: 2, type: 'tool/result', surfaceOp: 'append', data: {
        turn,
        message: { source: { callId: `write-${String(turn)}` }, content: [{ type: 'tool-result', isError: false }] },
      } },
      { seq: 3, type: 'turn/end', data: { turn, reason: { kind: 'completed' } } },
    ])
    await controller.inspectSessionOutputs({ sessionId: 'session-limit', turn, throughSeq: 2 })
  }
  await inspectTurn(1)
  const [first] = await controller.listSessionOutputVersions({
    sessionId: 'session-limit', path: 'report.md',
  })
  assert.ok(first)
  const recordsDirectory = path.join(root, 'versions', 'records', first.fileId)
  for (let turn = 2; turn <= 512; turn++) {
    const versionId = createHash('sha256')
      .update(`session-output-version-v1\0${first.fileId}\0generated\0${String(turn)}\0${String(3)}`)
      .digest('hex')
      .slice(0, 32)
    const recordName = `${String(turn).padStart(6, '0')}-${versionId}.json`
    const recordBytes = Buffer.from(JSON.stringify({
        ...first,
        versionId,
        ordinal: turn,
        turn,
        createdAt: new Date(Date.UTC(2026, 8, 6, 0, 0, turn)).toISOString(),
      }))
    await fs.writeFile(path.join(recordsDirectory, recordName), recordBytes)
    const turnHex = turn.toString(16)
    const confirmationId = `${turnHex.padStart(8, '0')}-0000-4000-8000-${turnHex.padStart(12, '0')}`
    await fs.writeFile(
      path.join(recordsDirectory, `${recordName}.${confirmationId}.commit`),
      JSON.stringify({
        protocol: 1,
        recordName,
        recordDigest: createHash('sha256').update(recordBytes).digest('hex'),
      }),
    )
  }
  assert.equal((await controller.listSessionOutputVersions({
    sessionId: 'session-limit', path: 'report.md',
  })).length, 512)
  await assert.rejects(inspectTurn(513), (error: unknown) =>
    error instanceof WorkError && error.code === 'work/session-output-version-failed')
  const retained = await controller.listSessionOutputVersions({
    sessionId: 'session-limit', path: 'report.md',
  })
  assert.equal(retained.length, 512)
  assert.equal(retained.at(-1)?.ordinal, 512)
  await fs.rm(root, { recursive: true, force: true })
})

test('creates one explicit legacy baseline only from retained deliverable bytes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-session-version-baseline-'))
  const workspace = path.join(root, 'workspace')
  await fs.mkdir(path.join(workspace, 'deliverables'), { recursive: true })
  await fs.writeFile(path.join(workspace, 'deliverables', 'result.md'), '# Retained legacy result\n')
  const legacy = {
    workId: 'legacy-work', revision: 7, title: 'Legacy', goal: 'Retain actual bytes.',
    workspace: { workspaceId: 'legacy-workspace', path: workspace },
    primarySession: { sessionId: 'legacy-session', turnCount: 4 },
    resources: [], deliverable: { kind: 'file' as const, path: 'deliverables/result.md' },
    status: 'completed' as const, execution: 'idle' as const, lastFailure: null,
    lastMutationId: null, lastMutationDigest: null, importSource: null,
  }
  const harness: HarnessWorkPort = {
    ...testHarness(),
    async ensureWorkspace(request) { return { workspaceId: 'legacy-workspace', path: request.path } },
    async ensurePrimarySession(request) { return { sessionId: request.sessionId } },
    async inspectSessionWorkspace() { return workspace },
  }
  const versionRoot = path.join(root, 'versions')
  const controller = createWorkController({
    workspaceRoot: path.join(root, 'managed'),
    sessionOutputVersionRoot: versionRoot,
    store: createMemoryWorkStore(legacy),
    now: () => '2026-09-06T02:00:00.000Z',
    harness,
  })
  await controller.initialize()
  await controller.initialize()
  const versions = await controller.listSessionOutputVersions({
    sessionId: 'legacy-session', path: 'deliverables/result.md',
  })
  assert.equal(versions.length, 1)
  assert.deepEqual({
    origin: versions[0]?.origin,
    turn: versions[0]?.turn,
    throughSeq: versions[0]?.throughSeq,
  }, { origin: 'migration-baseline', turn: null, throughSeq: null })
  assert.equal((await controller.readSessionOutputVersion({
    fileId: versions[0]!.fileId,
    versionId: versions[0]!.versionId,
  })).content, '# Retained legacy result\n')

  await fs.unlink(path.join(workspace, 'deliverables', 'result.md'))
  const missing = createWorkController({
    workspaceRoot: path.join(root, 'managed'),
    sessionOutputVersionRoot: path.join(root, 'missing-versions'),
    store: createMemoryWorkStore(legacy),
    harness,
  })
  await missing.initialize()
  assert.deepEqual(await missing.listSessionOutputVersions({
    sessionId: 'legacy-session', path: 'deliverables/result.md',
  }), [])
  await fs.rm(root, { recursive: true, force: true })
})

test('does not baseline a legacy deliverable replaced during bounded capture', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-session-version-baseline-race-'))
  const workspace = path.join(root, 'workspace')
  const deliverables = path.join(workspace, 'deliverables')
  const candidate = path.join(deliverables, 'result.md')
  const retained = path.join(deliverables, 'retained.md')
  const outside = path.join(root, 'outside.md')
  await fs.mkdir(deliverables, { recursive: true })
  await fs.writeFile(candidate, '# Original legacy result\n')
  await fs.writeFile(outside, '# Outside bytes stay untouched\n')
  const legacy = {
    workId: 'legacy-race', revision: 3, title: 'Legacy race', goal: 'Reject changed bytes.',
    workspace: { workspaceId: 'legacy-race-workspace', path: workspace },
    primarySession: { sessionId: 'legacy-race-session', turnCount: 2 },
    resources: [], deliverable: { kind: 'file' as const, path: 'deliverables/result.md' },
    status: 'completed' as const, execution: 'idle' as const, lastFailure: null,
    lastMutationId: null, lastMutationDigest: null, importSource: null,
  }
  const controller = createWorkController({
    workspaceRoot: path.join(root, 'managed'),
    sessionOutputVersionRoot: path.join(root, 'versions'),
    store: createMemoryWorkStore(legacy),
    harness: {
      ...testHarness(),
      async ensureWorkspace(request) { return { workspaceId: legacy.workspace.workspaceId, path: request.path } },
      async ensurePrimarySession(request) { return { sessionId: request.sessionId } },
      async inspectSessionWorkspace() { return workspace },
    },
    sessionOutputVersionInternals: {
      async afterLegacyFirstStat() {
        await fs.rename(candidate, retained)
        await fs.symlink(outside, candidate)
      },
    },
  })

  await controller.initialize()
  assert.deepEqual(await controller.listSessionOutputVersions({
    sessionId: legacy.primarySession.sessionId, path: legacy.deliverable.path,
  }), [])
  assert.equal(await fs.readFile(outside, 'utf8'), '# Outside bytes stay untouched\n')
  await fs.rm(root, { recursive: true, force: true })
})

test('copies supported text resources into the addressed Session Workspace without changing the source', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-session-resource-'))
  const workspace = path.join(root, 'workspace')
  const source = path.join(root, 'source notes.md')
  await fs.mkdir(workspace)
  await fs.writeFile(source, '# Source stays unchanged\n')
  const before = createHash('sha256').update(await fs.readFile(source)).digest('hex')
  const controller = createWorkController({
    workspaceRoot: path.join(root, 'managed'),
    harness: {
      ...testHarness(),
      async inspectSessionWorkspace() { return workspace },
    },
  })

  const imported = await controller.importSessionResource({
    sessionId: 'session-a',
    name: 'source notes.md',
    mediaType: 'text/markdown',
    dataBase64: (await fs.readFile(source)).toString('base64'),
  })

  assert.equal(imported.sessionId, 'session-a')
  assert.match(imported.path, /^attachment-[a-f0-9]{12}-[a-f0-9]{12}-source notes\.md$/u)
  assert.equal((await fs.readFile(path.join(workspace, imported.path), 'utf8')), '# Source stays unchanged\n')
  assert.equal(createHash('sha256').update(await fs.readFile(source)).digest('hex'), before)

  const second = await controller.importSessionResource({
    sessionId: 'session-b',
    name: 'source notes.md',
    dataBase64: (await fs.readFile(source)).toString('base64'),
  })
  assert.notEqual(second.path, imported.path)
  await fs.rm(root, { recursive: true, force: true })
})

test('rejects unsupported, invalid, and unsafe Session resources before treating them as readable', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-session-resource-invalid-'))
  const workspace = path.join(root, 'workspace')
  await fs.mkdir(workspace)
  const controller = createWorkController({
    workspaceRoot: path.join(root, 'managed'),
    harness: {
      ...testHarness(),
      async inspectSessionWorkspace() { return workspace },
    },
  })
  const importResource = (name: string, content: Buffer) => controller.importSessionResource({
    sessionId: 'session-invalid',
    name,
    dataBase64: content.toString('base64'),
  })

  await assert.rejects(importResource('report.pdf', Buffer.from('not a pdf')), (error: unknown) =>
    error instanceof WorkError && error.code === 'work/session-resource-invalid')
  await assert.rejects(importResource('broken.json', Buffer.from('{')), (error: unknown) =>
    error instanceof WorkError && error.code === 'work/session-resource-invalid')
  await assert.rejects(importResource('../escape.md', Buffer.from('escape')), (error: unknown) =>
    error instanceof WorkError && error.code === 'work/session-resource-invalid')
  await assert.rejects(importResource('binary.txt', Buffer.from([0xff, 0xfe])), (error: unknown) =>
    error instanceof WorkError && error.code === 'work/session-resource-invalid')
  await assert.rejects(importResource('quoted"name.md', Buffer.from('quoted')), (error: unknown) =>
    error instanceof WorkError && error.code === 'work/session-resource-invalid')

  const linkedBytes = Buffer.from('linked')
  const linkedName = 'linked.md'
  const linkedDigest = createHash('sha256').update(linkedBytes).digest('hex')
  const linkedTarget = path.join(root, 'outside.md')
  await fs.writeFile(linkedTarget, 'outside unchanged')
  const linkedPath = path.join(
    workspace,
    `attachment-${createHash('sha256').update('session-invalid').digest('hex').slice(0, 12)}-${linkedDigest.slice(0, 12)}-${linkedName}`,
  )
  await fs.symlink(linkedTarget, linkedPath)
  await assert.rejects(importResource(linkedName, linkedBytes), (error: unknown) =>
    error instanceof WorkError && error.code === 'work/session-resource-invalid')
  assert.equal(await fs.readFile(linkedTarget, 'utf8'), 'outside unchanged')

  const targetPath = (name: string, content: Buffer): string => path.join(
    workspace,
    `attachment-${createHash('sha256').update('session-invalid').digest('hex').slice(0, 12)}-${createHash('sha256').update(content).digest('hex').slice(0, 12)}-${name}`,
  )
  const directoryBytes = Buffer.from('directory collision')
  await fs.mkdir(targetPath('directory.md', directoryBytes))
  await assert.rejects(importResource('directory.md', directoryBytes), (error: unknown) =>
    error instanceof WorkError && error.code === 'work/session-resource-invalid')

  const oversizedBytes = Buffer.from('bounded existing target')
  const oversizedPath = targetPath('oversized.md', oversizedBytes)
  await fs.writeFile(oversizedPath, 'x')
  await fs.truncate(oversizedPath, MAX_WORK_FILE_RESOURCE_BYTES + 1)
  await assert.rejects(importResource('oversized.md', oversizedBytes), (error: unknown) =>
    error instanceof WorkError && error.code === 'work/session-resource-invalid')
  await fs.rm(root, { recursive: true, force: true })
})

test('does not delete a same-name file from a replaced Workspace root during failed cleanup', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-session-resource-swap-'))
  const workspace = path.join(root, 'workspace')
  const movedWorkspace = path.join(root, 'workspace-original')
  await fs.mkdir(workspace)
  const bytes = Buffer.from('must remain in the original workspace')
  const sessionId = 'session-root-swap'
  const name = 'swap.md'
  let targetName = ''
  let pendingName = ''
  let swapped = false
  const controller = createWorkController({
    workspaceRoot: path.join(root, 'managed'),
    harness: {
      ...testHarness(),
      async inspectSessionWorkspace() { return workspace },
    },
    sessionResourceInternals: {
      async afterTargetOpen(paths) {
        if (swapped) return
        swapped = true
        targetName = path.basename(paths.targetPath)
        pendingName = path.basename(paths.pendingPath)
        await fs.rename(workspace, movedWorkspace)
        await fs.mkdir(workspace)
        await fs.writeFile(path.join(workspace, targetName), 'replacement sentinel')
      },
    },
  })

  await assert.rejects(controller.importSessionResource({
    sessionId,
    name,
    dataBase64: bytes.toString('base64'),
  }), (error: unknown) => error instanceof WorkError && error.code === 'work/session-resource-invalid')

  assert.equal(await fs.readFile(path.join(workspace, targetName), 'utf8'), 'replacement sentinel')
  assert.equal((await fs.stat(path.join(movedWorkspace, pendingName))).size, 0)
  await assert.rejects(fs.stat(path.join(movedWorkspace, targetName)), { code: 'ENOENT' })
  await fs.rm(root, { recursive: true, force: true })
})

test('reports only imported Session resources that the completed Turn actually references or reads', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-session-sources-'))
  const workspace = path.join(root, 'workspace')
  await fs.mkdir(workspace)
  const sessionId = 'session-sources'
  const events: unknown[] = []
  const controller = createWorkController({
    workspaceRoot: path.join(root, 'managed'),
    harness: {
      ...testHarness(),
      async inspectSessionWorkspace() { return workspace },
      async inspectSession() { return { cwd: workspace, events } },
    },
  })
  const imported = async (name: string, content: string) => controller.importSessionResource({
    sessionId,
    name,
    dataBase64: Buffer.from(content).toString('base64'),
  })
  const verified = await imported('verified.md', '# Verified\n')
  const unverified = await imported('unverified.md', '# Unverified\n')
  const changed = await imported('changed.md', '# Original\n')
  const produced = await imported('also-produced.md', '# Produced\n')
  await fs.writeFile(path.join(workspace, 'report.md'), '# Report\n')
  await fs.writeFile(path.join(workspace, changed.path), '# Changed after import\n')
  const missingBytes = Buffer.from('# Missing\n')
  const missing = `attachment-${createHash('sha256').update(sessionId).digest('hex').slice(0, 12)}-${createHash('sha256').update(missingBytes).digest('hex').slice(0, 12)}-missing.md`
  const references = [verified.path, unverified.path, changed.path, missing, produced.path]
    .map(value => `@${value}`).join(' ')
  const call = (seq: number, callId: string, name: string, args: object) => ({
    seq,
    type: 'tool/call',
    data: { turn: 2, callId, name, arguments: JSON.stringify(args) },
  })
  const result = (seq: number, callId: string) => ({
    seq,
    type: 'tool/result',
    surfaceOp: 'append',
    data: {
      turn: 2,
      message: {
        source: { callId },
        content: [{ type: 'tool-result', isError: false }],
      },
    },
  })
  events.push(
    { seq: 1, type: 'turn/start', data: { turn: 2 } },
    {
      seq: 2,
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: `${references} prose @random.md` }] },
    },
    call(3, 'read-verified', 'read', { file_path: path.join(workspace, verified.path) }),
    result(4, 'read-verified'),
    call(5, 'produce-imported-path', 'write', {
      file_path: `./${produced.path}`, content: '# Produced\n',
    }),
    result(6, 'produce-imported-path'),
    call(7, 'produce-report', 'write', { file_path: 'report.md', content: '# Report\n' }),
    result(8, 'produce-report'),
    { seq: 9, type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } },
  )

  const sources = await controller.inspectSessionOutputSources({
    sessionId,
    turn: 2,
    throughSeq: 8,
  })

  assert.deepEqual(sources.map(source => ({ path: source.path, status: source.status })), [
    { path: verified.path, status: 'verified' },
    { path: unverified.path, status: 'unverified' },
    { path: changed.path, status: 'changed' },
    { path: missing, status: 'missing' },
  ])
  assert.equal(sources[0]?.contentDigest, verified.contentDigest)
  assert.equal(sources.some(source => source.path === produced.path), false)
  assert.equal(sources.some(source => source.path === 'random.md'), false)

  const content = await controller.readSessionOutput({
    sessionId,
    turn: 2,
    throughSeq: 8,
    path: 'report.md',
  })
  assert.deepEqual(content.sources, sources)
  await fs.rm(root, { recursive: true, force: true })
})

test('does not carry a prior source into a text-free Turn or admit forged oversized attachment names', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-session-source-reset-'))
  const sessionId = 'session-source-reset'
  const key = createHash('sha256').update(sessionId).digest('hex').slice(0, 12)
  const oldPath = `attachment-${key}-${'a'.repeat(12)}-old.md`
  const oversized = `attachment-${key}-${'b'.repeat(12)}-${'x'.repeat(201)}.md`
  await fs.writeFile(path.join(root, 'report.md'), '# Valid report\n')
  const events = [
    { seq: 1, type: 'turn/start', data: { turn: 1 } },
    {
      seq: 2,
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: `@${oldPath}` }] },
    },
    { seq: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    { seq: 4, type: 'turn/start', data: { turn: 2 } },
    {
      seq: 5,
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'image', data: 'ignored' }] },
    },
    { seq: 6, type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } },
    { seq: 7, type: 'turn/start', data: { turn: 3 } },
    {
      seq: 8,
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: `@${oversized}` }] },
    },
    {
      seq: 9,
      type: 'tool/call',
      data: {
        turn: 3, callId: 'report', name: 'write',
        arguments: JSON.stringify({ file_path: 'report.md', content: '# Valid report\n' }),
      },
    },
    {
      seq: 10,
      type: 'tool/result',
      surfaceOp: 'append',
      data: {
        turn: 3,
        message: {
          source: { callId: 'report' },
          content: [{ type: 'tool-result', isError: false }],
        },
      },
    },
    { seq: 11, type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } } },
  ]
  const controller = createWorkController({
    workspaceRoot: path.join(root, 'managed'),
    harness: {
      ...testHarness(),
      async inspectSession() { return { cwd: root, events } },
    },
  })

  assert.deepEqual(await controller.inspectSessionOutputSources({
    sessionId, turn: 2, throughSeq: 5,
  }), [])
  assert.deepEqual(await controller.inspectSessionOutputSources({
    sessionId, turn: 3, throughSeq: 10,
  }), [])
  assert.deepEqual((await controller.readSessionOutput({
    sessionId, turn: 3, throughSeq: 10, path: 'report.md',
  })).sources, [])
  await fs.rm(root, { recursive: true, force: true })
})

test('marks a source inaccessible when the Session Workspace root changes during inspection', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-session-source-root-swap-'))
  const workspace = path.join(root, 'workspace')
  const movedWorkspace = path.join(root, 'workspace-original')
  const replacement = path.join(root, 'replacement')
  await fs.mkdir(workspace)
  await fs.mkdir(replacement)
  const sessionId = 'session-source-root-swap'
  const events: unknown[] = []
  let swapped = false
  const controller = createWorkController({
    workspaceRoot: path.join(root, 'managed'),
    harness: {
      ...testHarness(),
      async inspectSessionWorkspace() { return workspace },
      async inspectSession() { return { cwd: workspace, events } },
    },
    sessionOutputInternals: {
      async afterSourceFirstStat(candidatePath) {
        if (swapped) return
        swapped = true
        await fs.copyFile(candidatePath, path.join(replacement, path.basename(candidatePath)))
        await fs.rename(workspace, movedWorkspace)
        await fs.symlink(replacement, workspace)
      },
    },
  })
  const source = await controller.importSessionResource({
    sessionId,
    name: 'source.md',
    dataBase64: Buffer.from('# Source\n').toString('base64'),
  })
  events.push(
    { seq: 1, type: 'turn/start', data: { turn: 1 } },
    {
      seq: 2,
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: `@${source.path}` }] },
    },
    { seq: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  )

  const sources = await controller.inspectSessionOutputSources({
    sessionId, turn: 1, throughSeq: 2,
  })

  assert.equal(swapped, true)
  assert.deepEqual(sources.map(value => ({ status: value.status, bytes: value.bytes, digest: value.contentDigest })), [
    { status: 'inaccessible', bytes: null, digest: null },
  ])
  await fs.rm(root, { recursive: true, force: true })
})

test('rejects a Session Workspace root replaced while establishing the source boundary', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-session-source-baseline-swap-'))
  const workspace = path.join(root, 'workspace')
  const movedWorkspace = path.join(root, 'workspace-original')
  const replacement = path.join(root, 'replacement')
  await fs.mkdir(workspace)
  await fs.mkdir(replacement)
  const sessionId = 'session-source-baseline-swap'
  const events: unknown[] = []
  let sourcePath = ''
  let swapped = false
  const controller = createWorkController({
    workspaceRoot: path.join(root, 'managed'),
    harness: {
      ...testHarness(),
      async inspectSessionWorkspace() { return workspace },
      async inspectSession() { return { cwd: workspace, events } },
    },
    sessionOutputInternals: {
      async afterSourceWorkspaceRealpath() {
        swapped = true
        await fs.copyFile(path.join(workspace, sourcePath), path.join(replacement, sourcePath))
        await fs.rename(workspace, movedWorkspace)
        await fs.symlink(replacement, workspace)
      },
    },
  })
  const source = await controller.importSessionResource({
    sessionId,
    name: 'source.md',
    dataBase64: Buffer.from('# Source\n').toString('base64'),
  })
  sourcePath = source.path
  events.push(
    { seq: 1, type: 'turn/start', data: { turn: 1 } },
    {
      seq: 2,
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: `@${source.path}` }] },
    },
    { seq: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  )

  await assert.rejects(controller.inspectSessionOutputSources({
    sessionId, turn: 1, throughSeq: 2,
  }), (error: unknown) => error instanceof WorkError && error.code === 'work/session-output-invalid')
  assert.equal(swapped, true)
  await fs.rm(root, { recursive: true, force: true })
})

test('reports only real nonempty files produced by the addressed completed Session Turn', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-session-outputs-'))
  const workspaceA = path.join(root, 'session-a')
  const workspaceB = path.join(root, 'session-b')
  const outside = path.join(root, 'outside.md')
  await fs.mkdir(path.join(workspaceA, 'reports'), { recursive: true })
  await fs.mkdir(workspaceB)
  await fs.writeFile(path.join(workspaceA, 'reports', 'report-a.md'), '# A\n')
  await fs.writeFile(path.join(workspaceA, 'report-b.csv'), 'name,value\na,1\n')
  await fs.writeFile(path.join(workspaceA, 'empty.md'), '')
  await fs.writeFile(path.join(workspaceA, 'partial.md'), 'still being written')
  await fs.writeFile(path.join(workspaceA, 'racy.md'), 'truncate during inspection')
  await fs.writeFile(path.join(workspaceA, 'swapped.md'), 'replace during inspection')
  await fs.mkdir(path.join(workspaceA, 'folder.md'))
  await fs.writeFile(path.join(workspaceA, 'old.md'), '# Old turn\n')
  await fs.writeFile(path.join(workspaceB, 'other.md'), '# Other session\n')
  await fs.writeFile(outside, '# Outside\n')
  await fs.symlink(outside, path.join(workspaceA, 'linked.md'))

  const call = (seq: number, turn: number, callId: string, name: string, args: object) => ({
    seq,
    type: 'tool/call',
    data: { turn, callId, name, arguments: JSON.stringify(args) },
  })
  const result = (seq: number, turn: number, callId: string, isError = false) => ({
    seq,
    type: 'tool/result',
    surfaceOp: 'append',
    data: {
      turn,
      message: {
        source: { callId },
        content: [{ type: 'tool-result', isError }],
      },
    },
  })
  const eventsA = [
    call(2, 4, 'old', 'write', { file_path: 'old.md', content: '# Old turn\n' }),
    result(3, 4, 'old'),
    { seq: 4, type: 'turn/end', data: { turn: 4, reason: { kind: 'completed' } } },
    call(10, 7, 'a', 'write', { file_path: 'reports/report-a.md', content: '# A\n' }),
    result(11, 7, 'a'),
    call(12, 7, 'b', 'edit', { file_path: 'report-b.csv', old_string: '0', new_string: '1' }),
    result(13, 7, 'b'),
    call(14, 7, 'duplicate', 'str_replace_editor', {
      command: 'insert', path: 'reports/report-a.md', insert_line: 1, new_str: 'More',
    }),
    result(15, 7, 'duplicate'),
    call(16, 7, 'empty', 'write', { file_path: 'empty.md', content: '' }),
    result(17, 7, 'empty'),
    call(18, 7, 'missing', 'write', { file_path: 'missing.md', content: 'missing now' }),
    result(19, 7, 'missing'),
    call(20, 7, 'folder', 'write', { file_path: 'folder.md', content: 'not a file now' }),
    result(21, 7, 'folder'),
    call(22, 7, 'linked', 'write', { file_path: 'linked.md', content: 'linked out' }),
    result(23, 7, 'linked'),
    call(24, 7, 'outside', 'write', { file_path: outside, content: '# Outside\n' }),
    result(25, 7, 'outside'),
    call(26, 7, 'failed', 'write', { file_path: 'failed.md', content: 'failed' }),
    result(27, 7, 'failed', true),
    call(28, 7, 'racy', 'write', { file_path: 'racy.md', content: 'truncate during inspection' }),
    result(29, 7, 'racy'),
    call(30, 7, 'swapped', 'write', { file_path: 'swapped.md', content: 'replace during inspection' }),
    result(31, 7, 'swapped'),
    call(40, 7, 'partial', 'write', { file_path: 'partial.md', content: 'later' }),
    result(41, 7, 'partial'),
    { seq: 42, type: 'turn/end', data: { turn: 7, reason: { kind: 'completed' } } },
  ]
  const eventsB = [
    call(10, 7, 'other', 'write', { file_path: 'other.md', content: '# Other session\n' }),
    result(11, 7, 'other'),
    { seq: 12, type: 'turn/end', data: { turn: 7, reason: { kind: 'completed' } } },
  ]
  const raced = new Set<string>()
  const controller = createWorkController({
    workspaceRoot: path.join(root, 'managed'),
    harness: {
      ...testHarness(),
      async inspectSession(sessionId) {
        return sessionId === 'session-b'
          ? { cwd: workspaceB, events: eventsB }
          : { cwd: workspaceA, events: eventsA }
      },
    },
    sessionOutputInternals: {
      async afterFirstStat({ candidatePath, producedPath }) {
        if (raced.has(producedPath)) return
        raced.add(producedPath)
        if (producedPath === 'racy.md') {
          await fs.truncate(candidatePath, 0)
        }
        if (producedPath === 'swapped.md') {
          await fs.rename(candidatePath, path.join(workspaceA, 'swapped-original.md'))
          await fs.symlink(outside, candidatePath)
        }
      },
    },
  })

  assert.deepEqual(await controller.inspectSessionOutputs({
    sessionId: 'session-a',
    turn: 7,
    throughSeq: 35,
  }), [
    {
      sessionId: 'session-a',
      turn: 7,
      name: 'report-a.md',
      path: 'reports/report-a.md',
      bytes: 4,
      mediaType: 'text/markdown',
    },
    {
      sessionId: 'session-a',
      turn: 7,
      name: 'report-b.csv',
      path: 'report-b.csv',
      bytes: 15,
      mediaType: 'text/csv',
    },
  ])
  assert.deepEqual(await controller.inspectSessionOutputs({
    sessionId: 'session-a', turn: 6, throughSeq: 35,
  }), [])
  assert.deepEqual(await controller.inspectSessionOutputs({
    sessionId: 'session-b', turn: 7, throughSeq: 30,
  }), [{
    sessionId: 'session-b',
    turn: 7,
    name: 'other.md',
    path: 'other.md',
    bytes: 16,
    mediaType: 'text/markdown',
  }])
  await fs.rm(root, { recursive: true, force: true })
})

test('bounds validated Session outputs to the remote contract maximum', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-session-output-limit-'))
  const events: unknown[] = []
  for (let index = 0; index < 65; index++) {
    const name = `output-${String(index).padStart(2, '0')}.txt`
    await fs.writeFile(path.join(root, name), String(index))
    const callId = `output-${String(index)}`
    events.push({
      seq: index * 2 + 1,
      type: 'tool/call',
      data: {
        turn: 1,
        callId,
        name: 'write',
        arguments: JSON.stringify({ file_path: name, content: String(index) }),
      },
    }, {
      seq: index * 2 + 2,
      type: 'tool/result',
      surfaceOp: 'append',
      data: {
        turn: 1,
        message: {
          source: { callId },
          content: [{ type: 'tool-result', isError: false }],
        },
      },
    })
  }
  events.push({ seq: 131, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  const controller = createWorkController({
    workspaceRoot: path.join(root, 'managed'),
    harness: {
      ...testHarness(),
      async inspectSession() { return { cwd: root, events } },
    },
  })

  const outputs = await controller.inspectSessionOutputs({
    sessionId: 'bounded-session',
    turn: 1,
    throughSeq: 130,
  })

  assert.equal(outputs.length, 64)
  assert.equal(outputs[0]?.path, 'output-00.txt')
  assert.equal(outputs.at(-1)?.path, 'output-63.txt')
  await fs.rm(root, { recursive: true, force: true })
})

test('reads only the addressed validated Markdown output on demand', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-session-output-read-'))
  const markdown = '# Safe report\n\n- First\n- Second\n\n<script>unsafe()</script>\n'
  await fs.writeFile(path.join(root, 'report.md'), markdown)
  await fs.writeFile(path.join(root, 'unregistered.md'), '# Not produced\n')
  await fs.writeFile(path.join(root, 'page.html'), '<script>unsafe()</script>')
  const eventPair = (callId: string, filePath: string, seq: number) => [{
    seq,
    type: 'tool/call',
    data: {
      turn: 3,
      callId,
      name: 'write',
      arguments: JSON.stringify({ file_path: filePath, content: 'fixture' }),
    },
  }, {
    seq: seq + 1,
    type: 'tool/result',
    surfaceOp: 'append',
    data: {
      turn: 3,
      message: { source: { callId }, content: [{ type: 'tool-result', isError: false }] },
    },
  }]
  const controller = createWorkController({
    workspaceRoot: path.join(root, 'managed'),
    harness: {
      ...testHarness(),
      async inspectSession() {
        return {
          cwd: root,
          events: [
            ...eventPair('markdown', 'report.md', 1),
            ...eventPair('html', 'page.html', 3),
            { seq: 5, type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } } },
          ],
        }
      },
    },
  })

  assert.deepEqual(await controller.readSessionOutput({
    sessionId: 'session-read', turn: 3, throughSeq: 4, path: 'report.md',
  }), {
    sessionId: 'session-read',
    turn: 3,
    name: 'report.md',
    path: 'report.md',
    bytes: Buffer.byteLength(markdown),
    mediaType: 'text/markdown',
    content: markdown,
    contentDigest: createHash('sha256').update(markdown).digest('hex'),
    sources: [],
  })
  for (const selectedPath of ['unregistered.md', 'page.html']) {
    await assert.rejects(controller.readSessionOutput({
      sessionId: 'session-read', turn: 3, throughSeq: 4, path: selectedPath,
    }), (error: unknown) => error instanceof WorkError && error.code === 'work/session-output-invalid')
  }
  await fs.rm(root, { recursive: true, force: true })
})

test('saves an unadopted Session output idempotently and opens its real managed location', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-session-save-'))
  const deliveryRoot = path.join(root, 'saved')
  const outputPath = path.join(root, 'report.md')
  const content = '# Save this copy\n'
  await fs.writeFile(outputPath, content)
  const events: unknown[] = [
    { seq: 1, type: 'tool/call', data: {
      turn: 1, callId: 'write-report', name: 'write',
      arguments: JSON.stringify({ file_path: 'report.md', content }),
    } },
    { seq: 2, type: 'tool/result', surfaceOp: 'append', data: {
      turn: 1,
      message: { source: { callId: 'write-report' }, content: [{ type: 'tool-result', isError: false }] },
    } },
    { seq: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  const opened: string[] = []
  const controller = createWorkController({
    workspaceRoot: path.join(root, 'managed'),
    deliveryRoot,
    harness: {
      ...testHarness(),
      async inspectSession() { return { cwd: root, events } },
      async openPath(location) { opened.push(location) },
    },
  })
  const spec = { sessionId: 'session-save', turn: 1, throughSeq: 2, path: 'report.md' }

  const saved = await controller.saveSessionOutput(spec)
  assert.equal(saved.contentDigest, createHash('sha256').update(content).digest('hex'))
  assert.equal(saved.bytes, Buffer.byteLength(content))
  assert.equal(await fs.readFile(path.join(saved.location, saved.fileName), 'utf8'), content)
  assert.deepEqual(await controller.saveSessionOutput(spec), saved)
  const reconnected = createWorkController({
    workspaceRoot: path.join(root, 'managed'),
    deliveryRoot,
    harness: {
      ...testHarness(),
      async inspectSession() { return { cwd: root, events } },
    },
  })
  assert.deepEqual(await reconnected.saveSessionOutput(spec), saved)
  await controller.showSessionOutputSave({
    saveId: saved.saveId,
    fileName: saved.fileName,
    contentDigest: saved.contentDigest,
  })
  assert.deepEqual(opened, [saved.location])

  await fs.writeFile(outputPath, '# Changed after save\n')
  const changedSave = await controller.saveSessionOutput(spec)
  assert.notEqual(changedSave.location, saved.location)
  assert.equal(
    await fs.readFile(path.join(changedSave.location, changedSave.fileName), 'utf8'),
    '# Changed after save\n',
  )
  assert.equal(await fs.readFile(path.join(saved.location, saved.fileName), 'utf8'), content)
  await fs.writeFile(outputPath, content)
  assert.equal((await controller.prepareSessionOutputRevision(spec)).path, 'report.md')
  await fs.rm(root, { recursive: true, force: true })
})

test('isolates a cancelled Session output save attempt and allows retry without publishing it', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-session-save-cancel-'))
  const deliveryRoot = path.join(root, 'saved')
  const content = '# Retry save\n'
  await fs.writeFile(path.join(root, 'report.md'), content)
  const events: unknown[] = [
    { seq: 1, type: 'tool/call', data: {
      turn: 1, callId: 'write-report', name: 'write',
      arguments: JSON.stringify({ file_path: 'report.md', content }),
    } },
    { seq: 2, type: 'tool/result', surfaceOp: 'append', data: {
      turn: 1,
      message: { source: { callId: 'write-report' }, content: [{ type: 'tool-result', isError: false }] },
    } },
    { seq: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  const abort = new AbortController()
  let cancelFirst = true
  let pendingPath = ''
  let targetPath = ''
  const controller = createWorkController({
    workspaceRoot: path.join(root, 'managed'),
    deliveryRoot,
    harness: {
      ...testHarness(),
      async inspectSession() { return { cwd: root, events } },
    },
    sessionOutputSaveInternals: {
      afterTargetOpen(paths) {
        if (cancelFirst) {
          pendingPath = paths.pendingPath
          targetPath = paths.targetPath
          cancelFirst = false
          abort.abort()
        }
      },
    },
  })
  const spec = { sessionId: 'session-save-cancel', turn: 1, throughSeq: 2, path: 'report.md' }

  await assert.rejects(controller.saveSessionOutput(spec, abort.signal), error =>
    error instanceof DOMException && error.name === 'AbortError')
  assert.equal(pendingPath, targetPath)
  assert.equal((await fs.stat(targetPath)).size, 0)
  const saved = await controller.saveSessionOutput(spec)
  assert.notEqual(saved.location, path.dirname(targetPath))
  assert.equal(await fs.readFile(path.join(saved.location, saved.fileName), 'utf8'), content)
  await fs.rm(root, { recursive: true, force: true })
})

test('does not publish or clean through a replaced managed save directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-session-save-swap-'))
  const deliveryRoot = path.join(root, 'saved')
  const content = '# Preserve ownership\n'
  await fs.writeFile(path.join(root, 'report.md'), content)
  const events: unknown[] = [
    { seq: 1, type: 'tool/call', data: {
      turn: 1, callId: 'write-report', name: 'write',
      arguments: JSON.stringify({ file_path: 'report.md', content }),
    } },
    { seq: 2, type: 'tool/result', surfaceOp: 'append', data: {
      turn: 1,
      message: { source: { callId: 'write-report' }, content: [{ type: 'tool-result', isError: false }] },
    } },
    { seq: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  let movedDirectory = ''
  let replacementTarget = ''
  const controller = createWorkController({
    workspaceRoot: path.join(root, 'managed'),
    deliveryRoot,
    harness: {
      ...testHarness(),
      async inspectSession() { return { cwd: root, events } },
    },
    sessionOutputSaveInternals: {
      async afterTargetOpen(paths) {
        const directory = path.dirname(paths.pendingPath)
        movedDirectory = `${directory}-original`
        await fs.rename(directory, movedDirectory)
        await fs.mkdir(directory)
        replacementTarget = paths.targetPath
        await fs.writeFile(replacementTarget, 'replacement target sentinel')
      },
    },
  })

  await assert.rejects(controller.saveSessionOutput({
    sessionId: 'session-save-swap', turn: 1, throughSeq: 2, path: 'report.md',
  }), (error: unknown) => error instanceof WorkError && error.code === 'work/session-output-save-failed')
  assert.equal(await fs.readFile(replacementTarget, 'utf8'), 'replacement target sentinel')
  assert.equal((await fs.stat(path.join(movedDirectory, 'report.md'))).size, 0)
  await fs.rm(root, { recursive: true, force: true })
})

test('protects the last valid Session output until a same-Session revision is validated', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-session-revision-'))
  const events: unknown[] = [
    {
      seq: 1,
      type: 'tool/call',
      data: {
        turn: 1,
        callId: 'initial',
        name: 'write',
        arguments: JSON.stringify({ file_path: 'report.md', content: '# Original\n' }),
      },
    },
    {
      seq: 2,
      type: 'tool/result',
      surfaceOp: 'append',
      data: {
        turn: 1,
        message: { source: { callId: 'initial' }, content: [{ type: 'tool-result', isError: false }] },
      },
    },
    {
      seq: 3,
      type: 'tool/call',
      data: {
        turn: 1,
        callId: 'initial-b',
        name: 'write',
        arguments: JSON.stringify({ file_path: 'report-b.md', content: '# Other\n' }),
      },
    },
    {
      seq: 4,
      type: 'tool/result',
      surfaceOp: 'append',
      data: {
        turn: 1,
        message: { source: { callId: 'initial-b' }, content: [{ type: 'tool-result', isError: false }] },
      },
    },
    { seq: 5, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  await fs.writeFile(path.join(root, 'report.md'), '# Original\n')
  await fs.writeFile(path.join(root, 'report-b.md'), '# Other\n')
  const controller = createWorkController({
    workspaceRoot: path.join(root, 'managed'),
    harness: {
      ...testHarness(),
      async inspectSession(sessionId) {
        assert.equal(sessionId, 'session-revision')
        return { cwd: root, events }
      },
    },
  })
  const source = { sessionId: 'session-revision', turn: 1, throughSeq: 5, path: 'report.md' }

  assert.deepEqual(await controller.prepareSessionOutputRevision(source), {
    sessionId: 'session-revision',
    sourceTurn: 1,
    name: 'report.md',
    path: 'report.md',
    reference: '@report.md',
    contentDigest: createHash('sha256').update('# Original\n').digest('hex'),
  })

  await fs.writeFile(path.join(root, 'report.md'), '')
  assert.equal((await controller.readSessionOutput(source)).content, '# Original\n')
  assert.deepEqual(await controller.inspectSessionOutputs({
    sessionId: 'session-revision', turn: 1, throughSeq: 5,
  }), [
    {
      sessionId: 'session-revision', turn: 1, name: 'report-b.md', path: 'report-b.md',
      bytes: Buffer.byteLength('# Other\n'), mediaType: 'text/markdown',
    },
    {
      sessionId: 'session-revision', turn: 1, name: 'report.md', path: 'report.md',
      bytes: Buffer.byteLength('# Original\n'), mediaType: 'text/markdown',
    },
  ])

  events.push(
    { seq: 6, type: 'user/message', data: {
      turn: 2, source: { kind: 'user' }, content: [{ type: 'text', text: '@report.md revise' }],
    } },
    { seq: 7, type: 'assistant/message', data: { turn: 2, step: 1 } },
    {
      seq: 8,
      type: 'tool/call',
      data: {
        turn: 2,
        callId: 'empty-revision',
        name: 'write',
        arguments: JSON.stringify({ file_path: 'report.md', content: '' }),
      },
    },
    {
      seq: 9,
      type: 'tool/result',
      surfaceOp: 'append',
      data: {
        turn: 2,
        message: { source: { callId: 'empty-revision' }, content: [{ type: 'tool-result', isError: false }] },
      },
    },
    { seq: 10, type: 'assistant/message', data: { turn: 2, step: 2 } },
    { seq: 11, type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } },
  )
  assert.equal(await controller.inspectSessionRevision({
    sessionId: 'session-revision', turn: 2, throughSeq: 7,
  }), null)
  const failedSpec = { sessionId: 'session-revision', turn: 2, throughSeq: 10 }
  assert.deepEqual(await controller.inspectSessionRevision(failedSpec), {
    sessionId: 'session-revision',
    turn: 2,
    name: 'report.md',
    path: 'report.md',
    reference: '@report.md',
    status: 'failed',
    message: '修改未生成有效文件，已保留上一结果。',
  })
  assert.equal((await fs.stat(path.join(root, 'report.md'))).size, 0)
  assert.equal((await controller.readSessionOutput(source)).content, '# Original\n')
  await assert.rejects(controller.prepareSessionOutputRevision({
    sessionId: 'session-revision', turn: 1, throughSeq: 5, path: 'report-b.md',
  }), (error: unknown) => error instanceof WorkError && error.code === 'work/session-output-invalid')
  assert.equal((await controller.readSessionOutput(source)).content, '# Original\n')
  assert.deepEqual(await controller.inspectSessionOutputs(failedSpec), [])
  assert.deepEqual(await controller.inspectSessionRevision(failedSpec), await controller.inspectSessionRevision(failedSpec))

  await fs.writeFile(path.join(root, 'report.md'), '# Revised\n')
  events.push(
    { seq: 12, type: 'user/message', data: {
      turn: 3, source: { kind: 'user' }, content: [{ type: 'text', text: '@report.md retry' }],
    } },
    { seq: 13, type: 'assistant/message', data: { turn: 3, step: 1 } },
    {
      seq: 14,
      type: 'tool/call',
      data: {
        turn: 3,
        callId: 'valid-revision',
        name: 'write',
        arguments: JSON.stringify({ file_path: 'report.md', content: '# Revised\n' }),
      },
    },
    {
      seq: 15,
      type: 'tool/result',
      surfaceOp: 'append',
      data: {
        turn: 3,
        message: { source: { callId: 'valid-revision' }, content: [{ type: 'tool-result', isError: false }] },
      },
    },
    { seq: 16, type: 'assistant/message', data: { turn: 3, step: 2 } },
    { seq: 17, type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } } },
  )
  const successSpec = { sessionId: 'session-revision', turn: 3, throughSeq: 16 }
  assert.equal(await controller.inspectSessionRevision(successSpec), null)
  assert.deepEqual((await controller.inspectSessionOutputs(successSpec)).map(file => file.path), ['report.md'])
  assert.equal((await controller.readSessionOutput({ ...successSpec, path: 'report.md' })).content, '# Revised\n')

  await controller.prepareSessionOutputRevision({ ...successSpec, path: 'report.md' })
  await fs.writeFile(path.join(root, 'report.md'), Buffer.from([0xff, 0xfe]))
  events.push(
    { seq: 18, type: 'user/message', data: {
      turn: 4, source: { kind: 'user' }, content: [{ type: 'text', text: '@report.md revise again' }],
    } },
    { seq: 19, type: 'assistant/message', data: { turn: 4, step: 1 } },
    {
      seq: 20,
      type: 'tool/call',
      data: {
        turn: 4,
        callId: 'interrupted-revision',
        name: 'write',
        arguments: JSON.stringify({ file_path: 'report.md', content: 'corrupt bytes' }),
      },
    },
    {
      seq: 21,
      type: 'tool/result',
      surfaceOp: 'append',
      data: {
        turn: 4,
        message: { source: { callId: 'interrupted-revision' }, content: [{ type: 'tool-result', isError: false }] },
      },
    },
    { seq: 22, type: 'assistant/message', data: { turn: 4, step: 2 } },
    { seq: 23, type: 'turn/end', data: { turn: 4, reason: { kind: 'aborted' } } },
  )
  const interruptedSpec = { sessionId: 'session-revision', turn: 4, throughSeq: 22 }
  assert.equal((await controller.inspectSessionRevision(interruptedSpec))?.status, 'failed')
  assert.deepEqual(await controller.inspectSessionOutputs(interruptedSpec), [])
  assert.deepEqual(await fs.readFile(path.join(root, 'report.md')), Buffer.from([0xff, 0xfe]))
  assert.equal((await controller.readSessionOutput({ ...successSpec, path: 'report.md' })).content, '# Revised\n')
  await fs.rm(root, { recursive: true, force: true })
})

test('ignores unrelated Turns and keeps revision validation retryable after cancellation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-session-revision-binding-'))
  const original = '# Original\n'
  const revised = '# Revised\n'
  await fs.writeFile(path.join(root, 'report.md'), original)
  const events: unknown[] = [
    { seq: 1, type: 'tool/call', data: {
      turn: 1, callId: 'initial', name: 'write',
      arguments: JSON.stringify({ file_path: 'report.md', content: original }),
    } },
    { seq: 2, type: 'tool/result', surfaceOp: 'append', data: {
      turn: 1,
      message: { source: { callId: 'initial' }, content: [{ type: 'tool-result', isError: false }] },
    } },
    { seq: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  let cancelPreview = false
  let activeAbort: AbortController | null = null
  const controller = createWorkController({
    workspaceRoot: path.join(root, 'managed'),
    harness: {
      ...testHarness(),
      async inspectSession() { return { cwd: root, events } },
    },
    sessionOutputInternals: {
      afterPreviewFirstStat() {
        if (cancelPreview) {
          cancelPreview = false
          activeAbort?.abort()
        }
      },
    },
  })
  const source = { sessionId: 'session-binding', turn: 1, throughSeq: 3, path: 'report.md' }
  events.push(
    { seq: 4, type: 'user/message', data: {
      source: { kind: 'user' }, content: [{ type: 'text', text: '@report.md revise too early' }],
    } },
    { seq: 5, type: 'turn/start', data: { turn: 2 } },
  )
  await controller.prepareSessionOutputRevision(source)
  events.push(
    { seq: 6, type: 'assistant/message', data: { turn: 2, step: 1 } },
    { seq: 7, type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } },
  )
  await fs.writeFile(path.join(root, 'report.md'), '')
  assert.equal(await controller.inspectSessionRevision({
    sessionId: 'session-binding', turn: 2, throughSeq: 6,
  }), null)
  assert.equal((await controller.readSessionOutput(source)).content, original)

  events.push(
    { seq: 8, type: 'user/message', data: {
      source: { kind: 'user' }, content: [{ type: 'text', text: 'ordinary chat without a file' }],
    } },
    { seq: 9, type: 'turn/start', data: { turn: 3 } },
    { seq: 10, type: 'assistant/message', data: { turn: 3, step: 1 } },
    { seq: 11, type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } } },
  )
  assert.equal(await controller.inspectSessionRevision({
    sessionId: 'session-binding', turn: 3, throughSeq: 10,
  }), null)
  assert.equal((await controller.readSessionOutput(source)).content, original)

  await fs.writeFile(path.join(root, 'report.md'), revised)
  events.push(
    { seq: 12, type: 'user/message', data: {
      source: { kind: 'user' }, content: [{ type: 'text', text: '@report.md revise' }],
    } },
    { seq: 13, type: 'turn/start', data: { turn: 4 } },
    { seq: 14, type: 'assistant/message', data: { turn: 4, step: 1 } },
    { seq: 15, type: 'tool/call', data: {
      turn: 4, callId: 'revision', name: 'write',
      arguments: JSON.stringify({ file_path: 'report.md', content: revised }),
    } },
    { seq: 16, type: 'tool/result', surfaceOp: 'append', data: {
      turn: 4,
      message: { source: { callId: 'revision' }, content: [{ type: 'tool-result', isError: false }] },
    } },
    { seq: 17, type: 'assistant/message', data: { turn: 4, step: 2 } },
    { seq: 18, type: 'turn/end', data: { turn: 4, reason: { kind: 'completed' } } },
  )
  activeAbort = new AbortController()
  cancelPreview = true
  await assert.rejects(controller.inspectSessionRevision({
    sessionId: 'session-binding', turn: 4, throughSeq: 17,
  }, activeAbort.signal), error => error instanceof DOMException && error.name === 'AbortError')
  assert.equal(await controller.inspectSessionRevision({
    sessionId: 'session-binding', turn: 4, throughSeq: 17,
  }), null)
  assert.equal((await controller.readSessionOutput({
    sessionId: 'session-binding', turn: 4, throughSeq: 17, path: 'report.md',
  })).content, revised)
  await fs.rm(root, { recursive: true, force: true })
})

test('bounds a Markdown preview read when the file grows after validation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-session-output-grow-'))
  const selectedPath = path.join(root, 'growing.md')
  await fs.writeFile(selectedPath, '# Small\n')
  const events = [{
    seq: 1,
    type: 'tool/call',
    data: {
      turn: 1,
      callId: 'growing',
      name: 'write',
      arguments: JSON.stringify({ file_path: 'growing.md', content: '# Small\n' }),
    },
  }, {
    seq: 2,
    type: 'tool/result',
    surfaceOp: 'append',
    data: {
      turn: 1,
      message: {
        source: { callId: 'growing' },
        content: [{ type: 'tool-result', isError: false }],
      },
    },
  }, {
    seq: 3,
    type: 'turn/end',
    data: { turn: 1, reason: { kind: 'completed' } },
  }]
  let grew = false
  const controller = createWorkController({
    workspaceRoot: path.join(root, 'managed'),
    harness: {
      ...testHarness(),
      async inspectSession() { return { cwd: root, events } },
    },
    sessionOutputInternals: {
      async afterPreviewFirstStat(candidatePath) {
        grew = true
        await fs.writeFile(candidatePath, Buffer.alloc(5 * 1024 * 1024 + 1, 120))
      },
    },
  })

  await assert.rejects(controller.readSessionOutput({
    sessionId: 'growing-session', turn: 1, throughSeq: 3, path: 'growing.md',
  }), (error: unknown) => error instanceof WorkError && error.code === 'work/session-output-invalid')
  assert.equal(grew, true)
  await fs.rm(root, { recursive: true, force: true })
})

test('rejects invalid Session output coordinates and unavailable inspection', async () => {
  const withoutInspection = createWorkController({
    workspaceRoot: '/managed',
    harness: testHarness(),
  })
  await assert.rejects(withoutInspection.inspectSessionOutputs({
    sessionId: 'session-a', turn: 1, throughSeq: 1,
  }), (error: unknown) => error instanceof WorkError && error.code === 'work/session-output-invalid')

  const withInspection = createWorkController({
    workspaceRoot: '/managed',
    harness: {
      ...testHarness(),
      async inspectSession() { return { cwd: '/managed', events: [] } },
    },
  })
  await assert.rejects(withInspection.inspectSessionOutputs({
    sessionId: 'session-a', turn: -1, throughSeq: 1,
  }), (error: unknown) => error instanceof WorkError && error.code === 'work/session-output-invalid')
})
