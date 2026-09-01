import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { desktop } from '../apps/desktop/main.mjs'

const productRoot = process.env.DSH_WORK_HOST_DEATH_ROOT
const reportPath = process.env.DSH_WORK_HOST_DEATH_REPORT
const phase = process.env.DSH_WORK_HOST_DEATH_PHASE
if (!path.isAbsolute(productRoot || '') || !path.isAbsolute(reportPath || '') ||
    !['before-ready', 'after-ready'].includes(phase)) process.exit(2)

app.setPath('userData', productRoot)
app.commandLine.appendSwitch('disable-background-networking')
const write = (status, extra = {}) => fs.writeFileSync(reportPath, JSON.stringify({
  status,
  phase,
  runId: process.env.DSH_WORK_E2E_RUN_ID,
  platform: process.platform,
  arch: process.arch,
  electron: process.versions.electron,
  ...extra,
}, null, 2))

const waitForActive = async () => {
  const active = path.join(productRoot, 'runtime/active.json')
  const deadline = Date.now() + 35_000
  while (Date.now() < deadline) {
    if (fs.existsSync(active)) return JSON.parse(fs.readFileSync(active, 'utf8')).generation
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error('guardian did not claim a generation')
}

async function run() {
  try {
    const { host } = await desktop
    if (!host) throw new Error('desktop host unavailable')
    const starting = host.start()
    const generation = await waitForActive()
    if (phase === 'after-ready') {
      const ready = await starting
      if (ready.state !== 'ready') throw new Error('Harness did not become Ready')
    } else if (host.snapshot().state !== 'starting') {
      throw new Error('Harness escaped the pre-Ready fault window')
    }
    write('armed', { generation, terminal: host.snapshot() })
    // The parent test kills this exact Electron main process. Keep the event loop
    // alive without adding another shutdown authority.
    setInterval(() => {}, 60_000)
  } catch {
    write('fail')
    app.exit(1)
  }
}

// Electron emits ready only after this ESM entry returns.
void run()
