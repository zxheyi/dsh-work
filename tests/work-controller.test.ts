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
    },
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
  assert.deepEqual(created.primarySession, { sessionId: 'session-primary' })
})
