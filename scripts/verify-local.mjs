import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { productRuntimeFailureCode, verifyProductRuntime } from './verify-product-runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'artifacts/verification')
fs.mkdirSync(output, { recursive: true })
const report = { status: 'fail', phase: 'read-context', platform: process.platform, arch: process.arch,
  startedAt: new Date().toISOString(), checks: [], provenance: [],
  limitations: ['development direct-child scope only', 'no complete process-tree or host-crash recovery proof',
    'no installer, signing, complete dependency byte/license audit, or full Harness browser UI',
    'screenshots are not product-approved visual acceptance', 'one native report does not prove another OS'],
}
const write = () => fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
write() // Invalidate an old success before even parsing the context.
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
const inputs = () => Object.fromEntries([...new Set(git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean))]
  .sort().map(file => [file, hash(fs.readFileSync(path.join(root, file)))]))
try {
  const context = JSON.parse(fs.readFileSync(process.argv[2]))
  report.revision = git('rev-parse', 'HEAD').trim()
  report.dirty = !!git('status', '--porcelain').trim()
  report.inputsSHA256 = inputs()
  let before
  const provenance = label => {
    report.phase = `${label}-provenance`; write()
    try {
      const value = verifyProductRuntime(context)
      if (before && JSON.stringify(before) !== JSON.stringify(value)) throw new Error('changed')
      report.provenance.push({ label, status: 'pass' }); write()
      return value
    } catch (error) {
      report.provenance.push({ label, status: 'fail', code: productRuntimeFailureCode(error) }); write()
      throw error
    }
  }
  report.before = before = provenance('before')
  const run = (name, args) => {
    report.phase = name; write()
    const startedAt = new Date().toISOString()
    const result = spawnSync(context.node, args, { cwd: root, shell: false,
      env: { ...process.env, DSH_WORK_NODE: context.node },
      encoding: 'utf8', timeout: 240_000, maxBuffer: 1024 * 1024 })
    const log = `${result.stdout || ''}${result.stderr || ''}`
    fs.writeFileSync(path.join(output, `${name}.log`), log)
    report.checks.push({ name, command: ['verified-node', ...args], exitCode: result.status,
      startedAt, finishedAt: new Date().toISOString(), log: `${name}.log`, sha256: hash(log) })
    write()
    if (result.status !== 0) throw new Error('check failed')
    console.log(`${name}: pass`)
  }
  const scriptTests = fs.readdirSync(path.join(root, 'scripts')).filter(file => file.endsWith('.test.mjs')).map(file => `scripts/${file}`)
  run('unit', ['--test', '--test-reporter=tap', ...scriptTests,
    'tests/runtime-host.test.mjs', 'tests/official-launcher.test.mjs', 'tests/desktop-security.test.mjs', 'tests/renderer.test.mjs'])
  provenance('after-unit')
  run('contract', ['scripts/verify-contract.mjs'])
  provenance('after-contract')
  run('runtime', ['--test', '--test-reporter=tap', 'tests/runtime-integration.test.mjs'])
  provenance('after-runtime')
  if (process.argv.includes('--desktop')) {
    const modes = ['normal', 'missing', 'renderer-crash', 'runtime-recovery']
    for (const mode of modes) {
      run(`desktop-${mode}`, ['scripts/run-desktop-test.mjs', '--mode', mode])
      provenance(`after-desktop-${mode}`)
    }
    report.desktop = modes.map(mode => JSON.parse(fs.readFileSync(path.join(root, 'artifacts/desktop', mode, 'result.json'))))
  } else report.desktop = 'not-run: explicit --desktop required'
  report.after = provenance('after')
  if (JSON.stringify(report.before) !== JSON.stringify(report.after) ||
      JSON.stringify(report.inputsSHA256) !== JSON.stringify(inputs()) ||
      report.revision !== git('rev-parse', 'HEAD').trim()) throw new Error('inputs changed during verification')
  report.status = process.argv.includes('--desktop') ? 'local-development-pass' : 'headless-development-pass'
  report.phase = 'complete'
} catch {
  console.error(`Local verification failed during ${report.phase}`)
  process.exitCode = 1
} finally { report.finishedAt = new Date().toISOString(); write() }
