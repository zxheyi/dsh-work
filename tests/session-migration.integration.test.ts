import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { createWorkController, type HarnessWorkPort } from '../packages/work-domain/index.ts'

// Resolve the pinned CLI's public services, never private source or a second runtime.
const runtime = createRequire(import.meta.resolve('@deepseek-ai/dsh/package.json'))
const { default: JsonlPersistence } = await import(pathToFileURL(runtime.resolve('@deepseek-ai/dsh-session-persistence-jsonl')).href)
const { Session } = await import(pathToFileURL(runtime.resolve('@deepseek-ai/dsh-session')).href)


test('native V0 to V3 publication preserves old output versions across cold reopen and changed sequence coordinates', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-migration-'))
  const sessionId = 'alpha2-output'
  const workspace = path.join(root, 'workspace')
  const sessions = path.join(root, 'sessions')
  const directory = path.join(sessions, '_no-cwd', sessionId)
  await fs.mkdir(workspace)
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(path.join(workspace, 'report.md'), '# Historical report\n')
  const originalEvents = JSON.parse(await fs.readFile(new URL('./fixtures/alpha2-output/events.json', import.meta.url), 'utf8'))
  const bytes = await fs.readFile(new URL('./fixtures/alpha2-output/session.jsonl', import.meta.url), 'utf8')
  const predecessor = path.join(directory, 'session.jsonl')
  await fs.writeFile(predecessor, bytes)
  let events: readonly unknown[] = originalEvents
  const harness: HarnessWorkPort = {
    async ensureWorkspace(request) { return { workspaceId: 'workspace', path: request.path } },
    async ensurePrimarySession(request) { return { sessionId: request.sessionId } },
    async submitTurn() {},
    async inspectSession() { return { cwd: workspace, events } },
    async inspectSessionWorkspace() { return workspace },
  }
  const controller = () => createWorkController({ harness, workspaceRoot: workspace, sessionOutputVersionRoot: path.join(root, 'versions') })
  const listSpec = { sessionId, path: 'report.md' }
  let ctx = new Context()
  try {
    await controller().inspectSessionOutputs({ sessionId, turn: 1, throughSeq: 12 })
    const before = await controller().listSessionOutputVersions(listSpec)
    assert.equal(before.length, 1)
    await ctx.plugin(JsonlPersistence, { root: sessions, compression: 'none' })
    const persistence = (ctx as any).sessionPersistence
    const reader = await persistence.open(sessionId, 'read')
    const restored = await reader.read()
    assert.equal(reader.header.version, 3)
    const messages = Session.fromRestore(sessionId, restored.events, reader.header, reader.inheritedEventCount, restored.eventState).deriveMessages()
    assert.deepEqual(messages.filter((message: any) => message.role !== 'system').map((message: any) => message.id), ['question', 'assistant', 'result'])
    assert.deepEqual(messages.filter((message: any) => message.role !== 'system'),
      originalEvents.flatMap((event: any) => event.type === 'user/message' ? [event.data]
        : ['assistant/message', 'tool/result'].includes(event.type) ? [event.data.message] : []))
    events = restored.events
    const frontier = restored.events.at(-1).seq
    assert.notEqual(frontier, 12, 'fixture must actually change throughSeq')
    await reader.close()
    assert.equal(await fs.readFile(predecessor, 'utf8'), bytes)
    await assert.rejects(fs.stat(path.join(directory, 'session.v3.jsonl')), { code: 'ENOENT' })
    const writer = await persistence.open(sessionId, 'write')
    await writer.flush()
    await writer.close()
    await ctx.fiber.dispose()
    ctx = new Context()
    await ctx.plugin(JsonlPersistence, { root: sessions, compression: 'none' })
    const reopened = await (ctx as any).sessionPersistence.open(sessionId, 'read')
    events = (await reopened.read()).events
    await reopened.close()
    await controller().inspectSessionOutputs({ sessionId, turn: 1, throughSeq: frontier })
    assert.deepEqual(await controller().listSessionOutputVersions(listSpec), before, 'migration must not republish the same completed turn')
    // The old sequence is retained as historical metadata; immutable bytes use stable IDs.
    assert.equal(before[0]!.throughSeq, 12)
    assert.equal((await controller().readSessionOutputVersion({ fileId: before[0]!.fileId, versionId: before[0]!.versionId })).content, '# Historical report\n')
    await fs.writeFile(path.join(workspace, 'report.md'), '# External replacement\n')
    await controller().inspectSessionOutputs({ sessionId, turn: 1, throughSeq: frontier })
    assert.deepEqual(await controller().listSessionOutputVersions(listSpec), before)
    assert.equal(await fs.readFile(predecessor, 'utf8'), bytes)
  } finally {
    await ctx.fiber.dispose()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('native uploaded binary files remain tracked sources without a workspace copy', async () => {
  const { default: LocalAttachments } = await import(pathToFileURL(runtime.resolve('@deepseek-ai/dsh-attachment-local')).href)
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-work-native-sources-'))
  const ctx = new Context()
  try {
    const attachments = new LocalAttachments(ctx, { dshHome: root })
    const ref = await attachments.saveFile({ data: Uint8Array.of(0, 1, 2, 255), name: 'source.pdf' })
    const other = await attachments.saveFile({ data: Uint8Array.of(3, 4), name: 'x'.repeat(220) + '.xlsx' })
    const hostPath = attachments.fileHostPath(ref)
    const workspace = path.join(root, 'workspace')
    await fs.mkdir(workspace)
    await fs.writeFile(path.join(workspace, 'report.md'), '# Report\n')
    const events = [
      { seq: 0, type: 'turn/start', data: { turn: 1 } },
      { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'file', attachment: ref }, { type: 'file', attachment: other }] } },
      { seq: 2, type: 'tool/call', data: { turn: 1, callId: 'read', name: 'read', arguments: JSON.stringify({ file_path: hostPath }) } },
      { seq: 3, type: 'tool/result', surfaceOp: 'append', data: { turn: 1, message: { source: { callId: 'read' }, content: [{ type: 'tool-result', isError: false }] } } },
      { seq: 4, type: 'tool/call', data: { turn: 1, callId: 'write', name: 'write', arguments: JSON.stringify({ file_path: 'report.md', content: '# Report\n' }) } },
      { seq: 5, type: 'tool/result', surfaceOp: 'append', data: { turn: 1, message: { source: { callId: 'write' }, content: [{ type: 'tool-result', isError: false }] } } },
      { seq: 6, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    events.splice(2, 0, { seq: 2, type: 'user/message', data: { source: { kind: 'plugin' }, content: [] } })
    events.forEach((event, seq) => { event.seq = seq })
    const harness: HarnessWorkPort = {
      async ensureWorkspace(request) { return { workspaceId: 'workspace', path: request.path } },
      async ensurePrimarySession(request) { return { sessionId: request.sessionId } },
      async submitTurn() {},
      async inspectSession() { return { cwd: workspace, events, attachments } },
      async inspectSessionWorkspace() { return workspace },
    }
    const controller = createWorkController({ harness, workspaceRoot: workspace, sessionOutputVersionRoot: path.join(root, 'versions') })
    const spec = { sessionId: 'native-files', turn: 1, throughSeq: 7 }
    const sources = await controller.inspectSessionOutputSources(spec)
    assert.deepEqual(sources.map(source => [source.name, source.status]), [['source.pdf', 'verified'], [other.name, 'unverified']])
    assert.equal(sources[0]!.contentDigest, ref.attachmentId.slice(7))
    assert.deepEqual(await fs.readdir(workspace), ['report.md'])
    await controller.inspectSessionOutputs(spec)
    const versions = await controller.listSessionOutputVersions({ sessionId: spec.sessionId, path: 'report.md' })
    assert.deepEqual(versions[0]!.sources, sources)
    await fs.chmod(hostPath, 0o600)
    await fs.writeFile(hostPath, 'corrupted')
    const after = await controller.inspectSessionOutputSources(spec)
    assert.equal(after[0]!.status, 'inaccessible')
    assert.equal(after[0]!.contentDigest, null)
    assert.deepEqual((await controller.listSessionOutputVersions({ sessionId: spec.sessionId, path: 'report.md' }))[0]!.sources, sources)
    const aborted = new AbortController()
    aborted.abort()
    await assert.rejects(controller.inspectSessionOutputSources(spec, aborted.signal))
  } finally {
    await ctx.fiber.dispose()
    await fs.rm(root, { recursive: true, force: true })
  }
})
