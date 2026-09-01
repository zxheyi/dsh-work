import { createRuntimeHost } from '../runtime-host/index.ts'

const safeRetry = new Set(['runtime-unavailable'])
const bounded = (value, changes = {}) => Object.freeze({
  state: value.state,
  code: value.code,
  canStart: value.canStart,
  canStop: value.canStop,
  canRecover: false,
  ...changes,
})

export function createGuardianService({ store, prepare, launcher }) {
  let claim = null, runtime = null, unsubscribe = null
  let status = bounded({ state: 'stopped', code: null, canStart: true, canStop: false })
  const listeners = new Set()
  let disposing = false, disposePromise = null, resolveDispose = null
  const publish = value => {
    status = value
    for (const listener of [...listeners]) { try { listener(value) } catch {} }
    if (disposing) finalizeDispose()
    return value
  }
  const translate = value => {
    if (value.state !== 'failed') return bounded(value)
    if (!value.canStart) return bounded(value, { canStart: false, canRecover: false })
    if (safeRetry.has(value.code)) return bounded(value, { canStart: true, canRecover: false })
    return bounded(value, { canStart: false, canRecover: true })
  }
  const attach = selected => {
    unsubscribe?.()
    claim = selected
    prepare(selected.home)
    runtime = createRuntimeHost({ launch: launcher(selected.home) })
    unsubscribe = runtime.subscribe(value => publish(translate(value)))
    publish(translate(runtime.snapshot()))
  }
  const acquire = recover => {
    const selected = recover ? store.recover() : store.claim()
    if (selected.status !== 'claimed') {
      publish(bounded({ state: 'failed', code: selected.code, canStart: false, canStop: false }, { canRecover: true }))
      return false
    }
    try { attach(selected) } catch {
      publish(bounded({ state: 'failed', code: 'recovery-required', canStart: false,
        canStop: false }, { canRecover: true }))
      return false
    }
    return true
  }
  const finalizeDispose = () => {
    if (!disposing) return
    if (runtime && !runtime.snapshot().canStart) return
    const base = runtime?.snapshot()
    if (claim && (!base || base.state === 'stopped' || base.code === 'runtime-unavailable')) {
      store.releaseClean(claim.generation)
    }
    unsubscribe?.(); unsubscribe = null
    resolveDispose?.(true); resolveDispose = null
  }
  return Object.freeze({
    snapshot: () => status,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    async start() {
      if (!runtime && !acquire(false)) return status
      if (status.canRecover) return status
      return translate(await runtime.start())
    },
    async stop() {
      if (!runtime) return status
      return translate(await runtime.stop())
    },
    async recover() {
      if (runtime && !runtime.snapshot().canStart) return status
      if (!status.canRecover) return status
      if (!acquire(true)) return status
      return translate(await runtime.start())
    },
    dispose() {
      if (disposePromise) return disposePromise
      disposing = true
      disposePromise = new Promise(resolve => { resolveDispose = resolve })
      if (runtime && !runtime.snapshot().canStart) void runtime.stop()
      else finalizeDispose()
      return disposePromise
    },
  })
}
