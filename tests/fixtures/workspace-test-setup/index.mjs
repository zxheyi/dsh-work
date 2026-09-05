import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'

import { LlmAdapter } from '@deepseek-ai/dsh-llm'

const PROVIDER = 'dsh-work-workspace-test'
const BASELINE_FILE = 't04-workspace-baseline.json'
const NATIVE_SESSION_FILE = 't04-native-session.json'
const SENTINEL_CONTENT = 'legacy bytes stay in their original workspace\n'
const PRIMARY_PROMPT = '保留旧 Work 会话。'
const SECOND_PROMPT = '建立同目录的第二条会话。'
const MODEL = Object.freeze({
  provider: PROVIDER,
  id: 'workspace-chat',
  name: '工作区验收模型',
  inputModalities: Object.freeze(['text']),
})

const digest = value => createHash('sha256').update(value).digest('hex')
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

class WorkspaceTestAdapter extends LlmAdapter {
  constructor(primarySessionId) {
    super()
    this.primarySessionId = primarySessionId
  }
  providerInfo() { return { id: PROVIDER, name: 'DSH Work 工作区验收' } }
  listModels() { return Promise.resolve([MODEL]) }
  resolveModel() { return Promise.resolve(MODEL) }
  async * stream(options) {
    const text = options.purpose === 'session-title'
      ? options.sessionId === this.primarySessionId ? '旧 Work 会话' : '新增原生会话'
      : '会话已建立。'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function waitForSession(context, sessionId, expectedPrompt) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const listed = await context.sessionController.list({}, new AbortController().signal)
    const summary = listed.items.find(item => item.sessionId === sessionId)
    if (summary && !summary.blank) {
      const inspected = await context.sessionController.inspect(sessionId)
      if (JSON.stringify(inspected.events).includes(expectedPrompt)) return { summary, inspected }
    }
    await sleep(50)
  }
  throw new Error(`Session ${sessionId} did not persist its expected prompt`)
}

async function seedCreatePhase(context) {
  if (await context.workController.get() !== null) {
    throw new Error('create phase requires an empty Work store')
  }
  let work = await context.workController.create({
    title: '兼容工作区',
    goal: '验证旧 Work 映射到原生会话。',
  })
  const registration = context.llm.registerAdapter(
    [PROVIDER],
    new WorkspaceTestAdapter(work.primarySession.sessionId),
  )
  context.effect(() => registration)
  const sentinelPath = context.dshHomePath('workspaces', work.workId, 'existing.md')
  await fs.writeFile(sentinelPath, SENTINEL_CONTENT, { flag: 'wx' })
  work = await context.workController.dispatch({
    workId: work.workId,
    command: { type: 'record-file', path: 'existing.md' },
  })
  await context.sessionController.selectModel({
    sessionId: work.primarySession.sessionId,
    provider: PROVIDER,
    model: MODEL.id,
  })
  await context.sessionController.prompt({
    requestId: 't04-primary-prompt',
    sessionId: work.primarySession.sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: PRIMARY_PROMPT }],
  }, new AbortController().signal)
  await waitForSession(context, work.primarySession.sessionId, PRIMARY_PROMPT)
  const bytes = await fs.readFile(sentinelPath)
  const baseline = Object.freeze({
    workId: work.workId,
    workspaceId: work.workspace.workspaceId,
    workspacePath: work.workspace.path,
    primarySessionId: work.primarySession.sessionId,
    sentinelPath,
    sentinelBytes: bytes.toString('base64'),
    sentinelDigest: digest(bytes),
    primaryPrompt: PRIMARY_PROMPT,
  })
  await fs.writeFile(
    context.dshHomePath(BASELINE_FILE),
    JSON.stringify(baseline, null, 2),
    { flag: 'wx' },
  )

  let observing = false
  const poll = setInterval(() => {
    if (observing) return
    observing = true
    void context.sessionController.list({}, new AbortController().signal).then(async listed => {
      const second = listed.items.find(item => item.sessionId !== baseline.primarySessionId
        && item.cwd === baseline.workspacePath && !item.blank)
      if (!second) return
      const inspected = await context.sessionController.inspect(second.sessionId)
      if (!JSON.stringify(inspected.events).includes(SECOND_PROMPT)) return
      try {
        await fs.writeFile(context.dshHomePath(NATIVE_SESSION_FILE), JSON.stringify({
          secondSessionId: second.sessionId,
          workspaceId: baseline.workspaceId,
          workspacePath: baseline.workspacePath,
          secondPrompt: SECOND_PROMPT,
        }, null, 2), { flag: 'wx' })
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      }
      clearInterval(poll)
    }).finally(() => { observing = false })
  }, 50)
  context.effect(() => () => clearInterval(poll))
  return work
}

async function verifyRestorePhase(context) {
  const baseline = JSON.parse(await fs.readFile(context.dshHomePath(BASELINE_FILE), 'utf8'))
  const native = JSON.parse(await fs.readFile(context.dshHomePath(NATIVE_SESSION_FILE), 'utf8'))
  const work = await context.workController.get()
  if (!work
    || work.workId !== baseline.workId
    || work.workspace.workspaceId !== baseline.workspaceId
    || work.workspace.path !== baseline.workspacePath
    || work.primarySession.sessionId !== baseline.primarySessionId
    || native.workspaceId !== baseline.workspaceId
    || native.workspacePath !== baseline.workspacePath
    || native.secondSessionId === baseline.primarySessionId) {
    throw new Error('restored Work, Workspace, or Session identity changed')
  }
  const bytes = await fs.readFile(baseline.sentinelPath)
  if (bytes.toString('base64') !== baseline.sentinelBytes || digest(bytes) !== baseline.sentinelDigest) {
    throw new Error('existing legacy file changed across restart')
  }
  await waitForSession(context, baseline.primarySessionId, baseline.primaryPrompt)
  await waitForSession(context, native.secondSessionId, native.secondPrompt)
  return work
}

export const name = 'dsh-work-workspace-test-setup'
export const inject = ['dshHomePath', 'llm', 'workController', 'sessionController']

export async function apply(context, config = {}) {
  const phase = config.phase ?? 'create'
  if (phase !== 'create' && phase !== 'restore') throw new Error(`unknown T04 phase: ${phase}`)
  if (phase === 'create') {
    await seedCreatePhase(context)
    return
  }
  const work = await verifyRestorePhase(context)
  const registration = context.llm.registerAdapter(
    [PROVIDER],
    new WorkspaceTestAdapter(work.primarySession.sessionId),
  )
  context.effect(() => registration)
}
