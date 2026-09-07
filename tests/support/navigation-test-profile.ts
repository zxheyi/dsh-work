import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/navigation-test-setup')

export const NAVIGATION_TEST_BASELINE_FILE = 't05-navigation-baseline.json'
export const NAVIGATION_TEST_ARCHIVE_FILE = 't05-archive-observed'

export function installNavigationTestProfile(home: string): void {
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
  manifest.dsh.profile.bundles.push('@dsh-work/navigation-test-setup')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest))
  const installed = path.join(profile, 'node_modules/@dsh-work/navigation-test-setup')
  fs.cpSync(fixture, installed, { recursive: true })
  fs.writeFileSync(path.join(installed, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: dsh-work-navigation-test-setup',
    "      name: '@dsh-work/navigation-test-setup'",
    '',
    '- id: agent-default-model',
    "  name: '@deepseek-ai/dsh-agent-default-model'",
    '  config:',
    '    provider: dsh-work-navigation-test',
    '    model: navigation-chat',
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
  fs.symlinkSync(
    path.dirname(llmPackage),
    path.join(profile, 'node_modules/@deepseek-ai/dsh-llm'),
    'junction',
  )
}
