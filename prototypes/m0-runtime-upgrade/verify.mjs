import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyCandidate } from '../../scripts/verify-upstream-candidate.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(root, '../..')
const artifacts = process.argv[3] || path.join(root, 'artifacts')
fs.mkdirSync(artifacts, { recursive: true })
const report = {
  status: 'candidate-native-probe-fail', phase: 'read-context',
  platform: process.platform, arch: process.arch, testedAt: new Date().toISOString(),
  limitations: ['not an accepted replacement for ADR 0002', 'not Electron or browser-interaction E2E',
    'not a product installer/package or complete dependency-byte/license inventory',
    'no descendant cleanup, interrupted-host recovery, or user-data migration proof'],
}
const writeReport = () => fs.writeFileSync(path.join(artifacts, 'result.json'), JSON.stringify(report, null, 2))
// Invalidate previous local success before even reading the new context.
writeReport()
fs.writeFileSync(path.join(artifacts, 'lifecycle.tap'), '')
try {
  const context = JSON.parse(fs.readFileSync(process.argv[2] || path.join(artifacts, 'context.json')))
  report.revision = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  report.phase = 'before-provenance'
  report.before = verifyCandidate(context)
  report.phase = 'lifecycle'
  const testRun = spawnSync(context.node, ['--test', '--test-reporter=tap', path.join(root, 'lifecycle.test.mjs')], {
    cwd: repo, env: { ...process.env, DSH_WORK_NODE: context.node },
    encoding: 'utf8', timeout: 180_000, maxBuffer: 1024 * 1024, shell: false,
  })
  // The test driver prints only whitelisted facts/assertions; Harness streams
  // never reach this output. No raw CLI capture is retained in CI artifacts.
  fs.writeFileSync(path.join(artifacts, 'lifecycle.tap'), testRun.stdout || '')
  process.stdout.write(testRun.stdout || '')
  if (testRun.stderr) process.stderr.write(testRun.stderr)
  report.lifecycleExitCode = testRun.status
  report.phase = 'after-provenance'
  report.after = verifyCandidate(context)
  const files = ['package.json', 'pnpm-lock.yaml', 'source-pin.json', 'runtime-pin.json',
    'lifecycle.test.mjs', 'output-guard.mjs', 'fixture/index.mjs', 'fixture/package.json', 'fixture/cordis.patch.yml',
    '../../scripts/verify-upstream-candidate.mjs', 'prepare.mjs', 'verify.mjs']
  report.inputsSHA256 = Object.fromEntries(files.map(file => [file,
    createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'),
  ]))
  const passed = testRun.status === 0 && JSON.stringify(report.before) === JSON.stringify(report.after)
  report.status = passed ? 'candidate-native-probe-pass' : 'candidate-native-probe-fail'
  report.phase = 'complete'
  if (!passed) process.exitCode = 1
} catch {
  // Failure phase is sufficient for published diagnostics; do not serialize
  // arbitrary subprocess stderr or a context file's contents into the report.
  console.error(`Candidate verification failed during ${report.phase}`)
  process.exitCode = 1
} finally { writeReport() }
