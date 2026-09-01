import {
  execFileSync,
  spawn,
  type ChildProcess,
  type ExecFileSyncOptionsWithStringEncoding,
  type SpawnOptions,
} from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type {
  RuntimeCommandName,
  RuntimeControl,
  RuntimeSnapshot,
} from '../runtime-contract/index.ts'
import {
  boundedGuardianSnapshot,
  GUARDIAN_PROTOCOL,
} from './protocol.ts'

interface GuardianClientPaths {
  readonly node: string
  readonly productRoot: string
}

interface GuardianClientDependencies {
  readonly spawnProcess?: (
    executable: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => ChildProcess
  readonly probe?: (
    executable: string,
    args: readonly string[],
    options: ExecFileSyncOptionsWithStringEncoding,
  ) => string
  readonly readyMs?: number
}

interface PendingRequest {
  readonly resolve: (value: RuntimeSnapshot) => void
  readonly reject: (error: Error) => void
}

export interface GuardianClient extends RuntimeControl {
  dispose(waitMs?: number): Promise<boolean>
}

const currentFile = fileURLToPath(import.meta.url)
const entry = path.join(path.dirname(currentFile), `process${path.extname(currentFile) === '.ts' ? '.ts' : '.js'}`)
const spawnGuardian: NonNullable<GuardianClientDependencies['spawnProcess']> = (executable, args, options) =>
  spawn(executable, [...args], options)
const probeGuardian: NonNullable<GuardianClientDependencies['probe']> = (executable, args, options) =>
  execFileSync(executable, args, options)
const unavailable: RuntimeSnapshot = Object.freeze({
  state: 'failed',
  code: 'guardian-unavailable',
  canStart: false,
  canStop: false,
  canRecover: false,
})

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

export async function createGuardianClient(
  { node, productRoot }: GuardianClientPaths,
  { spawnProcess = spawnGuardian, probe = probeGuardian, readyMs = 5_000 }: GuardianClientDependencies = {},
): Promise<GuardianClient> {
  if (!path.isAbsolute(node || '') || !path.isAbsolute(productRoot || '')) {
    throw new Error('explicit guardian paths required')
  }
  const version = probe(node, ['--version'], {
    timeout: 5_000,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (version.trim() !== 'v24.11.1') throw new Error('guardian Node version mismatch')
  const env: NodeJS.ProcessEnv = { PATH: path.dirname(node), NO_COLOR: '1' }
  for (const key of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']) {
    if (process.env[key]) env[key] = process.env[key]
  }
  const child = spawnProcess(node, [entry, productRoot], {
    env,
    shell: false,
    windowsHide: true,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  })
  let status = unavailable
  let sequence = 0
  let settled = false
  let terminated = false
  let disposing = false
  const listeners = new Set<(snapshot: RuntimeSnapshot) => void>()
  const pending = new Map<number, PendingRequest>()

  const publish = (value: RuntimeSnapshot): void => {
    status = value
    for (const listener of [...listeners]) {
      try { listener(value) } catch {}
    }
  }

  const ready = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('guardian readiness timeout'))
      if (child.connected) child.disconnect()
    }, readyMs)
    const terminate = (): void => {
      if (terminated) return
      terminated = true
      clearTimeout(timeout)
      if (!disposing) publish(unavailable)
      for (const item of pending.values()) item.reject(new Error('guardian unavailable'))
      pending.clear()
      if (!settled) reject(new Error('guardian unavailable'))
    }
    child.on('message', (message: unknown) => {
      const record = asRecord(message)
      if (!record || record.protocol !== GUARDIAN_PROTOCOL) return
      if (record.event === 'guardian-ready' && !settled) {
        const value = boundedGuardianSnapshot(record.value)
        if (!value) return
        settled = true
        clearTimeout(timeout)
        publish(value)
        resolve()
      } else if (record.event === 'status') {
        const value = boundedGuardianSnapshot(record.value)
        if (value) publish(value)
      } else if (typeof record.id === 'number' && Number.isSafeInteger(record.id) && pending.has(record.id)) {
        const value = boundedGuardianSnapshot(record.result)
        if (!value) return
        const done = pending.get(record.id)!
        pending.delete(record.id)
        done.resolve(value)
      }
    })
    child.once('error', terminate)
    // `exit` is the ownership boundary. Some platforms do not emit `close`
    // promptly for a detached child after its IPC channel disappears.
    child.once('exit', terminate)
    child.once('close', terminate)
  })
  await ready

  const request = (command: RuntimeCommandName): Promise<RuntimeSnapshot> =>
    new Promise<RuntimeSnapshot>((resolve, reject) => {
      if (!child.connected) {
        reject(new Error('guardian unavailable'))
        return
      }
      const id = ++sequence
      pending.set(id, { resolve, reject })
      try {
        child.send({ protocol: GUARDIAN_PROTOCOL, id, command }, error => {
          if (error && pending.delete(id)) reject(new Error('guardian unavailable'))
        })
      } catch {
        pending.delete(id)
        reject(new Error('guardian unavailable'))
      }
    })

  return Object.freeze({
    start: () => request('start'),
    stop: () => request('stop'),
    recover: () => request('recover'),
    snapshot: () => status,
    subscribe(listener: (snapshot: RuntimeSnapshot) => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async dispose(waitMs = 3_000): Promise<boolean> {
      if (!child.connected) return child.exitCode !== null
      disposing = true
      return new Promise<boolean>(resolve => {
        const timeout = setTimeout(() => resolve(false), waitMs)
        child.once('exit', () => {
          clearTimeout(timeout)
          resolve(true)
        })
        child.disconnect()
      })
    },
  })
}
