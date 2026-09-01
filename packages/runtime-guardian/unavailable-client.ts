import type { RuntimeSnapshot } from '../runtime-contract/index.ts'
import type { GuardianClient } from './client.ts'

const stopped: RuntimeSnapshot = Object.freeze({
  state: 'stopped',
  code: null,
  canStart: true,
  canStop: false,
  canRecover: false,
})

const unavailable: RuntimeSnapshot = Object.freeze({
  state: 'failed',
  code: 'runtime-unavailable',
  canStart: true,
  canStop: false,
  canRecover: false,
})

export function createUnavailableGuardianClient(): GuardianClient {
  let status = stopped
  const listeners = new Set<(snapshot: RuntimeSnapshot) => void>()
  const publishUnavailable = async (): Promise<RuntimeSnapshot> => {
    status = unavailable
    for (const listener of [...listeners]) {
      try { listener(status) } catch {}
    }
    return status
  }
  return Object.freeze({
    start: publishUnavailable,
    stop: async () => status,
    recover: async () => status,
    snapshot: () => status,
    subscribe(listener: (snapshot: RuntimeSnapshot) => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose: async () => true,
  })
}
