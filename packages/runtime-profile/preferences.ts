import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { discoverLocalProfiles, type DiscoveredLocalProfile } from './discovery.ts'

const SCHEMA = 'dsh-work.startup.v1' as const
const FILE = 'startup-preferences.json'
const MAX_BYTES = 4 * 1024

export type StartupSelection =
  | { readonly kind: 'isolated' }
  | {
    readonly kind: 'shared'
    readonly profileId: string
    readonly profileName: string
    readonly homePath: string
  }

const exactKeys = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())

const validSelection = (value: unknown): value is StartupSelection => {
  if (exactKeys(value, ['kind']) && value.kind === 'isolated') return true
  return exactKeys(value, ['kind', 'profileId', 'profileName', 'homePath'])
    && value.kind === 'shared'
    && typeof value.profileId === 'string' && /^[a-f0-9]{24}$/u.test(value.profileId)
    && typeof value.profileName === 'string' && value.profileName.length > 0 && value.profileName.length <= 128
    && !value.profileName.includes('/') && !value.profileName.includes('\\')
    && value.profileName !== '.' && value.profileName !== '..' && value.profileName !== 'node_modules'
    && typeof value.homePath === 'string' && path.isAbsolute(value.homePath)
}

const ownedRoot = (root: string): boolean => {
  try {
    const stat = fs.lstatSync(root)
    return stat.isDirectory() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

export function readStartupSelection(productRoot: string): StartupSelection | null {
  if (!path.isAbsolute(productRoot) || !ownedRoot(productRoot)) return null
  const file = path.join(productRoot, FILE)
  try {
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) return null
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
    if (!exactKeys(value, ['schema', 'selection']) || value.schema !== SCHEMA || !validSelection(value.selection)) return null
    return Object.freeze({ ...value.selection })
  } catch {
    return null
  }
}

export function writeStartupSelection(productRoot: string, selection: StartupSelection): void {
  if (!path.isAbsolute(productRoot) || !ownedRoot(productRoot) || !validSelection(selection)) {
    throw new Error('invalid startup selection')
  }
  const file = path.join(productRoot, FILE)
  const temporary = path.join(productRoot, `.${FILE}.${process.pid}.${randomUUID()}.tmp`)
  const bytes = `${JSON.stringify({ schema: SCHEMA, selection }, null, 2)}\n`
  if (Buffer.byteLength(bytes) > MAX_BYTES) throw new Error('invalid startup selection')
  try {
    fs.writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' })
    fs.renameSync(temporary, file)
  } finally {
    try { fs.unlinkSync(temporary) } catch {}
  }
}

/** Re-discover a persisted source before every launch so stale paths fail closed. */
export function resolveSelectedProfile(selection: StartupSelection | null): DiscoveredLocalProfile | null {
  if (!selection || selection.kind !== 'shared') return null
  const catalog = discoverLocalProfiles({
    environment: { DSH_HOME: selection.homePath },
    userHome: path.dirname(selection.homePath),
  })
  return catalog.profiles.find(profile => profile.id === selection.profileId
    && profile.name === selection.profileName
    && profile.homePath === selection.homePath) ?? null
}
