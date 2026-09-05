import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { createOfficialLauncher, prepareDevelopmentProfile } from '../packages/runtime-host/official-launcher.ts'
import { createGenerationStore } from '../packages/runtime-guardian/generation-store.ts'
import { createGuardianService } from '../packages/runtime-guardian/service.ts'
import { installOutputTestProfile, OUTPUT_TEST_BASELINE_FILE } from './support/output-test-profile.ts'

const configuredProductRoot = process.env.DSH_WORK_E2E_USER_DATA
assert.ok(configuredProductRoot)
const productRoot: string = configuredProductRoot
app.setPath('userData', productRoot)
app.commandLine.appendSwitch('disable-background-networking')
app.commandLine.appendSwitch('force-device-scale-factor', '1')

const emittedWindowEntry: string = '../dist/apps/desktop/window.js'
const { createDesktopWindow, registerDesktopScheme } = await import(emittedWindowEntry) as typeof import('../apps/desktop/window.ts')
registerDesktopScheme()

const output = path.resolve('artifacts/desktop/runtime-context')
const reportPath = path.join(output, 'result.json')
fs.mkdirSync(output, { recursive: true })
let step = 'boot'
const screenshots: string[] = []
const write = (status: 'pass' | 'fail', extra: Record<string, unknown> = {}): void => {
  fs.writeFileSync(reportPath, JSON.stringify({
    status, step, runId: process.env.DSH_WORK_E2E_RUN_ID, screenshots, ...extra,
  }, null, 2))
}
write('fail')

