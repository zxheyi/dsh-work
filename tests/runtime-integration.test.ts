import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import {
  createRuntimeHost,
  type RuntimeChild,
  type RuntimeHost,
  type RuntimeHostSnapshot,
} from '../packages/runtime-host/index.ts'
import { prepareDevelopmentProfile, createOfficialLauncher } from '../packages/runtime-host/official-launcher.ts'
import { discoverLocalProfiles } from '../packages/runtime-profile/discovery.ts'
import { prepareShadowProfile } from '../packages/runtime-profile/shadow.ts'
import { pathToFileURL } from 'node:url'
import { createOutputGuard } from './support/runtime-output-guard.ts'

test('product Bundle runs through the official CLI for three ready/EOF/restart cycles', { timeout: 90_000 }, async () => {
  const node = process.env.DSH_WORK_NODE
  assert.ok(node, 'explicit standalone Node is required; no global fallback')
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-product-test-'))
  const guard = createOutputGuard(1024 * 1024)
  let host: RuntimeHost | null = null
  try {
    prepareDevelopmentProfile(home)
    const launch = createOfficialLauncher({ node, home })
    host = createRuntimeHost({ launch: () => {
      const child = launch()
      child.stdout.on('data', bytes => guard.observe(bytes, 'stdout'))
      child.stderr.on('data', bytes => guard.observe(bytes, 'stderr'))
      return child
    } })
    const surfaces: string[] = []
    host.subscribeSurface(url => surfaces.push(url))
    for (let cycle = 0; cycle < 3; cycle++) {
      const started: RuntimeHostSnapshot = await host.start()
      assert.equal(started.state, 'ready', started.code ?? 'runtime did not become ready')
      assert.equal(surfaces.length, cycle + 1)
      assert.match(surfaces[cycle] ?? '', /^http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+$/u)
      const stopped: RuntimeHostSnapshot = await host.stop()
      assert.equal(stopped.state, 'stopped')
      assert.equal(stopped.code, null)
    }
    assert.equal(guard.status().sensitive, false)
    assert.equal(guard.status().overflow, false)
  } finally {
    await host?.stop()
    // Only the explicit mkdtemp owned by this test is removed.
    if (!host || host.snapshot().canStart) fs.rmSync(home, { recursive: true, force: true })
  }
})

test('product early EOF does not hide an invalid Profile; the same owned home can retry', { timeout: 60_000 }, async () => {
  const node = process.env.DSH_WORK_NODE
  assert.ok(node)
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-rejection-test-'))
  let host: RuntimeHost | null = null
  try {
    prepareDevelopmentProfile(home)
    const patchPath = path.join(home, 'profiles/dsh-work/cordis.patch.yml')
    const original = fs.readFileSync(patchPath)
    const patch: unknown[] = JSON.parse(original.toString('utf8'))
    patch.push({ insert: [{ id: 'deliberate-invalid-plugin', name: '@dsh-work/not-installed' }] })
    fs.writeFileSync(patchPath, JSON.stringify(patch))
    host = createRuntimeHost({ launch: createOfficialLauncher({ node, home }) })
    const pending = host.start()
    const rejected = await host.stop()
    assert.equal(rejected.state, 'failed')
    assert.equal(rejected.code, 'runtime-exit-failed')
    assert.equal((await pending).state, 'failed')
    fs.writeFileSync(patchPath, original)
    assert.equal((await host.start()).state, 'ready')
    assert.equal((await host.stop()).state, 'stopped')
  } finally {
    await host?.stop()
    if (!host || host.snapshot().canStart) fs.rmSync(home, { recursive: true, force: true })
  }
})

test('product successful startup tolerates EOF before Ready', { timeout: 45_000 }, async () => {
  const node = process.env.DSH_WORK_NODE
  assert.ok(node)
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-early-stop-test-'))
  let host: RuntimeHost | null = null
  try {
    prepareDevelopmentProfile(home)
    host = createRuntimeHost({ launch: createOfficialLauncher({ node, home }) })
    const pending = host.start()
    assert.equal((await host.stop()).state, 'stopped')
    assert.equal((await pending).state, 'stopped')
  } finally {
    await host?.stop()
    if (!host || host.snapshot().canStart) fs.rmSync(home, { recursive: true, force: true })
  }
})

