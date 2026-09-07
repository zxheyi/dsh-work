import fs from 'node:fs/promises'

import { LlmAdapter } from '@deepseek-ai/dsh-llm'

const PROVIDER = 'dsh-work-test'
const SESSION_ID = '4501ee7a-0790-46f3-a93d-2029e0fdbfd1'
const CONTROL_FILE = 't03-chat-connection.txt'
const CONNECTION_AUDIT_FILE = 't03-chat-connections.log'
const ABORT_FILE = 't03-chat-aborts.log'
const MODELS = Object.freeze([
  Object.freeze({
    provider: PROVIDER,
    id: 'chat-fast',
    name: '测试快速模型',
    description: 'T03 确定性普通聊天验收',
    inputModalities: Object.freeze(['text']),
  }),
  Object.freeze({
    provider: PROVIDER,
    id: 'chat-steady',
    name: '测试稳定模型',
    description: '用于验证切换模型时保留草稿',
    inputModalities: Object.freeze(['text']),
  }),
])

class ChatTestAdapter extends LlmAdapter {
  turns = 0

  constructor(abortPath) {
    super()
    this.abortPath = abortPath
  }

  providerInfo() {
    return { id: PROVIDER, name: 'DSH Work 测试连接' }
  }

  listModels() {
    return Promise.resolve(MODELS)
  }

  resolveModel(provider, model) {
    const entry = MODELS.find(candidate => candidate.id === model)
    return Promise.resolve(entry ?? { provider, id: model, name: model })
  }

  async * stream(options) {
    if (options.signal?.aborted) return
    const turn = options.purpose === 'session-title' ? 0 : ++this.turns
    const text = turn === 0 ? '普通聊天验收' : `这是第 ${String(turn)} 次普通回复。`
    yield { type: 'block-start', index: 0, blockType: 'text' }
    if (turn === 3) {
      await new Promise(resolve => {
        const timeout = setTimeout(resolve, 60_000)
        options.signal?.addEventListener('abort', () => {
          clearTimeout(timeout)
          resolve()
        }, { once: true })
      })
      if (options.signal?.aborted) {
        await fs.appendFile(this.abortPath, `${String(options.sessionId ?? 'unknown')}\n`)
        const error = new Error('测试会话已停止')
        error.name = 'AbortError'
        throw error
      }
    }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'dsh-work-chat-test-model'
export const inject = ['dshHomePath', 'llm', 'workspaceRegistry', 'sessionController']

export async function apply(context, config = {}) {
  const controlPath = context.dshHomePath(CONTROL_FILE)
  const registration = context.llm.registerAdapter(
    [PROVIDER],
    new ChatTestAdapter(context.dshHomePath(ABORT_FILE)),
  )
  let connected = true
  const setConnected = next => {
    if (next === connected) return
    registration.replace(next ? [PROVIDER] : [])
    connected = next
    void fs.appendFile(context.dshHomePath(CONNECTION_AUDIT_FILE), `${next ? 'connected' : 'disconnected'}\n`)
  }
  await fs.writeFile(controlPath, config.connected === true ? 'connected\n' : 'disconnected\n')
  setConnected(config.connected === true)
  let synchronizing = false
  const connectionPoll = setInterval(() => {
    if (synchronizing) return
    synchronizing = true
    void fs.readFile(controlPath, 'utf8').then(value => {
      setConnected(value.trim() === 'connected')
    }).finally(() => {
      synchronizing = false
    })
  }, 50)
  context.effect(() => () => {
    clearInterval(connectionPoll)
    registration()
  })
  const workspacePath = context.dshHomePath('t03-chat-workspace')
  await fs.mkdir(workspacePath, { recursive: true })
  const workspace = await context.workspaceRegistry.create(workspacePath, '普通聊天验收')
  await context.sessionController.create({
    sessionId: SESSION_ID,
    workspaceId: workspace.id,
  })
}
