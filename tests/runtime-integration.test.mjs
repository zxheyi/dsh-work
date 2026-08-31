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
