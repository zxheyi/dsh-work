import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { DesktopSession } from '../apps/desktop/main.ts'
import type { RuntimeSnapshot } from '../packages/runtime-contract/index.ts'

const emittedDesktopEntry: string = '../dist/apps/desktop/main.js'
const { desktop } = await import(emittedDesktopEntry) as {
  desktop: Promise<DesktopSession>
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

const waitForState = async (
  host: DesktopSession['host'],
  state: RuntimeSnapshot['state'],
): Promise<RuntimeSnapshot> => {
  const initial = host.snapshot()
  if (initial.state === state) return initial
  return new Promise<RuntimeSnapshot>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(`${state} status timeout`))
    }, 35_000)
    const unsubscribe = host.subscribe(value => {
      if (value.state !== state) return
      clearTimeout(timer)
      unsubscribe()
      resolve(value)
    })
  })
}

async function run(): Promise<void> {
  let failureStep = 'await-desktop'
  try {
    const { host } = await desktop
    if (!host) throw new Error('desktop host unavailable')
    failureStep = 'observe-automatic-start'
    let generation, terminal
    if (phase === 'after-ready') {
      failureStep = 'await-harness-ready'
      terminal = await waitForState(host, 'ready')
      generation = await waitForActive()
    } else {
      terminal = await waitForState(host, 'starting')
      generation = await waitForActive()
    }
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
