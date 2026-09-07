import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import type { RuntimeStatus } from '../apps/desktop/contracts.ts'

let moduleId = 0

interface ElementFixture {
  readonly dataset: Record<string, string>
  disabled: boolean
  hidden: boolean
  textContent: string
  value: string
  append(child: ElementFixture): void
  replaceChildren(): void
  addEventListener(name: string, action: () => void): void
}

interface DocumentFixture {
  readonly body: { readonly dataset: Record<string, string> }
  getElementById(id: string): ElementFixture
  createElement(name: string): ElementFixture
}

const createDocument = (actions?: Map<string, () => void>): {
  document: DocumentFixture
  elements: Map<string, ElementFixture>
} => {
  const elements = new Map<string, ElementFixture>()
  const document: DocumentFixture = {
    body: { dataset: {} },
    createElement(): ElementFixture {
      return {
        dataset: {}, disabled: false, hidden: false, textContent: '', value: '',
        append: () => {}, replaceChildren: () => {}, addEventListener: () => {},
      }
    },
    getElementById(id: string): ElementFixture {
      let element = elements.get(id)
      if (!element) {
        element = {
          dataset: {}, disabled: false, hidden: false, textContent: '', value: '',
          append(child): void { if (!element?.value) element!.value = child.value },
          replaceChildren(): void { element!.value = '' },
          addEventListener: (_name: string, action: () => void): void => { actions?.set(id, action) },
        }
        elements.set(id, element)
      }
      return element
    },
  }
  return { document, elements }
}

