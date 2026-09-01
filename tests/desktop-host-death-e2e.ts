import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import type { RuntimeSnapshot } from '../packages/runtime-contract/index.ts'
import type { GuardianClient } from '../packages/runtime-guardian/client.ts'

const emittedDesktopEntry: string = '../dist/apps/desktop/main.js'
const { desktop } = await import(emittedDesktopEntry) as {
  desktop: Promise<{ host: GuardianClient; window: BrowserWindow }>
}

const configuredProductRoot = process.env.DSH_WORK_HOST_DEATH_ROOT
const configuredReportPath = process.env.DSH_WORK_HOST_DEATH_REPORT
const configuredPhase = process.env.DSH_WORK_HOST_DEATH_PHASE
if (!configuredProductRoot || !configuredReportPath ||
    !path.isAbsolute(configuredProductRoot) || !path.isAbsolute(configuredReportPath) ||
    (configuredPhase !== 'before-ready' && configuredPhase !== 'after-ready')) {
  throw new Error('invalid host-death fixture')
}
const productRoot: string = configuredProductRoot
const reportPath: string = configuredReportPath
const phase: 'before-ready' | 'after-ready' = configuredPhase

app.setPath('userData', productRoot)
app.commandLine.appendSwitch('disable-background-networking')
const write = (status: 'armed' | 'fail', extra: Record<string, unknown> = {}): void => fs.writeFileSync(reportPath, JSON.stringify({
  status,
  phase,
  runId: process.env.DSH_WORK_E2E_RUN_ID,
  platform: process.platform,
  arch: process.arch,
  electron: process.versions.electron,
  ...extra,
}, null, 2))

const waitForActive = async (): Promise<string> => {
  const active = path.join(productRoot, 'runtime/active.json')
  const deadline = Date.now() + 35_000
  while (Date.now() < deadline) {
    if (fs.existsSync(active)) return JSON.parse(fs.readFileSync(active, 'utf8')).generation
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error('guardian did not claim a generation')
}

async function run(): Promise<void> {
  let failureStep = 'await-desktop'
  try {
    const { host } = await desktop
    if (!host) throw new Error('desktop host unavailable')
    failureStep = 'start-guardian'
    let startingTimer: NodeJS.Timeout
    const resolver: { current: ((value: RuntimeSnapshot) => void) | null } = { current: null }
    const observedStarting = new Promise<RuntimeSnapshot>((resolve, reject) => {
      resolver.current = value => { clearTimeout(startingTimer); resolve(value) }
      startingTimer = setTimeout(() => reject(new Error('starting status timeout')), 35_000)
    })
    const unsubscribe = host.subscribe(value => {
      if (value.state === 'starting') resolver.current?.(value)
    })
    const starting = host.start()
    let generation, terminal
    if (phase === 'after-ready') {
      failureStep = 'await-harness-ready'
      terminal = await starting
      if (terminal.state !== 'ready') throw new Error('Harness did not become Ready')
      generation = await waitForActive()
    } else {
      terminal = await observedStarting
      generation = await waitForActive()
    }
    unsubscribe()
    failureStep = 'armed'
    write('armed', { generation, terminal })
    // The parent test kills this exact Electron main process. Keep the event loop
    // alive without adding another shutdown authority.
    setInterval(() => {}, 60_000)
  } catch {
    write('fail', { failureStep })
    app.exit(1)
  }
}

// Electron emits ready only after this ESM entry returns.
void run()
