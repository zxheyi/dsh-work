// Explicit desktop acceptance: execute every suite before replacing frozen evidence.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
const root = path.resolve(import.meta.dirname, '..')
if (process.platform !== 'darwin') throw new Error('this frozen evidence set requires native macOS')
const pnpm = process.env.npm_execpath
if (!pnpm || !fs.existsSync(pnpm)) throw new Error('run pnpm capture:familiar-v5')
const context = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/runtime/context.json')))
const acceptance = path.join(root, 'docs/acceptance')
const manifestPath = path.join(acceptance, 'familiar-work-v5-evidence.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const images = {
  '01-new-conversation': 'conversation/connected.png', '02-permission': 'session-permission/permission.png',
  '03-file-review': 'session-output/preview.png', '04-version-comparison': 'session-output/versions.png',
  'model-unavailable': 'conversation/missing.png', generation: 'conversation/generation.png',
  'empty-workspace': 'workspace-sessions/empty.png', 'search-no-results': 'session-navigation/no-results.png',
  'permission-denied': 'session-permission/denied.png', 'revision-failure': 'session-output/revision-failure.png',
  'runtime-restored': 'desktop/runtime-context/restored.png',
  'responsive-736': 'session-output/responsive-736.png', 'responsive-390': 'session-output/responsive-390.png',
  'responsive-versions-736': 'session-output/responsive-versions-736.png',
  'responsive-versions-390': 'session-output/responsive-versions-390.png',
}
const results = {
  'conversation-missing': 'conversation/missing-result.json', 'conversation-connected': 'conversation/connected-result.json',
  'workspace-sessions-empty': 'workspace-sessions/empty-result.json', 'workspace-sessions-create': 'workspace-sessions/create-result.json',
  'workspace-sessions-restore': 'workspace-sessions/restore-result.json', 'session-navigation': 'session-navigation/result.json',
  'session-resource': 'session-resource/result.json', 'session-output': 'session-output/result.json',
  'session-permission': 'session-permission/result.json', 'runtime-context': 'desktop/runtime-context/result.json',
}
// A failed execution must never consume an old passing result or screenshot.
for (const file of [...Object.values(images), ...Object.values(results)]) fs.rmSync(path.join(root, 'artifacts', file), { force: true })
for (const execution of manifest.executions) {
  execFileSync(process.execPath, [pnpm, execution.command.replace('pnpm ', '')], {
    cwd: root, env: { ...process.env, DSH_WORK_NODE: context.node }, stdio: 'inherit',
  })
}
const captured = []
for (const execution of manifest.executions) {
  for (const result of execution.results) {
    const name = path.basename(result.path, '.json')
    const bytes = fs.readFileSync(path.join(root, 'artifacts', results[name]))
    if (JSON.parse(bytes).status !== 'pass') throw new Error(`nonpassing result: ${name}`)
    result.sha256 = sha(bytes)
    captured.push([path.join(acceptance, result.path), bytes])
  }
}
for (const item of [...manifest.designs, ...manifest.supplementalStates]) {
  const bytes = fs.readFileSync(path.join(root, 'artifacts', images[item.id]))
  item.sha256 = sha(bytes)
  captured.push([path.join(acceptance, item.actual), bytes])
}
manifest.productBaseRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
manifest.capturedAt = new Date().toISOString()
manifest.capturedSources = ['packages/work-api/surface.ts', ...[
  'native-conversation', 'workspace-sessions', 'session-navigation', 'session-resource', 'session-output', 'session-permission', 'runtime-context',
].map(name => `tests/${name}-e2e.ts`)].map(file => ({ path: file, sha256: sha(fs.readFileSync(path.join(root, file))) }))
for (const [file, bytes] of captured) fs.writeFileSync(file, bytes)
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
execFileSync(process.execPath, ['scripts/verify-familiar-v5-acceptance.mjs'], { cwd: root, stdio: 'inherit' })
