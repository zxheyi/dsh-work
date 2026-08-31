import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

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
  vm.runInNewContext(fs.readFileSync(new URL('../apps/desktop/renderer.js', import.meta.url), 'utf8'), { document, window })
  listener({ state: 'ready', code: null, canStart: false, canStop: true })
  initial({ state: 'stopped', code: null, canStart: true, canStop: false })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(document.body.dataset.state, 'ready')
  assert.equal(elements.get('start').disabled, true)
})

test('abnormal runtime failures explain direct-child recovery and disable premature retry', () => {
  for (const code of ['unexpected-exit', 'lifecycle-disconnected', 'runtime-exit-failed']) {
    const elements = new Map()
    let listener
    const document = { body: { dataset: {} }, getElementById(id) {
      if (!elements.has(id)) elements.set(id, { dataset: {}, addEventListener() {} })
      return elements.get(id)
    } }
    const window = { dshWork: { subscribe: fn => { listener = fn }, snapshot: () => new Promise(() => {}) } }
    vm.runInNewContext(fs.readFileSync(new URL('../apps/desktop/renderer.js', import.meta.url), 'utf8'), { document, window })
    listener({ state: 'failed', code, canStart: false, canStop: false })
    assert.match(elements.get('detail').textContent, /直接子进程/)
    assert.equal(elements.get('start').disabled, true)
    listener({ state: 'failed', code, canStart: true, canStop: false })
    assert.equal(elements.get('start').disabled, false)
    assert.equal(elements.get('start').textContent, '重试启动')
    assert.equal(elements.get('stop').disabled, true)
  }
})
