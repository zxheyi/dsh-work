import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { inspectPng } from './png-evidence.mjs'

const root = path.resolve(import.meta.dirname, '..')
const manifestPath = path.join(root, 'docs/acceptance/familiar-work-v5-evidence.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const acceptanceRoot = path.dirname(manifestPath)

const fail = message => { throw new Error(`Familiar v5 acceptance evidence invalid: ${message}`) }
const exactIds = (values, expected, label) => {
  const actual = values.map(value => value.id).sort()
  const wanted = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) fail(`${label} ids do not match`)
}
const exactValues = (actual, expected, label) => {
  const values = [...actual].sort()
  const wanted = [...expected].sort()
  if (JSON.stringify(values) !== JSON.stringify(wanted)) fail(`${label} do not match`)
}
const readEvidence = relativePath => {
  const absolutePath = path.resolve(acceptanceRoot, relativePath)
  if (!absolutePath.startsWith(`${root}${path.sep}`)) fail(`path escapes repository root: ${relativePath}`)
  return fs.readFileSync(absolutePath)
}
const readRepositoryFile = relativePath => {
  const absolutePath = path.resolve(root, relativePath)
  if (!absolutePath.startsWith(`${root}${path.sep}`)) fail(`path escapes repository root: ${relativePath}`)
  return fs.readFileSync(absolutePath)
}
const readPng = relativePath => {
  const data = readEvidence(relativePath)
  let dimensions
  try {
    dimensions = inspectPng(data, relativePath)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
  const { width, height } = dimensions
  if (width < 390 || height < 390) fail(`undersized screenshot: ${relativePath}`)
  return { data, width, height }
}

if (manifest.schema !== 'dsh-work.familiar-v5-evidence.v1') fail('unknown schema')
if (!/^[a-f0-9]{40}$/u.test(manifest.productBaseRevision)) fail('invalid product base revision')
if (manifest.overallStatus !== 'pending-human-observation') fail('overall status must remain pending')

const revision = spawnSync('git', ['merge-base', '--is-ancestor', manifest.productBaseRevision, 'HEAD'], {
  cwd: root,
  stdio: 'ignore',
})
if (revision.status !== 0) fail('product base revision is not an ancestor of HEAD')

exactValues(manifest.capturedSources.map(source => source.path), [
  'packages/work-api/surface.ts',
  'tests/native-conversation-e2e.ts',
  'tests/workspace-sessions-e2e.ts',
  'tests/session-navigation-e2e.ts',
  'tests/session-resource-e2e.ts',
  'tests/runtime-context-e2e.ts',
  'tests/session-output-e2e.ts',
  'tests/session-permission-e2e.ts',
], 'captured source paths')
for (const source of manifest.capturedSources) {
  if (!/^[a-f0-9]{64}$/u.test(source.sha256)) fail(`invalid source digest for ${source.path}`)
  const digest = createHash('sha256').update(readRepositoryFile(source.path)).digest('hex')
  if (digest !== source.sha256) fail(`source digest mismatch for ${source.path}`)
}

exactIds(manifest.designs, [
  '01-new-conversation', '02-permission', '03-file-review', '04-version-comparison',
], 'design')
exactIds(manifest.supplementalStates, [
  'model-unavailable', 'generation', 'empty-workspace', 'search-no-results',
  'permission-denied', 'revision-failure', 'runtime-restored', 'responsive-736', 'responsive-390',
  'responsive-versions-736', 'responsive-versions-390',
], 'supplemental state')
exactIds(manifest.scenarios, [
  'onboard', 'new', 'attach', 'review', 'modify', 'save', 'permission', 'failure',
], 'scenario')
exactIds(manifest.criteria, Array.from({ length: 13 }, (_, index) => `F${String(index + 1)}`), 'criterion')
const knownCriteria = new Set(manifest.criteria.map(criterion => criterion.id))
const expectedCommands = [
  'pnpm test:conversation',
  'pnpm test:workspace-sessions',
  'pnpm test:session-navigation',
  'pnpm test:session-resource',
  'pnpm test:session-output',
  'pnpm test:session-permission',
  'pnpm test:runtime-context',
]
exactValues(manifest.executions.map(execution => execution.command), expectedCommands, 'execution commands')

for (const design of manifest.designs) readPng(design.target)
for (const evidence of [...manifest.designs, ...manifest.supplementalStates]) {
  if (!/^[a-f0-9]{64}$/u.test(evidence.sha256)) fail(`invalid digest for ${evidence.id}`)
  const { data } = readPng(evidence.actual)
  const digest = createHash('sha256').update(data).digest('hex')
  if (digest !== evidence.sha256) fail(`digest mismatch for ${evidence.id}`)
}
const coveredCriteria = new Set()
for (const item of [...manifest.designs, ...manifest.supplementalStates, ...manifest.scenarios]) {
  if (!Array.isArray(item.criteria) || item.criteria.length < 1) fail(`criteria missing for ${item.id}`)
  for (const criterion of item.criteria) {
    if (!knownCriteria.has(criterion)) fail(`unknown criterion ${criterion} referenced by ${item.id}`)
    coveredCriteria.add(criterion)
  }
}
for (let index = 1; index <= 12; index += 1) {
  if (!coveredCriteria.has(`F${index}`)) fail(`F${index} has no evidence mapping`)
}
const executionCommands = new Set(manifest.executions.map(execution => execution.command))
for (const scenario of manifest.scenarios) {
  if (scenario.status !== 'automated-pass' || scenario.commands.length < 1) {
    fail(`scenario lacks executed automated evidence: ${scenario.id}`)
  }
  for (const command of scenario.commands) {
    if (!executionCommands.has(command)) fail(`unknown command ${command} referenced by ${scenario.id}`)
  }
}
for (const execution of manifest.executions) {
  if (!Array.isArray(execution.results) || execution.results.length < 1) fail(`results missing for ${execution.command}`)
  for (const result of execution.results) {
    if (!/^[a-f0-9]{64}$/u.test(result.sha256)) fail(`invalid result digest for ${execution.command}`)
    const data = readEvidence(result.path)
    const digest = createHash('sha256').update(data).digest('hex')
    if (digest !== result.sha256) fail(`result digest mismatch for ${execution.command}`)
    let parsed
    try {
      parsed = JSON.parse(data.toString('utf8'))
    } catch {
      fail(`result is not JSON for ${execution.command}`)
    }
    if (parsed.status !== 'pass') fail(`result is not passing for ${execution.command}`)
  }
}
for (const criterion of manifest.criteria) {
  const expected = criterion.id === 'F13' ? 'pending-human-observation' : 'automated-pass'
  if (criterion.status !== expected) fail(`incorrect status for ${criterion.id}`)
}
if (!manifest.pending.some(item => item.id === 'F13')) fail('human observation is not listed as pending')

console.log(`Familiar v5 evidence verified: ${manifest.designs.length} designs, ${manifest.supplementalStates.length} supplemental states, ${manifest.scenarios.length} scenarios, ${manifest.executions.length} frozen executions; F13 remains pending.`)
