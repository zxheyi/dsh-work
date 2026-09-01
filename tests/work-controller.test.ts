import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  WorkError,
  createHarnessWorkPort,
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
  })
  assert.deepEqual(await controller.get(), created)
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

test('creates one Primary Session bound to the managed Workspace', async () => {
  const sessionRequests: Array<{
    sessionId: string
    workspaceId: string
    cwd: string
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
    cwd: '/managed/work-primary',
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
