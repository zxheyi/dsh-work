import { createRuntimeHost } from '../runtime-host/index.ts'

import type { RuntimeCode, RuntimeControl, RuntimeSnapshot } from '../runtime-contract/index.ts'
import type { RuntimeChild, RuntimeHost, RuntimeHostSnapshot } from '../runtime-host/index.ts'
import type { ClaimedGeneration, GenerationStore } from './generation-store.ts'

const safeRetry = new Set<RuntimeCode>(['runtime-unavailable'])

interface GuardianServiceOptions {
  readonly store: GenerationStore
  readonly prepare: (home: string) => void
  readonly launcher: (home: string) => () => RuntimeChild
}

export interface GuardianService extends RuntimeControl {
  dispose(): Promise<boolean>
}

type BaseSnapshot = Pick<RuntimeSnapshot, 'state' | 'code' | 'canStart' | 'canStop'>

const bounded = (
  value: BaseSnapshot,
  changes: Partial<Pick<RuntimeSnapshot, 'canStart' | 'canStop' | 'canRecover'>> = {},
): RuntimeSnapshot => Object.freeze({
  state: value.state,
  code: value.code,
  canStart: value.canStart,
  canStop: value.canStop,
  canRecover: false,
  ...changes,
})

export function createGuardianService({ store, prepare, launcher }: GuardianServiceOptions): GuardianService {
  let claim: ClaimedGeneration | null = null
  let runtime: RuntimeHost | null = null
  let unsubscribe: (() => void) | null = null
  let status = bounded({ state: 'stopped', code: null, canStart: true, canStop: false })
  const listeners = new Set<(snapshot: RuntimeSnapshot) => void>()
  let disposing = false
  let disposePromise: Promise<boolean> | null = null
  let resolveDispose: ((value: boolean) => void) | null = null

  const finalizeDispose = (): void => {
    if (!disposing) return
    if (runtime && !runtime.snapshot().canStart) return
    const base = runtime?.snapshot()
    if (claim && (!base || base.state === 'stopped' || base.code === 'runtime-unavailable')) {
      store.releaseClean(claim.generation)
    }
    unsubscribe?.()
    unsubscribe = null
    resolveDispose?.(true)
    resolveDispose = null
  }

  const publish = (value: RuntimeSnapshot): RuntimeSnapshot => {
    status = value
    for (const listener of [...listeners]) {
      try { listener(value) } catch {}
    }
    if (disposing) finalizeDispose()
    return value
  }

  const translate = (value: RuntimeHostSnapshot): RuntimeSnapshot => {
    if (value.state !== 'failed') return bounded(value)
    if (!value.canStart) return bounded(value, { canStart: false, canRecover: false })
    if (value.code && safeRetry.has(value.code)) return bounded(value, { canStart: true, canRecover: false })
    return bounded(value, { canStart: false, canRecover: true })
  }

  const attach = (selected: ClaimedGeneration): void => {
    unsubscribe?.()
    claim = selected
    prepare(selected.home)
    runtime = createRuntimeHost({ launch: launcher(selected.home) })
    unsubscribe = runtime.subscribe(value => publish(translate(value)))
    publish(translate(runtime.snapshot()))
  }

  const acquire = (recover: boolean): boolean => {
    const selected = recover ? store.recover() : store.claim()
    if (selected.status !== 'claimed') {
      publish(bounded({ state: 'failed', code: selected.code, canStart: false, canStop: false }, { canRecover: true }))
      return false
    }
    try {
      attach(selected)
    } catch {
      publish(bounded({
        state: 'failed',
        code: 'recovery-required',
        canStart: false,
        canStop: false,
      }, { canRecover: true }))
      return false
    }
    return true
  }

  return Object.freeze({
    snapshot: (): RuntimeSnapshot => status,
    subscribe(listener: (snapshot: RuntimeSnapshot) => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async start(): Promise<RuntimeSnapshot> {
      if (!runtime && !acquire(false)) return status
      if (status.canRecover) return status
      return translate(await runtime!.start())
    },
    async stop(): Promise<RuntimeSnapshot> {
      if (!runtime) return status
      return translate(await runtime.stop())
    },
    async recover(): Promise<RuntimeSnapshot> {
      if (runtime && !runtime.snapshot().canStart) return status
      if (!status.canRecover) return status
      if (!acquire(true)) return status
      return translate(await runtime!.start())
    },
    dispose(): Promise<boolean> {
      if (disposePromise) return disposePromise
      disposing = true
      disposePromise = new Promise<boolean>(resolve => { resolveDispose = resolve })
      if (runtime && !runtime.snapshot().canStart) void runtime.stop()
      else finalizeDispose()
      return disposePromise
    },
  })
}
