import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'

import { LlmAdapter } from '@deepseek-ai/dsh-llm'

const PROVIDER = 'dsh-work-navigation-test'
const SESSION_A = '8d922a13-e767-47e4-b577-c2caadc95095'
const SESSION_B = '8dfcebc8-42a2-4b7f-a56f-362ea5055cad'
const PROMPT_A = '只属于甲会话的深海蓝资料。'
const PROMPT_B = '只属于乙会话的珊瑚红资料。'
const MODEL = Object.freeze({
  provider: PROVIDER,
  id: 'navigation-chat',
  name: '导航验收模型',
  inputModalities: Object.freeze(['text']),
})
const digest = value => createHash('sha256').update(value).digest('hex')
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

class NavigationAdapter extends LlmAdapter {
  providerInfo() { return { id: PROVIDER, name: 'DSH Work 导航验收' } }
  listModels() { return Promise.resolve([MODEL]) }
  resolveModel() { return Promise.resolve(MODEL) }
  async * stream(options) {
    const text = options.purpose === 'session-title'
      ? options.sessionId === SESSION_A ? '会话甲' : '会话乙'
      : options.sessionId === SESSION_A ? '甲会话回复。' : '乙会话回复。'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function waitForPrompt(context, sessionId, prompt) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const inspected = await context.sessionController.inspect(sessionId)
    if (JSON.stringify(inspected.events).includes(prompt)) return
    await sleep(50)
  }
  throw new Error(`Session ${sessionId} did not persist its fixture prompt`)
}

export const name = 'dsh-work-navigation-test-setup'
export const inject = ['dshHomePath', 'llm', 'workspaceRegistry', 'sessionController']

export async function apply(context) {
  const registration = context.llm.registerAdapter([PROVIDER], new NavigationAdapter())
  context.effect(() => registration)
  const workspacePath = context.dshHomePath('t05-navigation-workspace')
  await fs.mkdir(workspacePath, { recursive: true })
  const files = [
    ['alpha-only.md', 'alpha workspace bytes\n'],
    ['beta-only.md', 'beta workspace bytes\n'],
  ]
  for (const [name, content] of files) await fs.writeFile(`${workspacePath}/${name}`, content, { flag: 'wx' })
  const workspace = await context.workspaceRegistry.create(workspacePath, '导航工作区')
  for (const [sessionId, requestId, prompt, title] of [
    [SESSION_A, 't05-prompt-a', PROMPT_A, '会话甲'],
    [SESSION_B, 't05-prompt-b', PROMPT_B, '会话乙'],
  ]) {
    await context.sessionController.create({ sessionId, workspaceId: workspace.id })
    await context.sessionController.selectModel({ sessionId, provider: PROVIDER, model: MODEL.id })
    await context.sessionController.prompt({
      requestId,
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: prompt }],
    }, new AbortController().signal)
    await waitForPrompt(context, sessionId, prompt)
    await context.sessionController.rename({ sessionId, title })
  }
  await fs.writeFile(context.dshHomePath('t05-navigation-baseline.json'), JSON.stringify({
    workspaceId: workspace.id,
    workspacePath,
    sessionA: SESSION_A,
    sessionB: SESSION_B,
    promptA: PROMPT_A,
    promptB: PROMPT_B,
    files: files.map(([name, content]) => ({
      path: `${workspacePath}/${name}`,
      digest: digest(content),
    })),
  }, null, 2), { flag: 'wx' })
  const poll = setInterval(() => {
    if (!context.workspaceRegistry.archivedSessionIds.includes(SESSION_B)) return
    clearInterval(poll)
    void fs.writeFile(context.dshHomePath('t05-archive-observed'), `${SESSION_B}\n`, { flag: 'wx' })
  }, 50)
  context.effect(() => () => clearInterval(poll))
}
