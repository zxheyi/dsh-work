import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import type { RuntimeStatus } from '../apps/desktop/contracts.ts'

const source = fs.readFileSync(new URL('../dist/apps/desktop/renderer.js', import.meta.url), 'utf8')
let moduleId = 0

interface ElementFixture {
  readonly dataset: Record<string, string>
  disabled: boolean
  hidden: boolean
  textContent: string
  addEventListener(name: string, action: () => void): void
}

interface DocumentFixture {
  readonly body: { readonly dataset: Record<string, string> }
  getElementById(id: string): ElementFixture
}

const createDocument = (actions?: Map<string, () => void>): {
  document: DocumentFixture
  elements: Map<string, ElementFixture>
} => {
  const elements = new Map<string, ElementFixture>()
  const document: DocumentFixture = {
    body: { dataset: {} },
    getElementById(id: string): ElementFixture {
      let element = elements.get(id)
      if (!element) {
        element = {
          dataset: {}, disabled: false, hidden: false, textContent: '',
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
    const encoded = Buffer.from(source).toString('base64')
    await import(`data:text/javascript;base64,${encoded}#${moduleId++}`)
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
      subscribe: (listener: (status: RuntimeStatus) => void) => { callbacks.listener = listener },
      snapshot: () => new Promise<RuntimeStatus>(() => {}),
    } }
    await withRenderer(document, window, () => {
      callbacks.listener?.({ state: 'failed', code, canStart: false, canStop: false, canRecover: false })
      assert.match(elements.get('detail')?.textContent ?? '', /直接子进程/)
      assert.equal(elements.get('start')?.disabled, true)
      callbacks.listener?.({ state: 'failed', code, canStart: false, canStop: false, canRecover: true })
      assert.equal(elements.get('start')?.disabled, true)
      assert.equal(elements.get('start')?.textContent, '启动已阻止')
      assert.equal(elements.get('recover')?.hidden, false)
      assert.equal(elements.get('stop')?.disabled, true)
    })
  }
})

test('uncertain generation requires a distinct explicit recovery action', async () => {
  const actions = new Map<string, () => void>()
  const { document, elements } = createDocument(actions)
  const callbacks: { listener: ((status: RuntimeStatus) => void) | null } = { listener: null }
  let recoverCalls = 0
  const window = { dshWork: {
    subscribe: (listener: (status: RuntimeStatus) => void) => { callbacks.listener = listener },
    snapshot: () => new Promise<RuntimeStatus>(() => {}),
    recover: async () => { recoverCalls++ }, start: async () => {}, stop: async () => {},
  } }
  await withRenderer(document, window, () => {
    callbacks.listener?.({ state: 'failed', code: 'recovery-required', canStart: false, canStop: false, canRecover: true })
    assert.equal(elements.get('start')?.disabled, true)
    assert.equal(elements.get('recover')?.hidden, false)
    assert.equal(elements.get('recover')?.disabled, false)
    assert.match(elements.get('detail')?.textContent ?? '', /旧数据不会被复用或删除/)
    actions.get('recover')?.()
    assert.equal(recoverCalls, 1)
  })
})