async function run(): Promise<void> {
  let host: ReturnType<typeof createGuardianService> | null = null
  let window: Awaited<ReturnType<typeof createDesktopWindow>> | null = null
  try {
    await app.whenReady()
    const configuredNode = process.env.DSH_WORK_NODE
    assert.ok(configuredNode)
    const node: string = configuredNode
    let launches = 0
    host = createGuardianService({
      store: createGenerationStore(productRoot),
      prepare: home => {
        prepareDevelopmentProfile(home)
        installOutputTestProfile(home)
      },
      launcher: home => {
        const launch = createOfficialLauncher({ node, home })
        return () => {
          launches++
          if (launches === 2) throw new Error('injected runtime launch failure')
          return launch()
        }
      },
    })
    window = await createDesktopWindow(host)
    const current = { host, window }
    assert.equal((await host.start()).state, 'ready')
    const js = <T = unknown>(source: string): Promise<T> =>
      current.window.webContents.executeJavaScript(source) as Promise<T>
    const waitFor = async <T>(
      read: () => Promise<T>,
      accept: (value: T) => boolean,
      message: string,
    ): Promise<T> => {
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
    const nativeState = (): Promise<{
      readonly ready: boolean
      readonly sessionId: string
      readonly draft: string
      readonly turns: number
      readonly conversations: number
    }> => js(`(() => {
      for (const label of ['继续', '稍后配置']) {
        const button = Array.from(document.querySelectorAll('button'))
          .find(item => item.textContent?.trim() === label)
        if (button instanceof HTMLButtonElement) button.click()
      }
      return {
        ready: Boolean(document.querySelector('[data-composer-input]')
          && document.querySelector('[data-work-session-resource]')),
        sessionId: document.querySelector('[data-work-session-resource]')?.getAttribute('data-work-session-resource') ?? '',
        draft: document.querySelector('[data-composer-input]')?.textContent ?? '',
        turns: document.querySelectorAll('[data-chat-turn]').length,
        conversations: document.querySelectorAll('[role=treeitem]').length,
      }
    })()`)
    step = 'open-session'; write('fail')
    await waitFor(nativeState, value => value.ready && value.sessionId.length > 0,
      'Native Session did not become ready')
    assert.equal(await js<string>('typeof window.dshWork'), 'undefined')
    assert.equal(await js<string>('JSON.stringify(Object.keys(window.dshWorkRecovery).sort())'),
      JSON.stringify(['read', 'update']))
    const clickSession = async (title: string): Promise<void> => {
      const clicked = await js<boolean>(`(() => {
        const row = Array.from(document.querySelectorAll('[role=treeitem]'))
          .find(item => item.textContent?.includes(${JSON.stringify(title)}))
        if (!(row instanceof HTMLElement)) return false
        row.click()
        return true
      })()`)
      assert.equal(clicked, true, title)
    }
    const setDraft = (text: string): Promise<void> => js(`(async () => {
      const input = document.querySelector('[data-composer-input]')
      if (!(input instanceof HTMLElement)) return
      input.focus()
      input.dispatchEvent(new InputEvent('beforeinput', {
        inputType: 'insertText', data: ${JSON.stringify(text)}, bubbles: true, cancelable: true,
      }))
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })()`)
    const activeGeneration = JSON.parse(fs.readFileSync(
      path.join(productRoot, 'runtime/active.json'), 'utf8',
    )) as { generation: string }
    const baseline = JSON.parse(fs.readFileSync(path.join(
      productRoot, 'runtime/generations', activeGeneration.generation, OUTPUT_TEST_BASELINE_FILE,
    ), 'utf8')) as { sessionA: string; generateAPrompt: string }
    const selectFile = (name: string, type: string, content: string): Promise<boolean> => js<boolean>(
      `(() => {
        const input = document.querySelector('[data-work-session-resource] input[type=file]')
        if (!(input instanceof HTMLInputElement)) return false
        const transfer = new DataTransfer()
        transfer.items.add(new File([${JSON.stringify(content)}], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} }))
        Object.defineProperty(input, 'files', { configurable: true, value: transfer.files })
        input.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`,
    )
    await clickSession('成果会话甲')
    const before = await waitFor(nativeState, value => value.sessionId === baseline.sessionA,
      'Target Session did not become active before generating an output')
    await setDraft(baseline.generateAPrompt)
    assert.equal(await selectFile('recovery-source.txt', 'text/plain', 'runtime recovery source'), true)
    await waitFor(
      () => js<string>("document.querySelector('[data-composer-input]')?.textContent ?? ''"),
      value => value.includes('recovery-source.txt') && value.includes(baseline.generateAPrompt),
      'Source resource was not attached before generating an output',
    )
    await js(`(() => {
      const input = document.querySelector('[data-composer-input]')
      const buttons = input?.closest('[data-composer-card]')?.querySelectorAll('button')
      const send = buttons?.item((buttons?.length ?? 0) - 1)
      if (send instanceof HTMLButtonElement) send.click()
    })()`)
    await waitFor(
      () => js<boolean>("Array.from(document.querySelectorAll('[data-work-session-output]')).some(item => item.textContent?.includes('report-a.md'))"),
      value => value,
      'A real Session output was not generated before the runtime fault',
    )
    await js("Array.from(document.querySelectorAll('[data-work-session-output]')).find(item => item.textContent?.includes('report-a.md'))?.click()")
    await waitFor(
      () => js<string>("document.querySelector('[data-work-output-preview]')?.getAttribute('data-work-output-preview') ?? ''"),
      value => value === 'report-a.md',
      'Generated output selection did not open before the runtime fault',
    )
    await waitFor(
      () => js<string>("document.querySelector('[data-work-output-preview-markdown]')?.textContent ?? ''"),
      value => value.includes('甲报告'),
      'Generated output was not readable before the runtime fault',
    )
    const selected = await nativeState()
    const draft = '运行时恢复后继续的未发送草稿'
    await setDraft(draft)
    await waitFor(
      () => js<{ readonly draft: string; readonly retained: boolean }>(`({
        draft: document.querySelector('[data-composer-input]')?.textContent ?? '',
        retained: window.name.startsWith('dsh-work-recovery:v1:')
          && typeof window.dshWorkRecovery?.update === 'function',
      })`),
      value => value.draft === draft && value.retained,
      'Draft context was not retained before lifecycle interruption',
    )

    step = 'runtime-unavailable'; write('fail')
    await new Promise(resolve => setTimeout(resolve, 250))
    assert.equal((await current.host.stop()).state, 'stopped')
    const unavailable = await waitFor(
      () => js<{ readonly state: string; readonly retained: boolean; readonly composer: boolean; readonly name: string }>(`({
        state: document.body.dataset.state ?? '',
        retained: !document.getElementById('retained')?.hidden,
        composer: Boolean(document.querySelector('[data-composer-input]')),
        name: window.name,
      })`),
      value => value.state === 'stopped',
      'Read-only recovery surface did not open',
    )
    assert.equal(unavailable.composer, false)
    assert.equal(unavailable.retained, true, `status context missing: ${unavailable.name}`)
    assert.equal(await js<string>('typeof window.dshWorkRecovery'), 'undefined')
    fs.writeFileSync(path.join(output, 'unavailable.png'),
      (await current.window.webContents.capturePage()).toPNG())
    screenshots.push('unavailable.png')
    assert.equal(await js<boolean>("document.getElementById('stop')?.disabled ?? false"), true)

    step = 'inject-runtime-launch-failure'; write('fail')
    await js("document.getElementById('start')?.click()")
    await waitFor(
      () => js<{ readonly state: string; readonly diagnostic: string; readonly canRetry: boolean }>(`({
        state: document.body.dataset.state ?? '',
        diagnostic: document.getElementById('diagnostic')?.textContent ?? '',
        canRetry: !(document.getElementById('start')?.disabled ?? true),
      })`),
      value => value.state === 'failed' && value.diagnostic === 'runtime-unavailable' && value.canRetry,
      'Injected runtime launch failure did not remain on the read-only retry surface',
    )

    step = 'return-to-original-session'; write('fail')
    await js("document.getElementById('start')?.click()")
    const restored = await waitFor(nativeState,
      value => value.ready && value.sessionId === before.sessionId && value.draft === draft,
      'Runtime restart did not return to the original Session and draft')
    assert.match(await js<string>('window.dshWorkRecovery.read()'), /^dsh-work-recovery:v1:/u)
    assert.equal(restored.turns, selected.turns)
    assert.equal(restored.conversations, selected.conversations)
    await waitFor(
      () => js<string>("document.querySelector('[data-work-output-preview]')?.getAttribute('data-work-output-preview') ?? ''"),
      value => value === 'report-a.md',
      'Selected output was not reopened from the original immutable coordinates',
    )
    await waitFor(
      () => js<string>("document.querySelector('[data-work-output-preview-markdown]')?.textContent ?? ''"),
      value => value.includes('甲报告'),
      'Selected output did not become readable after runtime recovery',
    )
    fs.writeFileSync(path.join(output, 'restored.png'),
      (await current.window.webContents.capturePage()).toPNG())
    screenshots.push('restored.png')

    step = 'close-cleanly'; write('fail')
    const terminal = await current.host.stop()
    const passed = terminal.state === 'stopped' && terminal.code === null
    step = 'complete'
    write(passed ? 'pass' : 'fail', {
      terminal,
      sameSession: restored.sessionId === before.sessionId,
      draftRestored: restored.draft === draft,
      noTurnReplay: restored.turns === selected.turns,
      noConversationCreated: restored.conversations === selected.conversations,
      outputSelectionRestored: true,
      injectedLaunchFailure: launches === 3,
    })
    if (!passed) process.exitCode = 1
    current.window.destroy()
    app.exit(passed ? 0 : 1)
  } catch (error) {
    if (window && !window.isDestroyed()) {
      try {
        fs.writeFileSync(path.join(output, 'failure.png'),
          (await window.webContents.capturePage()).toPNG())
        screenshots.push('failure.png')
      } catch {}
    }
    write('fail', { detail: error instanceof Error ? error.stack ?? error.message : 'unknown failure' })
    await host?.stop().catch(() => {})
    app.exit(1)
  }
}

void run()
