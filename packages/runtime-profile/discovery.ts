import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const MAX_MANIFEST_BYTES = 64 * 1024
const MAX_PROFILE_NAME_BYTES = 128
const MAX_PROFILES = 32
const BASE_BUNDLE = '@deepseek-ai/dsh-base'
const WEB_BUNDLE = '@deepseek-ai/dsh-web-app'

export interface LocalProfileSummary {
  readonly id: string
  readonly name: string
}

export interface PublicProfileCatalog {
  readonly homeLabel: '~/.dsh' | '$DSH_HOME'
  readonly profiles: readonly LocalProfileSummary[]
  readonly rejectedCount: number
}

export interface DiscoveredLocalProfile extends LocalProfileSummary {
  readonly homePath: string
  readonly profilePath: string
  readonly bundles: readonly string[]
}

export interface LocalProfileCatalog extends PublicProfileCatalog {
  readonly homePath: string
  readonly profiles: readonly DiscoveredLocalProfile[]
}

export interface LocalProfileDiscoveryOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>
  readonly userHome: string
}

const ownedDirectory = (value: string): boolean => {
  try {
    const stat = fs.lstatSync(value)
    return stat.isDirectory() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

const ownedOptionalFile = (value: string): boolean => {
  try {
    const stat = fs.lstatSync(value)
    return stat.isFile() && !stat.isSymbolicLink()
  } catch (error: unknown) {
    return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
  }
}

const resolveHome = (
  environment: Readonly<Record<string, string | undefined>>,
  userHome: string,
): { readonly path: string; readonly label: '~/.dsh' | '$DSH_HOME' } | null => {
  if (!path.isAbsolute(userHome)) return null
  const configured = environment.DSH_HOME?.trim()
  if (!configured) return { path: path.join(userHome, '.dsh'), label: '~/.dsh' }
  const expanded = configured === '~' ? userHome
    : configured.startsWith('~/') || configured.startsWith('~\\')
      ? path.join(userHome, configured.slice(2))
      : configured
  if (!path.isAbsolute(expanded)) return null
  return { path: path.normalize(expanded), label: '$DSH_HOME' }
}

const readBundles = (manifestPath: string): readonly string[] | null => {
  try {
    const stat = fs.lstatSync(manifestPath)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_MANIFEST_BYTES) return null
    const value = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const dsh = Reflect.get(value, 'dsh') as unknown
    if (!dsh || typeof dsh !== 'object' || Array.isArray(dsh)) return null
    const profile = Reflect.get(dsh, 'profile') as unknown
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null
    const bundles = Reflect.get(profile, 'bundles') as unknown
    if (!Array.isArray(bundles) || bundles.length < 2 || bundles.length > 64
      || bundles.some(item => typeof item !== 'string' || item.length === 0 || item.length > 256)) return null
    if (bundles[0] !== BASE_BUNDLE || bundles[1] !== WEB_BUNDLE) return null
    if (bundles.some(item => item.startsWith('@dsh-work/'))) return null
    return Object.freeze([...bundles] as string[])
  } catch {
    return null
  }
}

const profileId = (home: string, name: string): string =>
  createHash('sha256').update(home).update('\0').update(name).digest('hex').slice(0, 24)

/** Discover local Web profiles without following links or exposing source paths to the renderer. */
export function discoverLocalProfiles({
  environment = process.env,
  userHome,
}: LocalProfileDiscoveryOptions): LocalProfileCatalog {
  const resolved = resolveHome(environment, userHome)
  const fallbackPath = path.isAbsolute(userHome) ? path.join(userHome, '.dsh') : path.parse(process.cwd()).root
  if (!resolved || !ownedDirectory(resolved.path)) return Object.freeze({
    homePath: resolved?.path ?? fallbackPath,
    homeLabel: resolved?.label ?? '~/.dsh',
    profiles: Object.freeze([]),
    rejectedCount: 0,
  })
  const profilesRoot = path.join(resolved.path, 'profiles')
  if (!ownedDirectory(profilesRoot)) return Object.freeze({
    homePath: resolved.path,
    homeLabel: resolved.label,
    profiles: Object.freeze([]),
    rejectedCount: 0,
  })

  const profiles: DiscoveredLocalProfile[] = []
  let rejectedCount = 0
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(profilesRoot, { withFileTypes: true })
  } catch {
    entries = []
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    if (profiles.length >= MAX_PROFILES) {
      rejectedCount++
      continue
    }
    const nameBytes = Buffer.byteLength(entry.name)
    const profilePath = path.join(profilesRoot, entry.name)
    const bundles = entry.isDirectory() && !entry.isSymbolicLink()
      && nameBytes > 0 && nameBytes <= MAX_PROFILE_NAME_BYTES
      && ownedDirectory(profilePath)
      && ownedOptionalFile(path.join(profilePath, 'cordis.patch.yml'))
      ? readBundles(path.join(profilePath, 'package.json'))
      : null
    if (!bundles) {
      rejectedCount++
      continue
    }
    profiles.push(Object.freeze({
      id: profileId(resolved.path, entry.name),
      name: entry.name,
      homePath: resolved.path,
      profilePath,
      bundles,
    }))
  }
  profiles.sort((left, right) => left.name === 'web' ? -1 : right.name === 'web' ? 1
    : left.name.localeCompare(right.name, 'en'))
  return Object.freeze({
    homePath: resolved.path,
    homeLabel: resolved.label,
    profiles: Object.freeze(profiles),
    rejectedCount,
  })
}

/** Project the discovery result onto the bounded status-renderer contract. */
export function publicProfileCatalog(catalog: LocalProfileCatalog): PublicProfileCatalog {
  return Object.freeze({
    homeLabel: catalog.homeLabel,
    profiles: Object.freeze(catalog.profiles.map(({ id, name }) => Object.freeze({ id, name }))),
    rejectedCount: catalog.rejectedCount,
  })
}
