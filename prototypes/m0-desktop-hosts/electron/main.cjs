const { app, BrowserWindow } = require('electron')
const { spawn } = require('node:child_process')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { dirname, join } = require('node:path')

const nodeExecutable = process.env.DSH_WORK_NODE
if (!nodeExecutable) {
  throw new Error('DSH_WORK_NODE must name the standalone Node executable used for Harness')
}

const dshPackage = require.resolve('@deepseek-ai/dsh/package.json')
const dshBin = join(dirname(dshPackage), 'lib', 'bin.js')
const harnessHome = mkdtempSync(join(tmpdir(), 'dsh-work-electron-harness-'))
const events = []
let child
let ready = false
let stopRequested = false

function safeReadinessLine(url) {
  const parsed = new URL(url)
  return `dsh web: ${parsed.origin}`
}

function finish(code, detail) {
  console.log(JSON.stringify({
    prototype: 'electron-separate-process',
    platform: process.platform,
    electron: process.versions.electron,
    electronNode: process.versions.node,
    harnessNode: nodeExecutable,
    harness: '@deepseek-ai/dsh@0.1.1-rc.2',
    stopClassification: process.platform === 'win32' ? 'forced-no-public-carrier' : 'graceful-posix-sigterm',
    code,
    detail,
    events,
  }, null, 2))
  app.exit(code)
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  await window.loadURL('data:text/html,<meta charset="utf-8"><title>DSH Work prototype</title>')
  events.push({ phase: 'desktop-ready', hiddenWindow: true })

  child = spawn(nodeExecutable, [dshBin, 'web', '--no-open', '--port', '0'], {
    cwd: process.cwd(),
    env: { ...process.env, DSH_HOME: harnessHome, DSH_TELEMETRY_MODE: 'DISABLED' },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  events.push({ phase: 'starting', pid: child.pid })

  const timeout = setTimeout(() => {
    stopRequested = true
    events.push({ phase: 'failed', reason: 'startup-timeout' })
    child.kill('SIGKILL')
  }, 30_000)

  let stdout = ''
  child.stdout.on('data', async bytes => {
    stdout += bytes.toString('utf8')
    while (stdout.includes('\n')) {
      const newline = stdout.indexOf('\n')
      const line = stdout.slice(0, newline).trimEnd()
      stdout = stdout.slice(newline + 1)
      const match = /^dsh web: (http:\/\/127\.0\.0\.1:\d+(?:\/\S*)?)$/.exec(line)
      events.push({ stream: 'stdout', line: match ? safeReadinessLine(match[1]) : line })
      if (!match || ready) continue

      const response = await fetch(match[1])
      ready = response.status === 200
      events.push({ phase: 'ready', httpStatus: response.status })
      stopRequested = true
      if (process.platform === 'win32') {
        events.push({ phase: 'stopping', mode: 'forced-no-public-carrier' })
        child.kill()
      } else {
        events.push({ phase: 'stopping', signal: 'SIGTERM' })
        child.kill('SIGTERM')
      }
    }
  })

  child.stderr.on('data', bytes => {
    events.push({ stream: 'stderr', line: bytes.toString('utf8').trimEnd() })
  })

  child.on('error', error => finish(1, { reason: 'spawn-error', message: error.message }))
  child.on('exit', (childCode, signal) => {
    clearTimeout(timeout)
    const expectedWindowsForcedExit = process.platform === 'win32' && ready && stopRequested
    const success = expectedWindowsForcedExit || (ready && childCode === 0)
    events.push({ phase: success ? 'stopped' : 'failed', code: childCode, signal })
    finish(success ? 0 : 1, { childCode, childSignal: signal })
  })
}).catch(error => finish(1, { reason: 'desktop-start-error', message: error.message }))
