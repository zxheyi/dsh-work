import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/chat-test-model')

export const CHAT_TEST_SESSION_ID = '4501ee7a-0790-46f3-a93d-2029e0fdbfd1'
export const CHAT_TEST_CONTROL_FILE = 't03-chat-connection.txt'
export const CHAT_TEST_CONNECTION_AUDIT_FILE = 't03-chat-connections.log'
export const CHAT_TEST_ABORT_FILE = 't03-chat-aborts.log'

export function installChatTestProfile(home: string, connected: boolean): void {
  fs.writeFileSync(path.join(home, 'settings.yaml'), [
    'ui-onboarding:',
    '  welcomeNoticeVersion: 2026-08-13.1',
    '',
  ].join('\n'))
  const profile = path.join(home, 'profiles/dsh-work')
  const manifestPath = path.join(profile, 'package.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    dsh: { profile: { bundles: string[] } }
  }
  manifest.dsh.profile.bundles.push('@dsh-work/chat-test-model')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest))

  const scope = path.join(profile, 'node_modules/@dsh-work')
  const installedFixture = path.join(scope, 'chat-test-model')
  fs.cpSync(fixture, installedFixture, { recursive: true })
  fs.writeFileSync(path.join(installedFixture, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: dsh-work-chat-test-model',
    "      name: '@dsh-work/chat-test-model'",
    '      config:',
    `        connected: ${connected ? 'true' : 'false'}`,
    '',
    '- id: agent-default-model',
    "  name: '@deepseek-ai/dsh-agent-default-model'",
    '  config:',
    `    provider: ${connected ? 'dsh-work-test' : 'dsh-work-missing'}`,
    `    model: ${connected ? 'chat-fast' : 'unavailable'}`,
    '',
    '- id: session-persistence-jsonl',
    "  name: '@deepseek-ai/dsh-session-persistence-jsonl'",
    '  config:',
    "    root: !!js dshHomePath('sessions')",
    '    compression: none',
    '',
  ].join('\n'))

  const dshPackage = require.resolve('@deepseek-ai/dsh/package.json')
  const llmPackage = require.resolve('@deepseek-ai/dsh-llm/package.json', {
    paths: [path.dirname(dshPackage)],
  })
  const llmLink = path.join(profile, 'node_modules/@deepseek-ai/dsh-llm')
  fs.symlinkSync(path.dirname(llmPackage), llmLink, 'junction')
}
