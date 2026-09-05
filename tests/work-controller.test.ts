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
  })
  for (const selectedPath of ['unregistered.md', 'page.html']) {
    await assert.rejects(controller.readSessionOutput({
      sessionId: 'session-read', turn: 3, throughSeq: 4, path: selectedPath,
    }), (error: unknown) => error instanceof WorkError && error.code === 'work/session-output-invalid')
  }
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
