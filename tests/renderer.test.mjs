import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync(new URL('../dist/apps/desktop/renderer.js', import.meta.url), 'utf8')
let moduleId = 0

async function withRenderer(document, window, verify) {
  const hadDocument = Object.hasOwn(globalThis, 'document')
  const hadWindow = Object.hasOwn(globalThis, 'window')
  const previousDocument = globalThis.document
  const previousWindow = globalThis.window
  globalThis.document = document
  globalThis.window = window
  try {
    const encoded = Buffer.from(source).toString('base64')
    await import(`data:text/javascript;base64,${encoded}#${moduleId++}`)
    await verify()
  } finally {
    if (hadDocument) globalThis.document = previousDocument
    else delete globalThis.document
    if (hadWindow) globalThis.window = previousWindow
    else delete globalThis.window
  }
}

test('a late initial snapshot cannot overwrite a newer live status', async () => {
  const elements = new Map()
  let listener, initial
  const document = { body: { dataset: {} }, getElementById(id) {
    if (!elements.has(id)) elements.set(id, { dataset: {}, addEventListener() {} })
    return elements.get(id)
  } }
  const window = { dshWork: {
    subscribe: fn => { listener = fn },
    snapshot: () => new Promise(resolve => { initial = resolve }),
  } }
  await withRenderer(document, window, async () => {
    listener({ state: 'ready', code: null, canStart: false, canStop: true, canRecover: false })
    initial({ state: 'stopped', code: null, canStart: true, canStop: false, canRecover: false })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(document.body.dataset.state, 'ready')
    assert.equal(elements.get('start').disabled, true)
  })
})

test('abnormal runtime failures require explicit isolated recovery after direct-child cleanup', async () => {
  for (const code of ['unexpected-exit', 'lifecycle-disconnected', 'runtime-exit-failed']) {
    const elements = new Map()
    let listener
    const document = { body: { dataset: {} }, getElementById(id) {
      if (!elements.has(id)) elements.set(id, { dataset: {}, addEventListener() {} })
      return elements.get(id)
    } }
    const window = { dshWork: { subscribe: fn => { listener = fn }, snapshot: () => new Promise(() => {}) } }
    await withRenderer(document, window, () => {
      listener({ state: 'failed', code, canStart: false, canStop: false, canRecover: false })
      assert.match(elements.get('detail').textContent, /直接子进程/)
      assert.equal(elements.get('start').disabled, true)
      listener({ state: 'failed', code, canStart: false, canStop: false, canRecover: true })
      assert.equal(elements.get('start').disabled, true)
      assert.equal(elements.get('start').textContent, '启动已阻止')
      assert.equal(elements.get('recover').hidden, false)
      assert.equal(elements.get('stop').disabled, true)
    })
  }
})

test('uncertain generation requires a distinct explicit recovery action', async () => {
  const elements = new Map(), actions = new Map()
  let listener, recoverCalls = 0
  const document = { body: { dataset: {} }, getElementById(id) {
    if (!elements.has(id)) elements.set(id, { dataset: {}, addEventListener: (_name, action) => actions.set(id, action) })
    return elements.get(id)
  } }
  const window = { dshWork: {
    subscribe: fn => { listener = fn }, snapshot: () => new Promise(() => {}),
    recover: async () => { recoverCalls++ }, start: async () => {}, stop: async () => {},
  } }
  await withRenderer(document, window, () => {
    listener({ state: 'failed', code: 'recovery-required', canStart: false, canStop: false, canRecover: true })
    assert.equal(elements.get('start').disabled, true)
    assert.equal(elements.get('recover').hidden, false)
    assert.equal(elements.get('recover').disabled, false)
    assert.match(elements.get('detail').textContent, /旧数据不会被复用或删除/)
    actions.get('recover')()
    assert.equal(recoverCalls, 1)
  })
})
