import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'

import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'

const PROVIDER = 'dsh-work-permission-test'
const SESSION_A = 'edc0a87d-ff69-42cf-865f-f8178a8ba2dc'
const SESSION_B = 'fcbf1e13-4194-4d04-a46f-9d6abc231202'
const ALLOW_PROMPT = '执行需要授权的甲操作'
const REJECT_PROMPT = '再次执行需要授权的乙操作'
const CONTINUE_PROMPT = '拒绝之后继续普通聊天'
const TOOL_NAME = 'permission_probe'
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const MODEL = Object.freeze({
  provider: PROVIDER,
  id: 'permission-chat',
  name: '权限验收模型',
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

class PermissionAdapter extends LlmAdapter {
  providerInfo() { return { id: PROVIDER, name: 'DSH Work 权限验收' } }
  listModels() { return Promise.resolve([MODEL]) }
  resolveModel() { return Promise.resolve(MODEL) }
  async * stream(options) {
    if (options.purpose === 'session-title') {
      yield * emitText(options.sessionId === SESSION_A ? '权限会话甲' : '权限会话乙')
      return
    }
    const latest = [...options.messages].reverse().find(message =>
      message?.source?.kind === 'user' || message?.source?.kind === 'tool')
    if (latest?.source?.kind === 'tool') {
      const result = latest.content?.[0]
      const denied = result?.type === 'tool-result' && result.isError === true
      yield * emitText(denied ? '已拒绝，本次受限操作没有执行。' : '已按本次授权完成对应操作。')
      return
    }
    const prompt = textOf(latest)
    const token = prompt.includes(ALLOW_PROMPT) ? 'allow' : prompt.includes(REJECT_PROMPT) ? 'reject' : null
    if (token) {
      const id = `permission-${token}-call`
      const args = JSON.stringify({ token })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: TOOL_NAME, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: TOOL_NAME, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield * emitText(prompt.includes(CONTINUE_PROMPT) ? '拒绝不会阻断后续普通聊天。' : '普通会话已就绪。')
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

export const name = 'dsh-work-permission-test-setup'
export const inject = ['dshHomePath', 'llm', 'tools', 'workspaceRegistry', 'sessionController']

export async function apply(context) {
  const actionPath = context.dshHomePath('t07-permission-actions.log')
  const registration = context.llm.registerAdapter([PROVIDER], new PermissionAdapter())
  context.effect(() => registration)
  context.tools.register(defineTool({
    name: TOOL_NAME,
    description: 'Write one deterministic permission acceptance marker.',
    parameters: {
      token: { type: 'string', required: true, description: 'Acceptance request token.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { recorded: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `Recorded ${value.recorded}` }],
    },
    async execute(args) {
      await fs.appendFile(actionPath, `${args.token}\n`)
      return { recorded: args.token }
    },
  }))
  context.on('tools/pre-execute', (exec, next) => exec.name === TOOL_NAME
    ? Promise.resolve({
      kind: 'ask',
      reason: `写入当前权限验收记录（${exec.arguments.token}）；仅允许本次操作，不会修改其他文件。`,
    })
    : next())

  const workspacePath = context.dshHomePath('t07-permission-workspace')
  await fs.mkdir(workspacePath, { recursive: true })
  const files = [
    ['alpha-existing.md', 'alpha remains unchanged\n'],
    ['beta-existing.md', 'beta remains unchanged\n'],
  ]
  for (const [fileName, content] of files) await fs.writeFile(`${workspacePath}/${fileName}`, content, { flag: 'wx' })
  const workspace = await context.workspaceRegistry.create(workspacePath, '权限工作区')
  for (const [sessionId, requestId, prompt, title] of [
    [SESSION_A, 't07-bootstrap-a', '权限夹具甲已准备', '权限会话甲'],
    [SESSION_B, 't07-bootstrap-b', '权限夹具乙已准备', '权限会话乙'],
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
  await fs.writeFile(context.dshHomePath('t07-permission-baseline.json'), JSON.stringify({
    sessionA: SESSION_A,
    sessionB: SESSION_B,
    allowPrompt: ALLOW_PROMPT,
    rejectPrompt: REJECT_PROMPT,
    continuePrompt: CONTINUE_PROMPT,
    actionPath,
    files: files.map(([fileName, content]) => ({
      path: `${workspacePath}/${fileName}`,
      digest: createHash('sha256').update(content).digest('hex'),
    })),
  }, null, 2), { flag: 'wx' })
}
