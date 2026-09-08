import fs from 'node:fs'
import path from 'node:path'

import { prepareProductProfile } from '../runtime-host/official-launcher.ts'
import type { DiscoveredLocalProfile } from './discovery.ts'

const MAX_PATCH_BYTES = 256 * 1024
const MAX_DEPENDENCIES = 64
const PRODUCT_BUNDLES = ['@dsh-work/work', '@dsh-work/lifecycle'] as const
const CORE_BUNDLES = new Set(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u

export interface PreparedRuntimeProfile {
  readonly home: string
  readonly profile: 'dsh-work'
  readonly patches: readonly string[]
  readonly sourceId?: string
}

const ownedDirectory = (value: string): boolean => {
  try {
    const stat = fs.lstatSync(value)
    return stat.isDirectory() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

const readOwnedFile = (value: string, maxBytes: number, optional = false): Buffer | null => {
  try {
    const stat = fs.lstatSync(value)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw new Error('source Profile changed')
    return fs.readFileSync(value)
  } catch (error: unknown) {
    if (optional && error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null
    if (error instanceof Error && error.message === 'source Profile changed') throw error
    throw new Error('source Profile changed')
  }
}

const packageParts = (name: string): readonly string[] => name.startsWith('@') ? name.split('/') : [name]

const readManifest = (source: DiscoveredLocalProfile): {
  readonly dependencies: Readonly<Record<string, string>>
  readonly peerDependencies: Readonly<Record<string, string>>
} => {
  const bytes = readOwnedFile(path.join(source.profilePath, 'package.json'), 64 * 1024)
  if (!bytes) throw new Error('source Profile changed')
  let value: unknown
  try { value = JSON.parse(bytes.toString('utf8')) as unknown } catch { throw new Error('source Profile changed') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('source Profile changed')
  const asDependencies = (candidate: unknown): Readonly<Record<string, string>> => {
    if (candidate === undefined) return Object.freeze({})
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('source Profile changed')
    const entries = Object.entries(candidate)
    if (entries.length > MAX_DEPENDENCIES || entries.some(([name, version]) =>
      !PACKAGE_NAME.test(name) || typeof version !== 'string' || version.length > 256)) {
      throw new Error('source Profile changed')
    }
    return Object.freeze(Object.fromEntries(entries))
  }
  const record = value as Record<string, unknown>
  return {
    dependencies: asDependencies(record.dependencies),
    peerDependencies: asDependencies(record.peerDependencies),
  }
}

const resolveSourcePackage = (source: DiscoveredLocalProfile, packageName: string): string => {
  if (!PACKAGE_NAME.test(packageName)) throw new Error('source Profile changed')
  const candidates = [
    path.join(source.profilePath, 'node_modules', ...packageParts(packageName)),
    path.join(source.homePath, 'profiles', 'node_modules', ...packageParts(packageName)),
  ]
  for (const candidate of candidates) {
    try {
      const resolved = fs.realpathSync(candidate)
      if (!ownedDirectory(resolved)) continue
      const manifest = readOwnedFile(path.join(resolved, 'package.json'), 64 * 1024)
      if (!manifest) continue
      const value = JSON.parse(manifest.toString('utf8')) as { name?: unknown }
      if (value.name === packageName) return resolved
    } catch {}
  }
  throw new Error(`source Profile dependency unavailable: ${packageName}`)
}

const linkSourcePackage = (profile: string, source: DiscoveredLocalProfile, packageName: string): void => {
  const destination = path.join(profile, 'node_modules', ...packageParts(packageName))
  if (fs.existsSync(destination)) return
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 })
  fs.symlinkSync(resolveSourcePackage(source, packageName), destination, 'junction')
}

/** Preserve the native user-root lookup and all Profile-owned preset configuration. */
function linkSharedPresets(generationHome: string, sourceHome: string): void {
  const source = path.join(sourceHome, '.agent-presets')
  const destination = path.join(generationHome, '.agent-presets')
  // Do not replace a previous generation's authored presets or a different mapping.
  try {
    const existing = fs.lstatSync(destination)
    if (!existing.isSymbolicLink()
      || path.resolve(path.dirname(destination), fs.readlinkSync(destination)) !== source) {
      throw new Error('shared preset directory conflict')
    }
  } catch (error: unknown) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
  }
  // An absent user root is normal. Create only this directory, never the source Profile.
  // A dangling junction would let listing appear empty but break native copy/create.
  if (!fs.existsSync(source)) fs.mkdirSync(source, { mode: 0o700 })
  if (!fs.statSync(source).isDirectory()) throw new Error('shared preset root is not a directory')
  try { fs.lstatSync(destination) } catch (error: unknown) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
    fs.symlinkSync(source, destination, 'junction')
  }
}

/** Build a product-owned profile shadow while keeping the admitted source Profile byte-clean. */
export function prepareShadowProfile(
  generationHome: string,
  source: DiscoveredLocalProfile,
): PreparedRuntimeProfile {
  if (!path.isAbsolute(generationHome) || !ownedDirectory(source.homePath)
    || !ownedDirectory(source.profilePath)
    || path.dirname(source.profilePath) !== path.join(source.homePath, 'profiles')) {
    throw new Error('source Profile changed')
  }
  const manifest = readManifest(source)
  const sourcePatch = readOwnedFile(path.join(source.profilePath, 'cordis.patch.yml'), MAX_PATCH_BYTES, true)
  prepareProductProfile(generationHome)
  linkSharedPresets(generationHome, source.homePath)
  const profile = path.join(generationHome, 'profiles', 'dsh-work')
  const thirdPartyBundles = source.bundles.filter(bundle => !CORE_BUNDLES.has(bundle))
  const packages = new Set([
    ...Object.keys(manifest.dependencies),
    ...Object.keys(manifest.peerDependencies),
    ...thirdPartyBundles,
  ])
  for (const packageName of packages) linkSourcePackage(profile, source, packageName)

  fs.writeFileSync(path.join(profile, 'package.json'), `${JSON.stringify({
    private: true,
    type: 'module',
    dependencies: manifest.dependencies,
    peerDependencies: manifest.peerDependencies,
    dsh: { profile: {
      bundles: [...source.bundles, ...PRODUCT_BUNDLES],
      patchReload: 'startup',
    } },
  }, null, 2)}\n`, { mode: 0o600 })
  fs.writeFileSync(path.join(profile, 'cordis.patch.yml'), sourcePatch ?? Buffer.from('[]\n'), { mode: 0o600 })

  const overlayPath = path.join(generationHome, 'dsh-work-shared-data.patch.json')
  const overlay = [
    { id: 'settings', config: { path: path.join(source.homePath, 'settings.yaml') } },
    { id: 'credentials', config: { path: path.join(source.homePath, '.credentials.yaml') } },
    { id: 'session-persistence-jsonl', config: { root: path.join(source.homePath, 'sessions') } },
    { id: 'attachment-local', config: { dshHome: source.homePath } },
    { id: 'storage-json', config: { root: path.join(source.homePath, 'storages') } },
    { id: 'web-runtime', config: {
      openBrowser: false,
      printUrl: false,
      surfaceContext: true,
      trustedHosts: [],
    } },
  ]
  fs.writeFileSync(overlayPath, `${JSON.stringify(overlay, null, 2)}\n`, { mode: 0o600 })
  return Object.freeze({
    home: generationHome,
    profile: 'dsh-work',
    patches: Object.freeze([overlayPath]),
    sourceId: source.id,
  })
}
