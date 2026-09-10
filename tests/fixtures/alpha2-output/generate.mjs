// Regenerate only with a separately installed, fully pinned alpha.2 package family.
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
const requireOld = createRequire(path.join(process.argv[2], 'package.json'))
for (const name of ['@deepseek-ai/dsh-session', '@deepseek-ai/dsh-session-persistence-jsonl']) {
  if (requireOld(name + '/package.json').version !== '0.1.2-alpha.2') throw new Error('Expected official alpha.2 writer')
}
const { Context } = await import(pathToFileURL(requireOld.resolve('@deepseek-ai/cordis')).href)
const { Session, default: SessionStore } = await import(pathToFileURL(requireOld.resolve('@deepseek-ai/dsh-session')).href)
const { default: JsonlPersistence } = await import(pathToFileURL(requireOld.resolve('@deepseek-ai/dsh-session-persistence-jsonl')).href)
function alpha2Events() {
  const args = JSON.stringify({ file_path: 'report.md', content: '# Historical report\n' })
  const block = { type: 'tool-call', id: 'write-report', name: 'write', arguments: args }
  const events = []
  const add = (type, data, extra = {}) => events.push({ type, seq: events.length, time: 100 + events.length, data, ...extra })
  add('turn/start', { turn: 1 })
  add('step/start', { turn: 1, step: 1 })
  add('user/message', { id: 'question', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Write report' }] }, { surfaceOp: 'append' })
  add('request/header', { header: { config: { provider: 'fixture', model: 'fixture' }, system: 'Write files' }, reason: 'initial' })
  for (const chunk of [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: args },
    { type: 'block-end', index: 0, block },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]) add('assistant/chunk', { turn: 1, step: 1, chunk })
  add('assistant/message', { turn: 1, step: 1, message: { id: 'assistant', role: 'assistant', source: { kind: 'model', provider: 'fixture', model: 'fixture' }, content: [block] } }, { surfaceOp: 'append', sourceEventSeqs: [4, 5, 6, 7] })
  add('tool/call', { turn: 1, step: 1, callId: block.id, name: block.name, arguments: args })
  add('tool/result', { turn: 1, step: 1, message: { id: 'result', role: 'user', source: { kind: 'tool', callId: block.id }, content: [{ type: 'tool-result', toolCallId: block.id, isError: false, content: [{ type: 'text', text: 'Written' }] }] } }, { surfaceOp: 'append' })
  add('step/end', { turn: 1, step: 1 })
  add('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return events
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-alpha2-writer-'))
const ctx = new Context()
try {
  const id = 'alpha2-output'
  const session = Session.create(id, undefined, { version: 0, id, createdAt: 1, delegationDepth: 0 })
  for (const row of alpha2Events()) {
    const savedNow = Date.now
    Date.now = () => row.time
    try {
      session.append(row.type, row.data, { ...(row.surfaceOp ? { surfaceOp: row.surfaceOp } : {}),
        ...(row.sourceEventSeqs ? { sourceEventSeqs: row.sourceEventSeqs } : {}) })
    } finally { Date.now = savedNow }
  }
  new SessionStore(ctx)
  const writer = new JsonlPersistence(ctx, { root, compression: 'none' })
  await writer.create(session.header)
  await writer.append(id, session.events)
  const inspected = await writer.inspect(id)
  const location = writer.locate(session.header)
  await fs.copyFile(location.path, new URL('./session.jsonl', import.meta.url))
  await fs.writeFile(new URL('./events.json', import.meta.url), JSON.stringify(inspected.events, null, 2) + '\n')
} finally {
  await ctx.fiber.dispose()
  await fs.rm(root, { recursive: true, force: true })
}
