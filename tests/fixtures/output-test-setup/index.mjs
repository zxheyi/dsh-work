import fs from 'node:fs/promises'

import { LlmAdapter } from '@deepseek-ai/dsh-llm'

const PROVIDER = 'dsh-work-output-test'
const SESSION_A = '836a3da6-f668-4aa6-b0a4-d18e3b6e66ec'
const SESSION_B = 'f2250bfd-accc-4acf-b39a-9ca687cd5f07'
const ORDINARY_PROMPT = '只进行普通回复，不生成文件'
const GENERATE_A_PROMPT = '生成甲会话的两个真实文件'
const GENERATE_B_PROMPT = '生成乙会话的一个真实文件'
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const MODEL = Object.freeze({
  provider: PROVIDER,
  id: 'output-chat',
  name: '成果验收模型',
  inputModalities: Object.freeze(['text']),
})

function textOf(message) {
  return (message?.content ?? [])
    .filter(block => block?.type === 'text')
    .map(block => block.text)
    .join('')
}

function emitText(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function toolCall(index, id, filePath, content) {
  const args = JSON.stringify({ file_path: filePath, content })
  return [
    { type: 'block-start', index, blockType: 'tool-call' },
    { type: 'tool-call-delta', index, id, name: 'write', argumentsDelta: args },
    { type: 'block-end', index, block: { type: 'tool-call', id, name: 'write', arguments: args } },
  ]
}

class OutputAdapter extends LlmAdapter {
  providerInfo() { return { id: PROVIDER, name: 'DSH Work 成果验收' } }
  listModels() { return Promise.resolve([MODEL]) }
  resolveModel() { return Promise.resolve(MODEL) }
  async * stream(options) {
    if (options.purpose === 'session-title') {
      yield * emitText(options.sessionId === SESSION_A ? '成果会话甲' : '成果会话乙')
      return
    }
    const latest = [...options.messages].reverse().find(message =>
      message?.source?.kind === 'user' || message?.source?.kind === 'tool')
    if (latest?.source?.kind === 'tool') {
      yield * emitText('真实文件已经生成。')
      return
    }
    const prompt = textOf(latest)
    if (prompt.includes(GENERATE_A_PROMPT)) {
      for (const event of toolCall(0, 'output-a-markdown', 'report-a.md', '# 甲报告\n')) yield event
      for (const event of toolCall(1, 'output-a-csv', 'report-b.csv', 'name,value\nalpha,1\n')) yield event
      for (const event of toolCall(2, 'output-a-empty', 'empty.md', '')) yield event
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    if (prompt.includes(GENERATE_B_PROMPT)) {
      for (const event of toolCall(0, 'output-b-markdown', 'other-session.md', '# 乙报告\n')) yield event
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield * emitText(prompt.includes(ORDINARY_PROMPT) ? '这是没有文件的普通回复。' : '成果会话已就绪。')
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

export const name = 'dsh-work-output-test-setup'
export const inject = ['dshHomePath', 'llm', 'workspaceRegistry', 'sessionController']

export async function apply(context) {
  const registration = context.llm.registerAdapter([PROVIDER], new OutputAdapter())
  context.effect(() => registration)
  const workspacePath = context.dshHomePath('t08-output-workspace')
  await fs.mkdir(workspacePath, { recursive: true })
  const workspace = await context.workspaceRegistry.create(workspacePath, '成果工作区')
  for (const [sessionId, requestId, prompt, title] of [
    [SESSION_A, 't08-bootstrap-a', '成果夹具甲已准备', '成果会话甲'],
    [SESSION_B, 't08-bootstrap-b', '成果夹具乙已准备', '成果会话乙'],
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
  await fs.writeFile(context.dshHomePath('t08-output-baseline.json'), JSON.stringify({
    sessionA: SESSION_A,
    sessionB: SESSION_B,
    ordinaryPrompt: ORDINARY_PROMPT,
    generateAPrompt: GENERATE_A_PROMPT,
    generateBPrompt: GENERATE_B_PROMPT,
    workspacePath,
  }, null, 2), { flag: 'wx' })
}
