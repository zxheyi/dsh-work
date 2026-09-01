import { execFileSync, spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { boundedGuardianSnapshot, GUARDIAN_PROTOCOL } from './protocol.mjs'

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), 'process.mjs')
const unavailable = Object.freeze({ state: 'failed', code: 'guardian-unavailable', canStart: false,
  canStop: false, canRecover: false })

export async function createGuardianClient({ node, productRoot }, {
  spawnProcess = spawn,
  probe = execFileSync,
  readyMs = 5_000,
} = {}) {
  if (!path.isAbsolute(node || '') || !path.isAbsolute(productRoot || '')) throw new Error('explicit guardian paths required')
  if (probe(node, ['--version'], { timeout: 5_000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() !== 'v24.11.1') {
    throw new Error('guardian Node version mismatch')
  }
  const env = { PATH: path.dirname(node), NO_COLOR: '1' }
  for (const key of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']) {
    if (process.env[key]) env[key] = process.env[key]
  }
  const child = spawnProcess(node, [entry, productRoot], { env, shell: false, windowsHide: true,
    detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  let status = unavailable, sequence = 0, settled = false, terminated = false, disposing = false
  const listeners = new Set(), pending = new Map()
  const publish = value => {
    status = value
    for (const listener of [...listeners]) { try { listener(value) } catch {} }
  }
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('guardian readiness timeout'))
      if (child.connected) child.disconnect()
    }, readyMs)
    const terminate = () => {
      if (terminated) return
      terminated = true
      clearTimeout(timeout)
      if (!disposing) publish(unavailable)
      for (const item of pending.values()) item.reject(new Error('guardian unavailable'))
      pending.clear()
      if (!settled) reject(new Error('guardian unavailable'))
    }
    child.on('message', message => {
      if (!message || message.protocol !== GUARDIAN_PROTOCOL) return
      if (message.event === 'guardian-ready' && !settled) {
        const value = boundedGuardianSnapshot(message.value)
        if (!value) return
        settled = true; clearTimeout(timeout); publish(value); resolve()
      } else if (message.event === 'status') {
        const value = boundedGuardianSnapshot(message.value)
        if (value) publish(value)
      } else if (Number.isSafeInteger(message.id) && pending.has(message.id)) {
        const value = boundedGuardianSnapshot(message.result)
        if (!value) return
        const done = pending.get(message.id); pending.delete(message.id); done.resolve(value)
      }
    })
    child.once('error', terminate)
    // `exit` is the ownership boundary. Some platforms do not emit `close`
    // promptly for a detached child after its IPC channel disappears.
    child.once('exit', terminate)
    child.once('close', terminate)
  })
  await ready
  const request = command => new Promise((resolve, reject) => {
    if (!child.connected) { reject(new Error('guardian unavailable')); return }
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
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    async dispose(waitMs = 3_000) {
      if (!child.connected) return child.exitCode !== null
      disposing = true
      return new Promise(resolve => {
        const timeout = setTimeout(() => resolve(false), waitMs)
        child.once('exit', () => { clearTimeout(timeout); resolve(true) })
        child.disconnect()
      })
    },
  })
}
