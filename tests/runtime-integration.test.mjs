import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRuntimeHost } from '../packages/runtime-host/index.mjs'
import { prepareDevelopmentProfile, createOfficialLauncher } from '../packages/runtime-host/official-launcher.mjs'
import { createOutputGuard } from '../prototypes/m0-runtime-upgrade/output-guard.mjs'

test('product Bundle runs through the official CLI for three ready/EOF/restart cycles', { timeout: 90_000 }, async () => {
  assert.ok(process.env.DSH_WORK_NODE, 'explicit standalone Node is required; no global fallback')
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-product-test-'))
  const guard = createOutputGuard(1024 * 1024)
  let host
  try {
    prepareDevelopmentProfile(home)
    const launch = createOfficialLauncher({ node: process.env.DSH_WORK_NODE, home })
    host = createRuntimeHost({ launch: () => {
      const child = launch()
      child.stdout.on('data', bytes => guard.observe(bytes, 'stdout'))
      child.stderr.on('data', bytes => guard.observe(bytes, 'stderr'))
      return child
    } })
    for (let cycle = 0; cycle < 3; cycle++) {
      assert.equal((await host.start()).state, 'ready')
      const stopped = await host.stop()
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
  assert.ok(process.env.DSH_WORK_NODE)
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-rejection-test-'))
  let host
  try {
    prepareDevelopmentProfile(home)
    const patchPath = path.join(home, 'profiles/dsh-work/cordis.patch.yml')
    const original = fs.readFileSync(patchPath)
    const patch = JSON.parse(original)
    patch.push({ insert: [{ id: 'deliberate-invalid-plugin', name: '@dsh-work/not-installed' }] })
    fs.writeFileSync(patchPath, JSON.stringify(patch))
    host = createRuntimeHost({ launch: createOfficialLauncher({ node: process.env.DSH_WORK_NODE, home }) })
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
  assert.ok(process.env.DSH_WORK_NODE)
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-early-stop-test-'))
  let host
  try {
    prepareDevelopmentProfile(home)
    host = createRuntimeHost({ launch: createOfficialLauncher({ node: process.env.DSH_WORK_NODE, home }) })
    const pending = host.start()
    assert.equal((await host.stop()).state, 'stopped')
    assert.equal((await pending).state, 'stopped')
  } finally {
    await host?.stop()
    if (!host || host.snapshot().canStart) fs.rmSync(home, { recursive: true, force: true })
  }
})

for (const reject of [true, false]) {
  test(`slow official CLI startup ${reject ? 'rejection' : 'success'} survives early EOF`, { timeout: 60_000 }, async t => {
    assert.ok(process.env.DSH_WORK_NODE)
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-delayed-startup-'))
    const guard = createOutputGuard(1024 * 1024)
    const timeline = []
    const startedAt = performance.now()
    const note = event => timeline.push({ event, ms: Math.round(performance.now() - startedAt) })
    let host, partial = ''
    try {
      prepareDevelopmentProfile(home)
      const profile = path.join(home, 'profiles/dsh-work')
      fs.cpSync(new URL('./fixtures/delayed-startup/', import.meta.url),
        path.join(profile, 'node_modules/@dsh-work/delayed-startup'), { recursive: true })
      const patchPath = path.join(profile, 'cordis.patch.yml')
      const patch = JSON.parse(fs.readFileSync(patchPath))
      patch.push({ insert: [{ id: 'delayed-startup', name: '@dsh-work/delayed-startup', config: { reject } }] })
      fs.writeFileSync(patchPath, JSON.stringify(patch))
      const launch = createOfficialLauncher({ node: process.env.DSH_WORK_NODE, home })
      host = createRuntimeHost({ launch: () => {
        const child = launch()
        const kill = child.kill.bind(child)
        child.kill = signal => { note('force-requested'); return kill(signal) }
        child.on('message', message => {
          if (message?.protocol === 'dsh-work.lifecycle.v1' && ['ready', 'disposed'].includes(message.event)) note(message.event)
        })
        child.on('exit', () => note('exit'))
        child.on('close', () => note('close'))
        child.stderr.on('data', chunk => guard.observe(chunk, 'stderr'))
        child.stdout.on('data', chunk => {
          guard.observe(chunk, 'stdout')
          if (guard.status().overflow) { partial = ''; return }
          partial += chunk.toString('utf8')
          const lines = partial.split('\n')
          partial = lines.pop()
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