async function withRenderer(document: DocumentFixture, window: unknown, verify: () => void | Promise<void>): Promise<void> {
  const hadDocument = Object.hasOwn(globalThis, 'document')
  const hadWindow = Object.hasOwn(globalThis, 'window')
  const previousDocument = globalThis.document
  const previousWindow = globalThis.window
  Reflect.set(globalThis, 'document', document)
  Reflect.set(globalThis, 'window', window)
  try {
    await import(new URL(`../dist/apps/desktop/renderer.js?case=${String(moduleId++)}`, import.meta.url).href)
    await verify()
  } finally {
    if (hadDocument) Reflect.set(globalThis, 'document', previousDocument)
    else Reflect.deleteProperty(globalThis, 'document')
    if (hadWindow) Reflect.set(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
}

test('a late initial snapshot cannot overwrite a newer live status', async () => {
  const { document, elements } = createDocument()
  const callbacks: {
    listener: ((status: RuntimeStatus) => void) | null
    initial: ((status: RuntimeStatus) => void) | null
  } = { listener: null, initial: null }
  const window = { dshWork: {
    hasRetainedContext: false,
    startup: async () => ({ choiceRequired: false, homeLabel: '~/.dsh', profiles: [], rejectedCount: 0, selected: 'isolated' }),
    selectProfile: async () => ({ state: 'starting', code: null, canStart: false, canStop: true, canRecover: false }),
    subscribe: (listener: (status: RuntimeStatus) => void) => { callbacks.listener = listener },
    snapshot: () => new Promise<RuntimeStatus>(resolve => { callbacks.initial = resolve }),
  } }
  await withRenderer(document, window, async () => {
    callbacks.listener?.({ state: 'ready', code: null, canStart: false, canStop: true, canRecover: false })
    callbacks.initial?.({ state: 'stopped', code: null, canStart: true, canStop: false, canRecover: false })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(document.body.dataset.state, 'ready')
    assert.equal(elements.get('start')?.disabled, true)
  })
})

test('abnormal runtime failures require explicit isolated recovery after direct-child cleanup', async () => {
  for (const code of ['unexpected-exit', 'lifecycle-disconnected', 'runtime-exit-failed'] as const) {
    const { document, elements } = createDocument()
    const callbacks: { listener: ((status: RuntimeStatus) => void) | null } = { listener: null }
    const window = { dshWork: {
      hasRetainedContext: false,
      startup: async () => ({ choiceRequired: false, homeLabel: '~/.dsh', profiles: [], rejectedCount: 0, selected: 'isolated' }),
      selectProfile: async () => ({ state: 'starting', code: null, canStart: false, canStop: true, canRecover: false }),
      subscribe: (listener: (status: RuntimeStatus) => void) => { callbacks.listener = listener },
      snapshot: () => new Promise<RuntimeStatus>(() => {}),
    } }
    await withRenderer(document, window, () => {
      callbacks.listener?.({ state: 'failed', code, canStart: false, canStop: false, canRecover: false })
      assert.match(elements.get('detail')?.textContent ?? '', /安全恢复/)
      assert.equal(elements.get('start')?.disabled, true)
      callbacks.listener?.({ state: 'failed', code, canStart: false, canStop: false, canRecover: true })
      assert.equal(elements.get('start')?.disabled, true)
      assert.equal(elements.get('start')?.textContent, '等待安全恢复')
      assert.equal(elements.get('recover')?.hidden, false)
      assert.equal(elements.get('stop')?.disabled, true)
    })
  }
})

test('runtime failure page reports retained conversation context without enabling writes', async () => {
  const { document, elements } = createDocument()
  const callbacks: { listener: ((status: RuntimeStatus) => void) | null } = { listener: null }
  const window = {
    name: 'dsh-work-recovery:v1:{"bounded":true}',
    dshWork: {
      hasRetainedContext: true,
      startup: async () => ({ choiceRequired: false, homeLabel: '~/.dsh', profiles: [], rejectedCount: 0, selected: 'isolated' }),
      selectProfile: async () => ({ state: 'starting', code: null, canStart: false, canStop: true, canRecover: false }),
      subscribe: (listener: (status: RuntimeStatus) => void) => { callbacks.listener = listener },
      snapshot: () => new Promise<RuntimeStatus>(() => {}),
      recover: async () => {}, start: async () => {}, stop: async () => {},
    },
  }
  await withRenderer(document, window, () => {
    callbacks.listener?.({ state: 'failed', code: 'unexpected-exit', canStart: false, canStop: false, canRecover: true })
    assert.equal(elements.get('retained')?.hidden, false)
    assert.equal(elements.get('start')?.disabled, true)
    assert.equal(elements.get('stop')?.disabled, true)
    assert.equal(elements.get('recover')?.disabled, false)
  })
})

test('uncertain generation requires a distinct explicit recovery action', async () => {
  const actions = new Map<string, () => void>()
  const { document, elements } = createDocument(actions)
  const callbacks: { listener: ((status: RuntimeStatus) => void) | null } = { listener: null }
  let recoverCalls = 0
  const window = { dshWork: {
    hasRetainedContext: false,
    startup: async () => ({ choiceRequired: false, homeLabel: '~/.dsh', profiles: [], rejectedCount: 0, selected: 'isolated' }),
    selectProfile: async () => ({ state: 'starting', code: null, canStart: false, canStop: true, canRecover: false }),
    subscribe: (listener: (status: RuntimeStatus) => void) => { callbacks.listener = listener },
    snapshot: () => new Promise<RuntimeStatus>(() => {}),
    recover: async () => { recoverCalls++ }, start: async () => {}, stop: async () => {},
  } }
  await withRenderer(document, window, () => {
    callbacks.listener?.({ state: 'failed', code: 'recovery-required', canStart: false, canStop: false, canRecover: true })
    assert.equal(elements.get('start')?.disabled, true)
    assert.equal(elements.get('recover')?.hidden, false)
    assert.equal(elements.get('recover')?.disabled, false)
    assert.match(elements.get('detail')?.textContent ?? '', /原有数据不会被自动删除/)
    actions.get('recover')?.()
    assert.equal(recoverCalls, 1)
  })
})

test('first launch offers bounded local choices and starts only after selection', async () => {
  const actions = new Map<string, () => void>()
  const { document, elements } = createDocument(actions)
  const selected: Array<string | null> = []
  const profileId = '0123456789abcdef01234567'
  const status: RuntimeStatus = { state: 'starting', code: null, canStart: false, canStop: true, canRecover: false }
  const window = { dshWork: {
    hasRetainedContext: false,
    subscribe: () => () => {},
    snapshot: async () => ({ state: 'stopped', code: null, canStart: true, canStop: false, canRecover: false }),
    startup: async () => ({
      choiceRequired: true, homeLabel: '$DSH_HOME' as const,
      profiles: [{ id: profileId, name: 'web' }], rejectedCount: 1, selected: null,
    }),
    selectProfile: async (value: string | null) => { selected.push(value); return status },
    recover: async () => status, start: async () => status, stop: async () => status,
  } }
  await withRenderer(document, window, async () => {
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(elements.get('onboarding')?.hidden, false)
    assert.equal(elements.get('profile-choice')?.value, profileId)
    assert.equal(elements.get('use-local')?.disabled, false)
    actions.get('use-local')?.()
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(selected, [profileId])
    assert.equal(elements.get('onboarding')?.hidden, true)
  })
})

test('local shell copy uses product language instead of Harness configuration vocabulary', () => {
  const visibleSources = [
    fs.readFileSync(new URL('../apps/desktop/index.html', import.meta.url), 'utf8'),
  ].join('\n')
  assert.doesNotMatch(visibleSources, /DSH Web|Workspace|Session|Profile|CLI|generation/u)
  assert.match(visibleSources, /DSH Work/u)
  assert.match(visibleSources, /安全模式/u)
})
