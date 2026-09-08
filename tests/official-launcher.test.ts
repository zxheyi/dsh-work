import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { createOfficialLauncher, prepareDevelopmentProfile } from '../packages/runtime-host/official-launcher.ts'
import { runtimeSearchPath } from '../packages/runtime-host/environment.ts'
import type { RuntimeChild } from '../packages/runtime-host/index.ts'
import { removeOwnedTestHome } from './support/owned-test-home.ts'

test('launcher uses explicit CLI, loopback, empty control pipe and an environment allowlist', () => {
  const node = process.execPath, home = os.tmpdir()
  const inherited = ['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE', 'DSH_HOME', 'DEEPSEEK_API_KEY', 'PATH']
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
        assert.equal(options.env?.PATH, runtimeSearchPath(node, process.platform, process.env))
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
    const profileManifest = JSON.parse(fs.readFileSync(path.join(home, 'profiles/dsh-work/package.json'), 'utf8'))
    assert.equal(profileManifest.dsh.profile.patchReload, 'startup')
    assert.deepEqual(profileManifest.dsh.profile.bundles, [
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      '@dsh-work/work',
      '@dsh-work/lifecycle',
    ])
    const bundle = path.join(home, 'profiles/dsh-work/node_modules/@dsh-work/lifecycle')
    const bundleManifest = JSON.parse(fs.readFileSync(path.join(bundle, 'package.json'), 'utf8'))
    assert.equal(bundleManifest.exports['.'], './index.js')
    assert.equal(fs.existsSync(path.join(bundle, 'index.js')), true)
    assert.equal(fs.existsSync(path.join(bundle, 'index.ts')), false)
    const workBundle = path.join(home, 'profiles/dsh-work/node_modules/@dsh-work/work')
    assert.equal(fs.existsSync(path.join(workBundle, 'index.js')), true)
    assert.equal(fs.existsSync(path.join(workBundle, 'cordis.patch.yml')), true)
    assert.equal(fs.existsSync(path.join(home, 'profiles/dsh-work/node_modules/@dsh-work/work-domain/index.js')), true)
    assert.equal(fs.existsSync(path.join(home, 'profiles/dsh-work/node_modules/@dsh-work/work-api/index.js')), true)
    assert.equal(fs.realpathSync(path.join(home, 'profiles/dsh-work/node_modules/@deepseek-ai/cordis')).length > 0, true)
    assert.equal(fs.realpathSync(path.join(home, 'profiles/dsh-work/node_modules/@deepseek-ai/dsh-storage-domain')).length > 0, true)
    assert.equal(fs.realpathSync(path.join(home, 'profiles/dsh-work/node_modules/@deepseek-ai/dsh-typert-protocol')).length > 0, true)
    assert.equal(fs.realpathSync(path.join(home, 'profiles/dsh-work/node_modules/zod')).length > 0, true)
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

test('launcher accepts only an explicit safe Profile and absolute final overlays', () => {
  const patch = path.join(os.tmpdir(), 'dsh-work-overlay.json')
  let argv: readonly string[] = []
  createOfficialLauncher({ node: process.execPath, home: os.tmpdir(), profile: 'dsh-work', patches: [patch] }, {
    probe: () => 'v24.11.1\n',
    spawnProcess(_executable, args) {
      argv = args
      return {} as RuntimeChild
    },
  })()
  assert.deepEqual(argv.slice(1), [
    '--profile', 'dsh-work', '--patch', patch,
    '--no-open', '--host', '127.0.0.1', '--port', '0',
  ])
  assert.throws(() => createOfficialLauncher({
    node: process.execPath, home: os.tmpdir(), profile: '../web',
  }, { probe: () => 'v24.11.1\n' })())
  assert.throws(() => createOfficialLauncher({
    node: process.execPath, home: os.tmpdir(), patches: ['relative.patch.json'],
  }, { probe: () => 'v24.11.1\n' })())
})

// Exercise macOS command lookup without opening a graphical picker in unit tests.
test('macOS launcher environment can execute the native picker interpreter', {
  skip: process.platform !== 'darwin',
}, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-picker-env-'))
  try {
    createOfficialLauncher({ node: process.execPath, home }, {
      probe: () => 'v24.11.1\n',
      spawnProcess(_executable, _args, options) {
        const output = execFileSync('osascript', ['-e', 'return "dsh-picker-ready"'], {
          cwd: options.cwd,
          env: options.env,
          encoding: 'utf8',
          timeout: 5_000,
        })
        assert.equal(output.trim(), 'dsh-picker-ready')
        return {} as RuntimeChild
      },
    })()
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

// The default upstream foreground shell starts `bash` by name, then commands
// such as ls/sh inherit the same runtime PATH (no login-shell startup files).
test('macOS runtime can start Bash and its basic system commands', {
  skip: process.platform !== 'darwin',
}, () => {
  createOfficialLauncher({ node: process.execPath, home: os.tmpdir() }, {
    probe: () => 'v24.11.1\n',
    spawnProcess(_executable, _args, options) {
      assert.equal(execFileSync('bash', ['-c', 'ls -d . && sh -c "printf shell-ready"'], {
        env: options.env, cwd: options.cwd, encoding: 'utf8', timeout: 5_000,
      }), '.\nshell-ready')
      return {} as RuntimeChild
    },
  })()
})

// Upstream process-tree cancellation invokes taskkill by name on Windows.
// Help exercises native command resolution without terminating any process.
test('Windows runtime can resolve its process-tree helper', {
  skip: process.platform !== 'win32',
}, () => {
  createOfficialLauncher({ node: process.execPath, home: os.tmpdir() }, {
    probe: () => 'v24.11.1\n',
    spawnProcess(_executable, _args, options) {
      execFileSync('taskkill', ['/?'], {
        env: options.env, cwd: options.cwd, stdio: 'pipe', timeout: 5_000,
      })
      return {} as RuntimeChild
    },
  })()
})


test('runtime command lookup admits only fixed platform helpers after bundled Node', () => {
  assert.equal(runtimeSearchPath('/app with spaces/node', 'darwin', { PATH: '/untrusted:.' }),
    '/app with spaces:/usr/bin:/bin')
  assert.equal(runtimeSearchPath('/app/node', 'linux', { PATH: '/untrusted:.' }), '/app')
  for (const key of ['SystemRoot', 'SYSTEMROOT', 'systemroot', 'WINDIR']) {
    assert.equal(runtimeSearchPath('D:\\DSH Work\\node.exe', 'win32', {
      [key]: 'E:\\Windows', PATH: 'C:\\untrusted;.',
    }), 'D:\\DSH Work;E:\\Windows\\System32')
  }
  for (const root of [undefined, '', 'relative-windows', '\\Windows', 'C:\\Windows;C:\\untrusted', 'C:\\Windows\0']) {
    assert.equal(runtimeSearchPath('D:\\DSH Work\\node.exe', 'win32', {
      SystemRoot: root, PATH: 'C:\\untrusted;.',
    }), 'D:\\DSH Work')
  }
  assert.equal(runtimeSearchPath('D:\\DSH Work\\node.exe', 'win32', {
    SystemRoot: 'E:\\Windows', WINDIR: 'F:\\other',
  }), 'D:\\DSH Work;E:\\Windows\\System32')
})
