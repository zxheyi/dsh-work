import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createOutputGuard } from './output-guard.mjs'

const require = createRequire(import.meta.url)
const root = path.dirname(fileURLToPath(import.meta.url))
const node = process.env.DSH_WORK_NODE || process.execPath
const bin = path.join(path.dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'lib/bin.js')
const cmdline = path.dirname(require.resolve('@deepseek-ai/dsh-cmdline/package.json'))
const prefix = 'dsh-work-probe:'

// Only process/CLI and public plugin lifecycle boundaries are observed.
async function runProfile({ earlyEOF = false, invalid = false, web = false, leakURL = false, home } = {}) {
  const ownedHome = home || fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-alpha2-test-'))
  const profile = path.join(ownedHome, 'profiles/dsh-work-probe')
  const bundle = path.join(profile, 'node_modules/@dsh-work/lifecycle-probe')
  try {
    fs.mkdirSync(bundle, { recursive: true })
    fs.cpSync(path.join(root, 'fixture'), bundle, { recursive: true })
    const cmdlineLink = path.join(profile, 'node_modules/@deepseek-ai/dsh-cmdline')
    fs.mkdirSync(path.dirname(cmdlineLink), { recursive: true })
    if (!fs.existsSync(cmdlineLink)) fs.symlinkSync(cmdline, cmdlineLink, 'junction')
    fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({
      private: true, type: 'module',
      dsh: { profile: { bundles: [
        ...(web ? ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] : []),
        '@dsh-work/lifecycle-probe',
      ], patchReload: 'startup' } },
    }))
    const patch = [{ id: 'dsh-work-lifecycle-probe',
      ...(web ? { inject: ['connection', 'webServer'] } : {}),
      config: { rejectStartup: invalid, web },
    }]
    if (web) patch.push({ id: 'web-runtime', config: {
      openBrowser: false, printUrl: leakURL, surfaceContext: true, trustedHosts: [],
    } })
    // JSON is YAML-compatible and avoids interpolating arbitrary path strings.
    fs.writeFileSync(path.join(profile, 'cordis.patch.yml'), JSON.stringify(patch))
    const env = { HOME: ownedHome, USERPROFILE: ownedHome,
      APPDATA: ownedHome, LOCALAPPDATA: ownedHome, DSH_HOME: ownedHome,
      DSH_TELEMETRY_DISABLED: '1', NO_COLOR: '1', PATH: path.dirname(node) }
    for (const key of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']) {
      if (process.env[key]) env[key] = process.env[key]
    }
    const child = spawn(node, [bin, '--profile', 'dsh-work-probe',
      ...(web ? ['--no-open', '--host', '127.0.0.1', '--port', '0'] : []),
    ], {
      cwd: ownedHome, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    })
    const events = []
    let partial = '', forced = false, spawnError = false
    const outputGuard = createOutputGuard()
    // Never forward arbitrary Harness output (which may contain auth links).
    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => { forced = true; child.kill('SIGKILL') }, 15_000)
      child.on('error', () => { spawnError = true })
      child.stdin.on('error', () => {})
      child.stdout.on('data', chunk => {
        outputGuard.observe(chunk)
        if (outputGuard.status().overflow) { forced = true; child.kill('SIGKILL'); return }
        partial += chunk.toString('utf8')
        const lines = partial.split('\n')
        partial = lines.pop()
        for (const line of lines) {
          if (!line.startsWith(prefix)) continue
          const event = line.slice(prefix.length)
          if (!['loaded', 'ready', 'disposed', 'authenticated', 'rejected'].includes(event)) continue
          events.push(event)
          if (event === 'ready' && !earlyEOF) child.stdin.end()
        }
      })
      child.stderr.on('data', chunk => {
        outputGuard.observe(chunk, 'stderr')
        if (outputGuard.status().overflow) { forced = true; child.kill('SIGKILL') }
      })
      child.on('close', (code, signal) => {
        clearTimeout(timer)
        resolve({ code, signal, events, forced, spawnError })
      })
      if (earlyEOF) child.stdin.end()
    })
    assert.equal(outputGuard.status().sensitive, false, 'Harness output contains a forbidden auth-token/cookie pattern')
    return result
  } finally {
    // This is only a test-owned mkdtemp; never remove a user's Harness home.
    if (!home) fs.rmSync(ownedHome, { recursive: true, force: true })
  }
}

test('official CLI loads the external Bundle once and disposes it on stdin EOF', async () => {
  assert.equal(spawnSync(node, ['--version'], { encoding: 'utf8' }).stdout.trim(), 'v24.11.1')
  assert.deepEqual(await runProfile(), {
    code: 0, signal: null, events: ['loaded', 'ready', 'disposed'], forced: false, spawnError: false,
  })
})

test('startup rejection wins over an early EOF and never announces ready', async () => {
  const result = await runProfile({ invalid: true, earlyEOF: true })
  assert.equal(result.forced, false)
  assert.equal(result.spawnError, false)
  assert.equal(result.code, 1)
  assert.deepEqual(result.events, ['loaded', 'rejected', 'disposed'])
})

test('web Profile authenticates over loopback without logging the token, then disposes', async () => {
  assert.deepEqual(await runProfile({ web: true }), {
    code: 0, signal: null, events: ['loaded', 'authenticated', 'ready', 'disposed'],
    forced: false, spawnError: false,
  })
})

test('the smoke rejects a real launch-token log even when authentication and exit succeed', async () => {
  await assert.rejects(runProfile({ web: true, leakURL: true }), /forbidden auth-token\/cookie pattern/)
})

test('early EOF on a successful startup still disposes the Bundle', async () => {
  assert.deepEqual(await runProfile({ earlyEOF: true }), {
    code: 0, signal: null, events: ['loaded', 'ready', 'disposed'], forced: false, spawnError: false,
  })
})

test('the isolated Profile restarts after rejection and across three normal cycles', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-alpha2-restart-'))
  try {
    const failed = await runProfile({ home, invalid: true, earlyEOF: true })
    assert.equal(failed.code, 1)
    assert.deepEqual(failed.events, ['loaded', 'rejected', 'disposed'])
    for (let cycle = 0; cycle < 3; cycle++) {
      assert.deepEqual(await runProfile({ home }), {
        code: 0, signal: null, events: ['loaded', 'ready', 'disposed'], forced: false, spawnError: false,
      })
    }
  } finally { fs.rmSync(home, { recursive: true, force: true }) }
})
