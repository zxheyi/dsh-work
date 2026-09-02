// Explicit Electron entry point for one phase of the two-launch persistence acceptance.
import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import type { DesktopSession } from '../apps/desktop/main.ts'

const userData = process.env.DSH_WORK_E2E_USER_DATA
const phase = process.env.DSH_WORK_E2E_PHASE
assert.ok(userData)
assert.ok(phase === 'create' || phase === 'restore')
app.setPath('userData', userData)
app.commandLine.appendSwitch('disable-background-networking')
app.commandLine.appendSwitch('force-device-scale-factor', '1')

const workTitle = '桌面重启恢复验收'
const output = path.resolve('artifacts/desktop/work-persistence')
fs.mkdirSync(output, { recursive: true })
const reportPath = path.join(output, `${phase}-result.json`)
let step = 'boot'
const write = (status: 'pass' | 'fail', extra: Record<string, unknown> = {}): void => {
  fs.writeFileSync(reportPath, JSON.stringify({
    status,
    phase,
    step,
    runId: process.env.DSH_WORK_E2E_RUN_ID,
    ...extra,
  }, null, 2))
}
write('fail')

const emittedDesktopEntry: string = '../dist/apps/desktop/main.js'
const { desktop } = await import(emittedDesktopEntry) as { desktop: Promise<DesktopSession> }

async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean, message: string): Promise<T> {
  const deadline = Date.now() + 35_000
  while (Date.now() < deadline) {
    try {
      const value = await read()
      if (accept(value)) return value
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(message)
}

async function run(): Promise<void> {
  let active: DesktopSession | null = null
  try {
    step = 'open-home'; write('fail')
    active = await desktop
    const js = <T = unknown>(source: string): Promise<T> =>
      active!.window.webContents.executeJavaScript(source) as Promise<T>
    const expectedComposerTitle = phase === 'create'
      ? '你想完成什么？'
      : '接下来想推进什么？'
    await waitFor(
      () => js<{ ready: boolean; text: string }>(`({
        ready: Boolean(document.querySelector('.dsh-work-home')),
        text: document.body.innerText,
      })`),
      value => value.ready
        && value.text.includes(expectedComposerTitle)
        && (phase === 'create' || value.text.includes(workTitle)),
      'Work home did not become ready',
    )
    if (phase === 'create') {
      step = 'create-work'; write('fail')
      await js(`(() => {
        const input = document.querySelector('[data-work-goal]')
        if (!(input instanceof HTMLTextAreaElement)) return false
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        setter?.call(input, ${JSON.stringify(workTitle)})
        input.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      })()`)
      await waitFor(
        () => js<boolean>("!document.querySelector('.dsh-work-primary')?.disabled"),
        value => value,
        'Work create action did not become available',
      )
      await js("document.querySelector('.dsh-work-primary')?.click()")
      await waitFor(
        () => js<{ row: boolean; text: string }>(`({
          row: Boolean(document.querySelector('.dsh-work-row')),
          text: document.body.innerText,
        })`),
        value => value.row && value.text.includes(workTitle),
        'Created Work did not appear in the recent list',
      )
    } else {
      step = 'restore-work'; write('fail')
      await waitFor(
        () => js<{ row: boolean; text: string }>(`({
          row: Boolean(document.querySelector('.dsh-work-row')),
          text: document.body.innerText,
        })`),
        value => value.row && value.text.includes(workTitle),
        'Previous Work was not restored after desktop restart',
      )
    }
    const text = await js<string>('document.body.innerText')
    assert.doesNotMatch(text, /DSH Web|Workspace|Session|Profile|模型|插件/u)
    fs.writeFileSync(path.join(output, `${phase}.png`), (await active.window.webContents.capturePage()).toPNG())
    step = 'close-cleanly'; write('fail')
    app.once('will-quit', () => {
      const terminal = active!.host.snapshot()
      const passed = terminal.state === 'stopped' && terminal.code === null && terminal.canStart
      step = 'complete'
      write(passed ? 'pass' : 'fail', { terminal, workTitle, screenshots: [`${phase}.png`] })
      if (!passed) process.exitCode = 1
    })
    active.window.close()
  } catch (error) {
    if (active && !active.window.isDestroyed()) {
      try {
        fs.writeFileSync(path.join(output, `${phase}-failure.png`),
          (await active.window.webContents.capturePage()).toPNG())
      } catch {}
    }
    write('fail', { detail: error instanceof Error ? error.message : 'unknown failure' })
    await active?.host.stop().catch(() => {})
    await active?.host.dispose().catch(() => {})
    app.exit(1)
  }
}

void run()
