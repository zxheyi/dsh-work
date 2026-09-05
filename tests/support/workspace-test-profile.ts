import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const fixture = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/workspace-test-setup',
)
const require = createRequire(import.meta.url)

export const WORKSPACE_TEST_AUDIT_FILE = 't04-workspace-baseline.json'
export const WORKSPACE_TEST_NATIVE_SESSION_FILE = 't04-native-session.json'

export function installWorkspaceTestProfile(home: string, phase: 'create' | 'restore'): void {
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
  manifest.dsh.profile.bundles.push('@dsh-work/workspace-test-setup')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest))

  const scope = path.join(profile, 'node_modules/@dsh-work')
  const installedFixture = path.join(scope, 'workspace-test-setup')
  fs.cpSync(fixture, installedFixture, { recursive: true })
  fs.writeFileSync(path.join(installedFixture, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: dsh-work-workspace-test-setup',
    "      name: '@dsh-work/workspace-test-setup'",
    '      config:',
    `        phase: ${phase}`,
    '',
    '- id: agent-default-model',
    "  name: '@deepseek-ai/dsh-agent-default-model'",
    '  config:',
    '    provider: dsh-work-workspace-test',
    '    model: workspace-chat',
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
  if (!fs.existsSync(llmLink)) fs.symlinkSync(path.dirname(llmPackage), llmLink, 'junction')
}
