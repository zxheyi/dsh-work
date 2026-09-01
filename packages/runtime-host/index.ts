import type { ChildProcess } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'

import type { RuntimeHostCode, RuntimeState } from '../runtime-contract/index.ts'

export type { RuntimeHostCode } from '../runtime-contract/index.ts'
export type RuntimeHostState = RuntimeState

export interface RuntimeHostSnapshot {
  readonly state: RuntimeHostState
  readonly code: RuntimeHostCode | null
  readonly canStart: boolean
  readonly canStop: boolean
}

export interface RuntimeChild extends ChildProcess {
  stdin: Writable
  stdout: Readable
  stderr: Readable
}

export interface RuntimeHostOptions {
  readonly launch: () => RuntimeChild
  readonly startupMs?: number
  readonly stopMs?: number
  readonly reapMs?: number
  readonly outputLimit?: number
}

export interface RuntimeHost {
  start(): Promise<RuntimeHostSnapshot>
  stop(): Promise<RuntimeHostSnapshot>
  snapshot(): RuntimeHostSnapshot
  subscribe(listener: (snapshot: RuntimeHostSnapshot) => void): () => void
}

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T | PromiseLike<T>) => void
}

interface Owner {
  child: RuntimeChild | null
  readonly started: Deferred<RuntimeHostSnapshot>
  readonly stopped: Deferred<RuntimeHostSnapshot>
  stopping: boolean
  failure: RuntimeHostCode | null
  disposed: boolean
  ready: boolean
  exited: boolean
  bytes: number
  messages: number
  startTimer?: NodeJS.Timeout
  stopTimer?: NodeJS.Timeout
  reapTimer?: NodeJS.Timeout
}

interface LifecycleMessage {
  readonly protocol: 'dsh-work.lifecycle.v1'
  readonly event: 'ready' | 'disposed'
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: Deferred<T>['resolve']
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

const isLifecycleMessage = (value: unknown): value is LifecycleMessage => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const message = value as Record<string, unknown>
  return Object.keys(message).length === 2 && message.protocol === 'dsh-work.lifecycle.v1' &&
    (message.event === 'ready' || message.event === 'disposed')
}