test('an abruptly terminated owned CLI reports failure and can explicitly retry without touching another process', { timeout: 60_000 }, async () => {
  const node = process.env.DSH_WORK_NODE
  assert.ok(node)
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-crash-retry-'))
  const guard = createOutputGuard(1024 * 1024)
  // The unrelated sentinel is also test-owned and self-expires if this test dies.
  const sentinel = spawn(node, ['-e',
    'process.stdin.resume(); process.stdin.on("end", () => process.exit(0)); setTimeout(() => process.exit(0), 60000)'],
  { shell: false, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] })
  sentinel.stdin.on('error', () => {})
  const sentinelClosed = once(sentinel, 'close')
  const events: string[] = []
  let host: RuntimeHost | null = null
  let child: RuntimeChild | null = null
  let launches = 0
  const subscription: { current: (() => void) | null } = { current: null }
  let timer: NodeJS.Timeout | undefined
  const activeChild = (): RuntimeChild => {
    assert.ok(child)
    return child
  }
  try {
    await once(sentinel, 'spawn')
    prepareDevelopmentProfile(home)
    const originalPatch = fs.readFileSync(path.join(home, 'profiles/dsh-work/cordis.patch.yml'))
    const launch = createOfficialLauncher({ node, home })
    const runtime = createRuntimeHost({ launch: () => {
      launches++
      if (launches > 1) assert.ok(events.includes('close:1'), 'replacement requires independently observed close')
      child = launch()
      const generation = launches
      child.once('exit', () => events.push(`exit:${generation}`))
      child.once('close', () => events.push(`close:${generation}`))
      child.stdout.on('data', bytes => guard.observe(bytes, 'stdout'))
      child.stderr.on('data', bytes => guard.observe(bytes, 'stderr'))
      return child
    } })
    host = runtime
    assert.equal((await runtime.start()).state, 'ready')
    const failed = new Promise<RuntimeHostSnapshot>((resolve, reject) => {
      timer = setTimeout(() => reject(Error('owned CLI did not reach a retryable failure')), 15_000)
      subscription.current = runtime.subscribe(value => {
        if (value.state === 'failed' && value.canStart) { clearTimeout(timer); resolve(value) }
      })
    })
    // Fault injection uses the exact retained ChildProcess, never a name or PID scan.
    assert.equal(activeChild().kill('SIGKILL'), true)
    const result = await failed
    assert.ok(result.code && ['unexpected-exit', 'lifecycle-disconnected'].includes(result.code))
    assert.equal(launches, 1, 'a failure never automatically restarts Harness')
    assert.deepEqual(events, ['exit:1', 'close:1'])
    assert.equal(sentinel.exitCode, null)
    assert.equal(sentinel.signalCode, null)
    assert.deepEqual(fs.readFileSync(path.join(home, 'profiles/dsh-work/cordis.patch.yml')), originalPatch)
    subscription.current?.()
    subscription.current = null
    assert.equal((await runtime.start()).state, 'ready')
    assert.equal(launches, 2)
    assert.equal((await runtime.stop()).state, 'stopped')
    assert.equal(sentinel.exitCode, null)
    assert.equal(sentinel.signalCode, null)
    assert.equal(guard.status().sensitive, false)
    assert.equal(guard.status().overflow, false)
  } finally {
    if (timer) clearTimeout(timer)
    subscription.current?.()
    sentinel.stdin.end()
    await sentinelClosed
    await host?.stop()
    if (!host || host.snapshot().canStart) fs.rmSync(home, { recursive: true, force: true })
  }
})

for (const reject of [true, false]) {
  test(`slow official CLI startup ${reject ? 'rejection' : 'success'} survives early EOF`, { timeout: 60_000 }, async t => {
    const node = process.env.DSH_WORK_NODE
    assert.ok(node)
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-delayed-startup-'))
    const guard = createOutputGuard(1024 * 1024)
    const timeline: Array<{ event: string; ms: number }> = []
    const startedAt = performance.now()
    const note = (event: string): void => { timeline.push({ event, ms: Math.round(performance.now() - startedAt) }) }
    let host: RuntimeHost | null = null
    let partial = ''
    try {
      prepareDevelopmentProfile(home)
      const profile = path.join(home, 'profiles/dsh-work')
      fs.cpSync(new URL('./fixtures/delayed-startup/', import.meta.url),
        path.join(profile, 'node_modules/@dsh-work/delayed-startup'), { recursive: true })
      const patchPath = path.join(profile, 'cordis.patch.yml')
      const patch: unknown[] = JSON.parse(fs.readFileSync(patchPath, 'utf8'))
      patch.push({ insert: [{ id: 'delayed-startup', name: '@dsh-work/delayed-startup', config: { reject } }] })
      fs.writeFileSync(patchPath, JSON.stringify(patch))
      const launch = createOfficialLauncher({ node, home })
      host = createRuntimeHost({ launch: () => {
        const child = launch()
        const kill = child.kill.bind(child)
        child.kill = signal => { note('force-requested'); return kill(signal) }
        child.on('message', (message: unknown) => {
          if (message && typeof message === 'object' && 'protocol' in message && 'event' in message &&
            message.protocol === 'dsh-work.lifecycle.v1' && typeof message.event === 'string' &&
            ['ready', 'disposed'].includes(message.event)) note(message.event)
        })
        child.on('exit', () => note('exit'))
        child.on('close', () => note('close'))
        child.stderr.on('data', chunk => guard.observe(chunk, 'stderr'))
        child.stdout.on('data', chunk => {
          guard.observe(chunk, 'stdout')
          if (guard.status().overflow) { partial = ''; return }
          partial += chunk.toString('utf8')
          const lines = partial.split('\n')
          partial = lines.pop() ?? ''
          // Retain only allowlisted test facts, never raw Harness diagnostics.
          for (const line of lines) {
            if (['dsh-work-delay:loaded', 'dsh-work-delay:rejected', 'dsh-work-delay:completed'].includes(line)) note(line)
          }
        })
        return child
      } })
      const pending = host.start()
      const stopped = await host.stop()
      assert.equal(stopped.state, reject ? 'failed' : 'stopped')
      assert.equal(stopped.code, reject ? 'runtime-exit-failed' : null)
      assert.deepEqual(await pending, stopped)
      const events = timeline.map(value => value.event)
      assert.ok(events.includes('dsh-work-delay:loaded'))
      assert.ok(events.includes(`dsh-work-delay:${reject ? 'rejected' : 'completed'}`))
      assert.equal(events.includes('ready'), !reject)
      assert.ok(events.includes('disposed'))
      assert.equal(events.includes('force-requested'), false)
      assert.ok(events.includes('exit'))
      assert.ok(events.includes('close'))
      assert.ok(events.indexOf('exit') < events.indexOf('close'))
      assert.equal(guard.status().sensitive, false)
      assert.equal(guard.status().overflow, false)
    } finally {
      await host?.stop()
      t.diagnostic(JSON.stringify(timeline))
      if (!host || host.snapshot().canStart) fs.rmSync(home, { recursive: true, force: true })
    }
  })
}


