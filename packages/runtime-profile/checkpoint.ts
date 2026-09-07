import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type { StartupSelection } from './preferences.ts'

const SCHEMA = 'dsh-work.startup-checkpoint.v1' as const
const RUNTIME = '0.1.2-alpha.2' as const
const FILE = 'startup-checkpoint.json'
const MAX_BYTES = 4 * 1024

export type StartupCheckpoint = Readonly<{
  schema: typeof SCHEMA
  runtime: typeof RUNTIME
  mode: 'selected' | 'safe'
  source: { readonly kind: 'isolated' } | {
    readonly kind: 'shared'
    readonly profileId: string
    readonly profileName: string
  }
  readyAt: string
}>

const exactKeys = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())

const validSource = (value: unknown): value is StartupCheckpoint['source'] => {
  if (exactKeys(value, ['kind']) && value.kind === 'isolated') return true
  return exactKeys(value, ['kind', 'profileId', 'profileName']) && value.kind === 'shared'
    && typeof value.profileId === 'string' && /^[a-f0-9]{24}$/u.test(value.profileId)
    && typeof value.profileName === 'string' && value.profileName.length > 0
    && value.profileName.length <= 128 && !/[\\/]/u.test(value.profileName)
}

const validCheckpoint = (value: unknown): value is StartupCheckpoint =>
  exactKeys(value, ['schema', 'runtime', 'mode', 'source', 'readyAt'])
  && value.schema === SCHEMA && value.runtime === RUNTIME
  && (value.mode === 'selected' || value.mode === 'safe') && validSource(value.source)
  && typeof value.readyAt === 'string' && Number.isFinite(Date.parse(value.readyAt))

const ownedRoot = (root: string): boolean => {
  try {
    const stat = fs.lstatSync(root)
    return path.isAbsolute(root) && stat.isDirectory() && !stat.isSymbolicLink()
  } catch { return false }
}

export function readStartupCheckpoint(productRoot: string): StartupCheckpoint | null {
  if (!ownedRoot(productRoot)) return null
  try {
    const file = path.join(productRoot, FILE)
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) return null
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
    return validCheckpoint(value) ? Object.freeze(value) : null
  } catch { return null }
}

export function writeStartupCheckpoint(
  productRoot: string,
  selection: StartupSelection | null,
  mode: 'selected' | 'safe',
  now: () => string = () => new Date().toISOString(),
): void {
  if (!ownedRoot(productRoot)) throw new Error('invalid checkpoint root')
  const source: StartupCheckpoint['source'] = mode === 'safe' || selection?.kind !== 'shared'
    ? Object.freeze({ kind: 'isolated' })
    : Object.freeze({ kind: 'shared', profileId: selection.profileId, profileName: selection.profileName })
  const value: StartupCheckpoint = Object.freeze({
    schema: SCHEMA, runtime: RUNTIME, mode, source, readyAt: now(),
  })
  if (!validCheckpoint(value)) throw new Error('invalid startup checkpoint')
  const bytes = `${JSON.stringify(value, null, 2)}\n`
  if (Buffer.byteLength(bytes) > MAX_BYTES) throw new Error('invalid startup checkpoint')
  const file = path.join(productRoot, FILE)
  const temporary = path.join(productRoot, `.${FILE}.${process.pid}.${randomUUID()}.tmp`)
  try {
    fs.writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' })
    fs.renameSync(temporary, file)
  } finally { try { fs.unlinkSync(temporary) } catch {} }
}