// DSH Work owns supervision only. Harness owns startup and plugin disposal.
export function createRuntimeHost({
  launch,
  startupMs = 30_000,
  stopMs = 8_000,
  reapMs = 2_000,
  outputLimit = 1024 * 1024,
}: RuntimeHostOptions): RuntimeHost {
  let current: Owner | null = null
  let state: RuntimeHostState = 'stopped'
  let code: RuntimeHostCode | null = null
  const listeners = new Set<(snapshot: RuntimeHostSnapshot) => void>()
  const notifications: RuntimeHostSnapshot[] = []
  let notifying = false

  const snapshot = (): RuntimeHostSnapshot => Object.freeze({
    state,
    code,
    canStart: !current && (state === 'stopped' || state === 'failed'),
    canStop: !!current && (state === 'starting' || state === 'ready'),
  })

  const publish = (
    next: RuntimeHostState,
    reason: RuntimeHostCode | null = null,
    beforeNotify: (value: RuntimeHostSnapshot) => void = () => {},
  ): void => {
    state = next
    code = reason
    const value = snapshot()
    beforeNotify(value)
    notifications.push(value)
    if (notifying) return
    notifying = true
    while (notifications.length) {
      const notice = notifications.shift()!
      for (const listener of [...listeners]) {
        // Reentrant presentation actions cannot change an earlier result.
        try { listener(notice) } catch {}
      }
    }
    notifying = false
  }

  const settle = (owner: Owner, value: RuntimeHostSnapshot): void => {
    owner.started.resolve(value)
    owner.stopped.resolve(value)
  }

  const armReapDeadline = (owner: Owner): void => {
    if (owner.reapTimer !== undefined) return
    owner.reapTimer = setTimeout(() => {
      if (current !== owner) return
      // Keep ownership until close, even when process exit is already known.
      publish('failed', 'cleanup-unconfirmed', value => settle(owner, value))
    }, reapMs)
  }

  const armStopDeadline = (owner: Owner): void => {
    if (owner.exited || owner.stopTimer !== undefined) return
    clearTimeout(owner.startTimer)
    owner.stopTimer = setTimeout(() => {
      if (current !== owner || owner.exited || !owner.child) return
      owner.failure = 'forced-stop'
      try { owner.child.kill('SIGKILL') } catch {}
      armReapDeadline(owner)
    }, stopMs)
  }

  const stopOwned = (owner: Owner, failure: RuntimeHostCode | null): void => {
    if (current !== owner || owner.exited || !owner.child) return
    owner.failure ||= failure
    // Native EOF waits for Ready. An early user stop must retain the original
    // startup deadline; an explicit fault must still enter bounded cleanup.
    if (owner.ready || owner.failure) armStopDeadline(owner)
    if (owner.stopping) return
    owner.stopping = true
    publish('stopping', owner.failure)
    try { owner.child.stdin.end() } catch {
      owner.failure ||= 'control-pipe-error'
      armStopDeadline(owner)
    }
  }

  const start = (): Promise<RuntimeHostSnapshot> => {
    if (current) return state === 'starting' ? current.started.promise : Promise.resolve(snapshot())
    const owner: Owner = {
      child: null,
      started: deferred(),
      stopped: deferred(),
      stopping: false,
      failure: null,
      disposed: false,
      ready: false,
      exited: false,
      bytes: 0,
      messages: 0,
    }
    current = owner
    state = 'starting'
    code = null
    try {
      owner.child = launch()
    } catch {
      current = null
      publish('failed', 'runtime-unavailable', value => settle(owner, value))
      return owner.started.promise
    }
    const child = owner.child
    owner.startTimer = setTimeout(() => stopOwned(owner, 'startup-timeout'), startupMs)
    child.on('message', (message: unknown) => {
      if (current !== owner) return
      if (!isLifecycleMessage(message) || ++owner.messages > 2) {
        stopOwned(owner, 'invalid-lifecycle-message')
        return
      }
      if (message.event === 'disposed') {
        owner.disposed = true
        return
      }
      if (owner.exited) return
      if (owner.ready || owner.disposed) {
        stopOwned(owner, 'invalid-lifecycle-message')
        return
      }
      owner.ready = true
      clearTimeout(owner.startTimer)
      if (owner.stopping) {
        armStopDeadline(owner)
        return
      }
      publish('ready', null, value => owner.started.resolve(value))
    })
    const consume = (chunk: Buffer | string): void => {
      if (current !== owner) return
      owner.bytes += chunk.length
      // No output bytes, paths, arbitrary errors, tokens or URLs are retained.
      if (owner.bytes > outputLimit) stopOwned(owner, 'output-limit')
    }
    child.stdout.on('data', consume)
    child.stderr.on('data', consume)
    child.stdin.on('error', () => {
      if (current !== owner) return
      if (!owner.stopping) stopOwned(owner, 'control-pipe-error')
      else armStopDeadline(owner)
    })
    child.on('error', () => stopOwned(owner, 'process-error'))
    child.on('disconnect', () => {
      if (current !== owner) return
      if (!owner.stopping) stopOwned(owner, 'lifecycle-disconnected')
      // Native rejection may disconnect before close. Bound cleanup without
      // replacing its exit classification or resetting an existing deadline.
      else armStopDeadline(owner)
    })
    child.once('exit', (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (current !== owner) return
      owner.exited = true
      clearTimeout(owner.startTimer)
      clearTimeout(owner.stopTimer)
      owner.failure ||= !owner.stopping ? 'unexpected-exit' :
        exitCode !== 0 || signal ? 'runtime-exit-failed' : null
      armReapDeadline(owner)
      // Report the failure now, but never release ownership before stdio closes.
      if (owner.failure) publish('failed', owner.failure)
    })
    child.once('close', (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (current !== owner) return
      clearTimeout(owner.startTimer)
      clearTimeout(owner.stopTimer)
      clearTimeout(owner.reapTimer)
      const failure = owner.failure || (!owner.stopping ? 'unexpected-exit' :
        exitCode !== 0 || signal ? 'runtime-exit-failed' : !owner.disposed ? 'disposal-unconfirmed' : null)
      current = null
      publish(failure ? 'failed' : 'stopped', failure, value => settle(owner, value))
    })
    publish('starting')
    return owner.started.promise
  }

  return Object.freeze({
    start,
    snapshot,
    stop(): Promise<RuntimeHostSnapshot> {
      if (!current) return Promise.resolve(snapshot())
      const owner = current
      stopOwned(owner, null)
      return owner.stopped.promise
    },
    subscribe(listener: (snapshot: RuntimeHostSnapshot) => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  })
}