test('real shared Profile discovers user presets and preserves explicit preset configuration', { timeout: 60_000 }, async () => {
  const node = process.env.DSH_WORK_NODE
  assert.ok(node)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-shared-presets-'))
  let host: RuntimeHost | null = null
  try {
    const sourceHome = path.join(root, 'source')
    const sourceProfile = path.join(sourceHome, 'profiles/web')
    fs.mkdirSync(sourceProfile, { recursive: true })
    fs.writeFileSync(path.join(sourceProfile, 'package.json'), JSON.stringify({
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
    }))
    const preset = path.join(sourceHome, '.agent-presets/workbench-readonly')
    fs.mkdirSync(preset, { recursive: true })
    fs.writeFileSync(path.join(preset, 'preset.yml'), 'name: Workbench read only\n')
    fs.writeFileSync(path.join(preset, 'agent.cordis.yml'), '[]\n')
    const [source] = discoverLocalProfiles({ environment: { DSH_HOME: sourceHome }, userHome: root }).profiles
    assert.ok(source)
    const probe = path.join(root, 'preset-probe.mjs')
    fs.writeFileSync(probe, `
      import fs from 'node:fs'
      export const inject = ['agentPresets']
      export function apply(ctx, config) {
        return ctx.agentPresets.list().then(roster => {
          fs.writeFileSync(config.report, JSON.stringify({ roster, roots: ctx.agentPresets.roots }))
        })
      }
    `)
    for (const mode of ['shared', 'configured', 'isolated']) {
      const home = path.join(root, mode)
      if (mode === 'configured') fs.writeFileSync(path.join(sourceProfile, 'cordis.patch.yml'), JSON.stringify([
        { id: 'agent-presets', config: { default: 'standard', includeUserRoot: false,
          roots: [{ path: path.join(root, 'team-presets'), trust: 'user' }] } },
      ]))
      const prepared = mode === 'isolated' ? (prepareDevelopmentProfile(home), { patches: [] }) : prepareShadowProfile(home, source)
      const report = path.join(home, 'preset-report.json')
      const probePatch = path.join(home, 'preset-probe.patch.json')
      fs.writeFileSync(probePatch, JSON.stringify([{ insert: [{ id: 'preset-probe', name: pathToFileURL(probe).href, config: { report } }] }]))
      const launch = createOfficialLauncher({ node, home, patches: [...prepared.patches, probePatch] })
      host = createRuntimeHost({ launch: () => {
        const child = launch()
        child.stdout.resume()
        child.stderr.resume()
        return child
      } })
      const started = await host.start()
      assert.equal(started.state, 'ready', started.code ?? mode)
      const reportDeadline = Date.now() + 5_000
      while (!fs.existsSync(report) && Date.now() < reportDeadline) {
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      const result = JSON.parse(fs.readFileSync(report, 'utf8'))
      assert.equal(JSON.stringify(result.roster).includes('workbench-readonly'), mode === 'shared')
      if (mode === 'configured') {
        assert.ok(result.roots.some((entry: { path: string }) => entry.path === path.join(root, 'team-presets')))
        assert.equal(result.roots.some((entry: { path: string }) => entry.path.endsWith('.agent-presets')), false)
      }
      if (mode === 'isolated') assert.equal(fs.existsSync(path.join(home, '.agent-presets')), false)
      assert.equal((await host.stop()).state, 'stopped')
      host = null
    }
  } finally {
    await host?.stop()
    if (!host || host.snapshot().canStart) fs.rmSync(root, { recursive: true, force: true })
  }
})
