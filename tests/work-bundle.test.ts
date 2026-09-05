import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { apply as workBundle, inject, workDomainSpec } from '../packages/work-bundle/index.ts'
import type { WorkController, WorkDomainState } from '../packages/work-domain/index.ts'

test('mounts a storageDomain-backed WorkController as a Host service', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-bundle-'))
  let state: WorkDomainState = { work: null }
  let controller: WorkController | undefined
  let closed = false
  let dispose: (() => Promise<void>) | undefined
  const context = {
    dshHomePath: (...segments: string[]) => path.join(home, ...segments),
    storageDomain: {
      async open(spec: unknown) {
        assert.equal(spec, workDomainSpec)
        return {
          global: {
            get: () => state,
            async set(next: WorkDomainState) { state = structuredClone(next) },
          },
          async close() { closed = true },
        }
      },
    },
    workspaceRegistry: {
      async create(workspacePath: string) {
        return { id: 'workspace-bundle', path: workspacePath }
      },
    },
    sessionController: {
      async create(request: { sessionId: string }) {
        return { sessionId: request.sessionId }
      },
      async prompt() {
        return { accepted: true as const }
      },
    },
    provide(name: string, service: unknown) {
      if (name === 'workController') controller = service as WorkController
      return () => {}
    },
    effect(execute: () => () => Promise<void>) {
      dispose = execute()
      return dispose
    },
  }

  await workBundle(context)
  const created = await controller!.create({ title: 'Bundle', goal: 'Persist through the Host.' })

  assert.equal(workDomainSpec.name, 'dsh_work')
  assert.deepEqual(inject, ['dshHomePath', 'storageDomain', 'workspaceRegistry', 'sessionController'])
  assert.equal(workDomainSpec.global.schema.safeParse(state).success, true)
  assert.equal(state.work?.workId, created.workId)
  const legacyWork = structuredClone(state.work!) as unknown as Record<string, unknown>
  delete legacyWork.resources
  const restoredLegacy = workDomainSpec.global.schema.parse({ work: legacyWork })
  assert.deepEqual(restoredLegacy.work?.resources, [])
  await dispose!()
  assert.equal(closed, true)
  await fs.rm(home, { recursive: true, force: true })
})

test('maps a stored Work to its native Workspace and Session before publishing the controller', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-bundle-restore-'))
  const workspacePath = path.join(home, 'legacy-workspace')
  await fs.mkdir(workspacePath)
  await fs.writeFile(path.join(workspacePath, 'existing.md'), 'unchanged')
  let state: WorkDomainState = {
    work: {
      workId: 'legacy-work',
      revision: 4,
      title: '旧 Work 会话',
      goal: '保留旧文件和会话。',
      workspace: { workspaceId: 'legacy-workspace', path: workspacePath },
      primarySession: { sessionId: 'legacy-session', turnCount: 2 },
      resources: [],
      deliverable: null,
      status: 'working',
      execution: 'idle',
      lastFailure: null,
      lastMutationId: null,
      lastMutationDigest: null,
      importSource: null,
    },
  }
  const mapped: string[] = []
  let published: WorkController | undefined
  const context = {
    dshHomePath: (...segments: string[]) => path.join(home, ...segments),
    storageDomain: {
      async open() {
        return {
          global: {
            get: () => state,
            async set(next: WorkDomainState) { state = structuredClone(next) },
          },
          async close() {},
        }
      },
    },
    workspaceRegistry: {
      async create(candidate: string) {
        mapped.push(`workspace:${candidate}`)
        return { id: 'legacy-workspace', path: candidate }
      },
    },
    sessionController: {
      async create(request: { sessionId: string; workspaceId: string }) {
        mapped.push(`session:${request.sessionId}:${request.workspaceId}`)
        return { sessionId: request.sessionId }
      },
      async prompt() { return { accepted: true as const } },
    },
    provide(name: string, service: unknown) {
      assert.deepEqual(mapped, [
        `workspace:${workspacePath}`,
        'session:legacy-session:legacy-workspace',
      ])
      if (name === 'workController') published = service as WorkController
      return () => {}
    },
    effect(execute: () => () => Promise<void>) { return execute() },
  }

  await workBundle(context)

  assert.equal((await published!.get())?.workId, 'legacy-work')
  assert.deepEqual(state.work?.workspace, { workspaceId: 'legacy-workspace', path: workspacePath })
  assert.equal(await fs.readFile(path.join(workspacePath, 'existing.md'), 'utf8'), 'unchanged')
  await fs.rm(home, { recursive: true, force: true })
})
