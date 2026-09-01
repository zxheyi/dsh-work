import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createGuardianClient } from '../packages/runtime-guardian/client.mjs'
import { createGenerationStore } from '../packages/runtime-guardian/generation-store.mjs'
import { removeOwnedTestHome } from './support/owned-test-home.mjs'

const activeGeneration = productRoot => JSON.parse(
  fs.readFileSync(path.join(productRoot, 'runtime/active.json'), 'utf8'),
).generation

const waitFor = async (condition, message, timeout = 35_000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (condition()) return
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(message)
}

async function startClient(productRoot) {
  assert.ok(process.env.DSH_WORK_NODE, 'explicit standalone Node is required; no global fallback')
  return createGuardianClient({ node: process.env.DSH_WORK_NODE, productRoot })
}

test('official Harness clean stop reuses one persistent generation across guardian processes', { timeout: 90_000 }, async () => {
  const productRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-guardian-clean-'))
  let first, second
  try {
    first = await startClient(productRoot)
    assert.equal((await first.start()).state, 'ready')
    const generation = activeGeneration(productRoot)
    assert.equal((await first.stop()).state, 'stopped')
    assert.equal(await first.dispose(), true)
    first = null

    second = await startClient(productRoot)
    assert.equal((await second.start()).state, 'ready')
    assert.equal(activeGeneration(productRoot), generation)
    assert.equal((await second.stop()).state, 'stopped')
    assert.equal(await second.dispose(), true)
    second = null
  } finally {
    await first?.stop().catch(() => {})
    await first?.dispose().catch(() => {})
    await second?.stop().catch(() => {})
    await second?.dispose().catch(() => {})
    removeOwnedTestHome(productRoot)
  }
})

test('guardian owns cleanup after its Electron client disappears after Harness Ready', { timeout: 90_000 }, async () => {
  const productRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-guardian-ready-death-'))
  let first, second
  try {
    first = await startClient(productRoot)
    assert.equal((await first.start()).state, 'ready')
    const generation = activeGeneration(productRoot)
    assert.equal(await first.dispose(), true)
    first = null

    second = await startClient(productRoot)
    assert.equal((await second.start()).state, 'ready')
    assert.equal(activeGeneration(productRoot), generation)
    assert.equal((await second.stop()).state, 'stopped')
    assert.equal(await second.dispose(), true)
    second = null
  } finally {
    await first?.stop().catch(() => {})
    await first?.dispose().catch(() => {})
    await second?.stop().catch(() => {})
    await second?.dispose().catch(() => {})
    removeOwnedTestHome(productRoot)
  }
})

test('guardian owns cleanup after its Electron client disappears before Harness Ready', { timeout: 90_000 }, async t => {
  const productRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-guardian-start-death-'))
  let first, second
  try {
    first = await startClient(productRoot)
    const starting = assert.rejects(first.start(), /guardian unavailable/)
    await waitFor(() => fs.existsSync(path.join(productRoot, 'runtime/active.json')),
      'guardian did not claim a generation')
    const generation = activeGeneration(productRoot)
    assert.equal(await first.dispose(), true)
    await starting
    first = null

    second = await startClient(productRoot)
    assert.equal((await second.start()).state, 'ready')
    assert.equal(activeGeneration(productRoot), generation)
    assert.equal((await second.stop()).state, 'stopped')
    assert.equal(await second.dispose(), true)
    second = null
  } finally {
    await first?.stop().catch(() => {})
    await first?.dispose().catch(() => {})
    await second?.stop().catch(() => {})
    await second?.dispose().catch(() => {})
    try { removeOwnedTestHome(productRoot) } catch (error) {
      if (process.platform !== 'win32' || error?.code !== 'EPERM') throw error
      t.diagnostic('Windows retained the test Profile tree after confirmed direct-child cleanup')
    }
  }
})

test('explicit isolated recovery preserves uncertain bytes and never touches an unrelated process', { timeout: 90_000 }, async () => {
  assert.ok(process.env.DSH_WORK_NODE, 'explicit standalone Node is required; no global fallback')
  const productRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-guardian-isolation-'))
  const staleStore = createGenerationStore(productRoot, { id: () => 'uncertain-generation' })
  const stale = staleStore.claim()
  fs.writeFileSync(path.join(stale.home, 'preserved.txt'), 'uncertain-bytes')
  const sentinel = spawn(process.env.DSH_WORK_NODE, ['-e',
    'process.stdin.resume(); process.stdin.on("end", () => process.exit(0)); setTimeout(() => process.exit(0), 60000)'],
  { shell: false, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] })
  sentinel.stdin.on('error', () => {})
  const sentinelClosed = once(sentinel, 'close')
  let client
  try {
    await once(sentinel, 'spawn')
    client = await startClient(productRoot)
    const blocked = await client.start()
    assert.equal(blocked.code, 'recovery-required')
    assert.equal(blocked.canRecover, true)
    assert.equal(sentinel.exitCode, null)
    assert.equal(sentinel.signalCode, null)

    assert.equal((await client.recover()).state, 'ready')
    assert.notEqual(activeGeneration(productRoot), stale.generation)
    assert.equal(fs.readFileSync(path.join(stale.home, 'preserved.txt'), 'utf8'), 'uncertain-bytes')
    assert.equal(sentinel.exitCode, null)
    assert.equal(sentinel.signalCode, null)
    assert.equal((await client.stop()).state, 'stopped')
    assert.equal(await client.dispose(), true)
    client = null
  } finally {
    sentinel.stdin.end()
    await sentinelClosed
    await client?.stop().catch(() => {})
    await client?.dispose().catch(() => {})
    removeOwnedTestHome(productRoot)
  }
})
