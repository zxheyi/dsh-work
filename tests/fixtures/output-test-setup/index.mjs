import fs from 'node:fs/promises'

import { LlmAdapter } from '@deepseek-ai/dsh-llm'

const PROVIDER = 'dsh-work-output-test'
const SESSION_A = '836a3da6-f668-4aa6-b0a4-d18e3b6e66ec'
const SESSION_B = 'f2250bfd-accc-4acf-b39a-9ca687cd5f07'
const ORDINARY_PROMPT = '只进行普通回复，不生成文件'
const GENERATE_A_PROMPT = '生成甲会话的两个真实文件'
const GENERATE_B_PROMPT = '生成乙会话的一个真实文件'
const REVISION_FAIL_PROMPT = '执行失败修改夹具'
const REVISION_SUCCESS_PROMPT = '执行成功修改夹具'
const REPORT_A = [
  '# 甲报告',
  '',
  '本周结论已经整理完成。',
  '',
  '## 行动项',
  '',
  '- 产品：整理试用反馈。',
  '- 研发：核对导出与恢复。',
  '',
  '<script>globalThis.__dshWorkPreviewExecuted = true</script>',
  '![外部图片](https://example.invalid/tracker.png)',
  '',
].join('\n')
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

function toolCall(index, id, name, argsValue) {
  const args = JSON.stringify(argsValue)
  return [
    { type: 'block-start', index, blockType: 'tool-call' },
    { type: 'tool-call-delta', index, id, name, argumentsDelta: args },
    { type: 'block-end', index, block: { type: 'tool-call', id, name, arguments: args } },
  ]
}

function referencedPath(text) {
  return /@(?:"([^"\r\n]+)"|([^\s"'<>]+))/u.exec(text)?.slice(1).find(Boolean) ?? null
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
    const latestUser = [...options.messages].reverse().find(message => message?.source?.kind === 'user')
    const userPrompt = textOf(latestUser)
    if (latest?.source?.kind === 'tool') {
      if (userPrompt.includes(REVISION_FAIL_PROMPT)) {
        if (latest.source.callId === 'output-a-revision-read-fail') {
          for (const event of toolCall(0, 'output-a-revision-empty', 'write', { file_path: 'report-a.md', content: '' })) yield event
          yield { type: 'finish', reason: { kind: 'tool-calls' } }
          return
        }
        yield * emitText('修改没有生成有效文件。')
        return
      }
      if (userPrompt.includes(REVISION_SUCCESS_PROMPT)) {
        if (latest.source.callId === 'output-a-revision-read-success') {
          for (const event of toolCall(0, 'output-a-revision-valid', 'write', { file_path: 'report-a.md', content: '# 甲报告（已修改）\n\n修改成功。\n' })) yield event
          yield { type: 'finish', reason: { kind: 'tool-calls' } }
          return
        }
        yield * emitText('修改后的文件已经生成。')
        return
      }
      if (userPrompt.includes(GENERATE_A_PROMPT) && latest.source.callId === 'output-a-read') {
        for (const event of toolCall(0, 'output-a-markdown', 'write', { file_path: 'report-a.md', content: REPORT_A })) yield event
        for (const event of toolCall(1, 'output-a-csv', 'write', { file_path: 'report-b.csv', content: 'name,value\nalpha,1\n' })) yield event
        for (const event of toolCall(2, 'output-a-empty', 'write', { file_path: 'empty.md', content: '' })) yield event
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
        return
      }
      yield * emitText('真实文件已经生成。')
      return
    }
    const prompt = textOf(latest)
    if (prompt.includes(REVISION_FAIL_PROMPT)) {
      for (const event of toolCall(0, 'output-a-revision-read-fail', 'read', { file_path: 'report-a.md' })) yield event
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    if (prompt.includes(REVISION_SUCCESS_PROMPT)) {
      for (const event of toolCall(0, 'output-a-revision-read-success', 'read', { file_path: 'report-a.md' })) yield event
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    if (prompt.includes(GENERATE_A_PROMPT)) {
      const sourcePath = referencedPath(prompt)
      if (!sourcePath) {
        yield * emitText('没有收到可读取的资料。')
        return
      }
      for (const event of toolCall(0, 'output-a-read', 'read', { file_path: sourcePath })) yield event
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    if (prompt.includes(GENERATE_B_PROMPT)) {
      for (const event of toolCall(0, 'output-b-markdown', 'write', { file_path: 'other-session.md', content: '# 乙报告\n' })) yield event
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
    revisionFailPrompt: REVISION_FAIL_PROMPT,
    revisionSuccessPrompt: REVISION_SUCCESS_PROMPT,
    workspacePath,
  }, null, 2), { flag: 'wx' })
}
