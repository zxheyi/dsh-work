import fs from 'node:fs/promises'
export const name = 'live-release-setup'
export const inject = ['dshHomePath', 'workspaceRegistry', 'sessionController', 'llm']
// Seed only an empty synthetic workspace/session. All inference and tools remain upstream-owned.
export async function apply(context) {
  context.on('llm/stream', async function* (options, next) {
    const latest = [...options.messages].reverse().find(message => message.source?.kind === 'user')
    const text = latest?.content?.filter(block => block.type === 'text').map(block => block.text).join('') ?? ''
    const markers = [...new Set(text.match(/RELEASE_[A-Z_]+/g) ?? [])].slice(0, 8)
    if (markers.length) await fs.appendFile(context.dshHomePath('live-request-markers.jsonl'), JSON.stringify({markers}) + '\n')
    yield* next()
  }, { global: true })

  const marker = context.dshHomePath('live-release-seeded')
  try { await fs.access(marker); return } catch {}
  const root = context.dshHomePath('live-workspace')
  await fs.mkdir(root, { recursive: true })
  const workspace = await context.workspaceRegistry.create(root, 'Release validation')
  await context.sessionController.create({ sessionId: 'd5031b2a-28c6-4b5e-bb05-a8fdc46b0101', workspaceId: workspace.id })
  await fs.writeFile(marker, 'seeded')
}
