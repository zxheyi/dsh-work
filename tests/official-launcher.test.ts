import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createOfficialLauncher, prepareDevelopmentProfile } from '../packages/runtime-host/official-launcher.ts'
import type { RuntimeChild } from '../packages/runtime-host/index.ts'
import { removeOwnedTestHome } from './support/owned-test-home.ts'

test('launcher uses explicit CLI, loopback, empty control pipe and an environment allowlist', () => {
  const node = process.execPath, home = os.tmpdir()
  const inherited = ['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE', 'DSH_HOME', 'DEEPSEEK_API_KEY']
  const before = Object.fromEntries(inherited.map(key => [key, process.env[key]]))
  for (const key of inherited) process.env[key] = 'forbidden-secret'
  try {
    let calls = 0
    const launch = createOfficialLauncher({ node, home }, {
      probe(executable, args, options) {
        assert.equal(executable, node); assert.deepEqual(args, ['--version'])
        assert.equal(JSON.stringify(options).includes('forbidden-secret'), false)
        return 'v24.11.1\n'
      },
      spawnProcess(executable, args, options) {
        calls++
        assert.equal(executable, node)
        assert.equal(args[0]?.endsWith(path.join('dsh', 'lib', 'bin.js')), true)
        assert.deepEqual(args.slice(1), ['--profile', 'dsh-work', '--no-open', '--host', '127.0.0.1', '--port', '0'])
        assert.equal(options.shell, false)
        assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe', 'ipc'])
        assert.equal(options.env?.DSH_HOME, home)
        assert.equal(options.env?.PATH, path.dirname(node))
        assert.equal(JSON.stringify(options).includes('forbidden-secret'), false)
        return {} as RuntimeChild
      },
    })
    launch(); assert.equal(calls, 1)
    assert.throws(createOfficialLauncher({ node: 'node', home }))
    assert.throws(createOfficialLauncher({ node, home }, { probe: () => 'v22.0.0' }))
  } finally {
    for (const key of inherited) {
      if (before[key] === undefined) delete process.env[key]
      else process.env[key] = before[key]
    }
  }
})

test('Profile preparation refreshes only the managed Profile, preserves generation content and rejects linked parents', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-home-boundary-'))
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-unrelated-profile-'))
  try {
    fs.writeFileSync(path.join(home, 'user-content'), 'preserved')
    prepareDevelopmentProfile(home)
    assert.equal(fs.readFileSync(path.join(home, 'user-content'), 'utf8'), 'preserved')
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'profiles/dsh-work/package.json'), 'utf8')).dsh.profile.patchReload, 'startup')
    const bundle = path.join(home, 'profiles/dsh-work/node_modules/@dsh-work/lifecycle')
    const bundleManifest = JSON.parse(fs.readFileSync(path.join(bundle, 'package.json'), 'utf8'))
    assert.equal(bundleManifest.exports['.'], './index.js')
    assert.equal(fs.existsSync(path.join(bundle, 'index.js')), true)
    assert.equal(fs.existsSync(path.join(bundle, 'index.ts')), false)
    prepareDevelopmentProfile(home)
    assert.equal(fs.readFileSync(path.join(home, 'user-content'), 'utf8'), 'preserved')
    fs.rmSync(path.join(home, 'profiles'), { recursive: true, force: true })
    fs.symlinkSync(outside, path.join(home, 'profiles'), 'junction')
    assert.throws(() => prepareDevelopmentProfile(home), /owned Profile path/)
    assert.deepEqual(fs.readdirSync(outside), [])
    assert.throws(() => prepareDevelopmentProfile('relative-home'))
  } finally {
    removeOwnedTestHome(home)
    fs.rmSync(outside, { recursive: true, force: true })
  }
})
