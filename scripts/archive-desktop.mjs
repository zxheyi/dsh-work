import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { inventoryPackages } from './distribution-notices.mjs'
import { verifyNativeMaterials } from './native-distribution.mjs'
import { bundleSHA256 } from './bundle-digest.mjs'

const root = path.resolve(import.meta.dirname, '..')
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const requireEvidence = (condition, message) => { if (!condition) throw new Error(message) }
const nativePackage = item => item.name.startsWith('@img/sharp-libvips-') || item.name.startsWith('@img/sharp-win32-')
const validVersion = version => /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/u.test(version)

export function validateCandidateEvidence({ current, receipt, smoke, inventory, replacement, bundledManifest }) {
  requireEvidence(current.clean, 'candidate archive requires a clean tracked checkout')
  requireEvidence(['darwin-arm64', 'win32-x64'].includes(`${current.platform}-${current.arch}`), 'unsupported native archive platform')
  requireEvidence(receipt?.schema === 'dsh-work.desktop-package.v1', 'desktop package receipt is missing or unsupported')
  for (const field of ['revision', 'version', 'platform', 'arch', 'lockfileSHA256']) {
    requireEvidence(receipt[field] === current[field], `package ${field} does not match current checkout/runner`)
  }
  requireEvidence(validVersion(current.version), 'invalid archive version')
  requireEvidence(bundledManifest?.version === current.version, 'bundled application version does not match package receipt')
  requireEvidence(['unsigned-internal-test', 'developer-id-notarized'].includes(receipt.distribution), 'unrecognized package distribution')
  requireEvidence(smoke?.status === 'pass' && smoke.relocated === true && smoke.launches === 2
    && smoke.cleanShutdown === true && smoke.developerNodeIgnored === true, 'successful relocated two-launch clean smoke is required')
  requireEvidence(/^[a-f0-9]{64}$/u.test(smoke.bundleSHA256) && smoke.bundleSHA256 === current.bundleSHA256, 'smoke bundle digest does not match current bundle bytes')
  for (const field of ['revision', 'platform', 'arch', 'distribution']) {
    requireEvidence(smoke[field] === receipt[field], `smoke ${field} does not match package receipt`)
  }
  requireEvidence(inventory?.schema === 'dsh-work.distribution-notices.v1', 'distribution inventory is missing or unsupported')
  requireEvidence(Array.isArray(inventory.blockers) && inventory.blockers.length === 0, 'distribution inventory has blockers')
  for (const field of ['platform', 'arch', 'lockfileSHA256']) {
    requireEvidence(inventory[field] === current[field], `inventory ${field} does not match current checkout/runner`)
  }
  const native = inventory.packages?.filter(nativePackage) ?? []
  const expectedName = current.platform === 'darwin' ? '@img/sharp-libvips-darwin-arm64' : '@img/sharp-win32-x64'
  requireEvidence(native.length === 1 && native[0].name === expectedName, 'complete native package coverage is required')
  for (const item of inventory.packages) requireEvidence(item.notices?.length > 0, `distribution notice missing: ${item.name}`)
  requireEvidence(native[0].nativeMaterials?.length > 0 && native[0].nativeBinaries?.length > 0, 'native material/binary evidence is missing')
  requireEvidence(replacement?.platform === current.platform && replacement?.arch === current.arch, 'native replacement evidence is missing or belongs to another runner')
  const libraries = native[0].nativeBinaries.filter(item => /\.(?:dylib|dll)$/u.test(item.file))
  requireEvidence(libraries.length > 0 && replacement.replacements?.length === libraries.length, 'native replacement library coverage is incomplete')
  for (const binary of libraries) {
    const replaced = replacement.replacements.find(item => item.file === path.basename(binary.file))
    requireEvidence(replaced?.before === binary.sha256 && /^[a-f0-9]{64}$/u.test(replaced.after)
      && replaced.after !== replaced.before, `native replacement digest evidence is invalid: ${binary.file}`)
  }
  const loadedVersion = replacement.result?.version
  requireEvidence(loadedVersion?.semver === native[0].nativeComponents?.vips
    && loadedVersion?.isGlobal === false && loadedVersion?.isWasm === false
    && replacement.result?.formats?.length > 0, 'native replacement did not prove matching libvips availability')
}

const containedPath = (directory, relative) => {
  requireEvidence(typeof relative === 'string' && !path.isAbsolute(relative), 'relative bundle/material path required')
  const result = path.resolve(directory, relative)
  requireEvidence(result.startsWith(`${path.resolve(directory)}${path.sep}`), 'bundle/material path escapes its root')
  requireEvidence(fs.realpathSync(result).startsWith(`${fs.realpathSync(directory)}${path.sep}`), 'bundle/material symlink escapes its root')
  return result
}

export function verifyBundledDistribution({ application, resources, inventory, materialLock, materialLockPath }) {
  const identity = packages => packages.map(item => `${item.name}@${item.version}:${item.path}`).sort()
  requireEvidence(JSON.stringify(identity(inventoryPackages(application))) === JSON.stringify(identity(inventory.packages)), 'bundled package inventory does not match actual dependencies')
  const thirdParty = path.join(resources, 'third-party')
  requireEvidence(sha(fs.readFileSync(path.join(thirdParty, 'native/materials.json'))) === sha(fs.readFileSync(materialLockPath)), 'bundled native material lock does not match current checkout')
  for (const file of ['LICENSE.dsh-work.txt', 'runtime/node/LICENSE', 'third-party/electron-LICENSE', 'third-party/electron-LICENSES.chromium.html']) {
    requireEvidence(fs.statSync(containedPath(resources, file)).size > 0, `bundled license text is empty: ${file}`)
  }
  for (const item of inventory.packages) {
    for (const notice of item.notices) {
      requireEvidence(sha(fs.readFileSync(containedPath(thirdParty, notice.file))) === notice.sha256, `bundled notice digest mismatch: ${notice.file}`)
    }
    if (!nativePackage(item)) continue
    const selected = materialLock.packages[`${item.name}@${item.version}`]
    requireEvidence(selected, `unreviewed bundled native package: ${item.name}@${item.version}`)
    const materials = selected.materials.map(id => {
      const material = materialLock.materials.find(value => value.id === id)
      requireEvidence(material, `missing locked native material: ${id}`)
      return material
    })
    const listed = materials.map(({ id, file, sha256, url, kind }) => ({ id, file: `native/${file}`, sha256, source: url, kind }))
    requireEvidence(JSON.stringify(item.nativeMaterials) === JSON.stringify(listed)
      && JSON.stringify(item.nativeBinaries) === JSON.stringify(selected.binaries), 'bundled native inventory differs from locked material/binary coverage')
    const errors = verifyNativeMaterials(item, { ...selected, materials }, containedPath(application, item.path), path.join(thirdParty, 'native'))
    requireEvidence(errors.length === 0, `bundled native materials failed verification: ${errors.slice(0, 5).join('; ')}`)
  }
}

export function writeCandidateArchive(bundle, archive, platform) {
  requireEvidence(platform === process.platform && ['darwin', 'win32'].includes(platform), 'archive must be created on its native platform')
  // Native bsdtar includes hidden files. macOS tar preserves executable modes and symlinks.
  const flags = platform === 'darwin' ? ['-czf'] : ['-a', '-cf']
  execFileSync('tar', [...flags, archive, '-C', path.dirname(bundle), path.basename(bundle)], {
    stdio: 'inherit', env: { ...process.env, COPYFILE_DISABLE: '1' },
  })
}

async function fileSHA256(file) {
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

export async function archiveDesktop({ projectRoot = root } = {}) {
  const version = read(path.join(projectRoot, 'package.json')).version
  requireEvidence(validVersion(version) && ['darwin-arm64', 'win32-x64'].includes(`${process.platform}-${process.arch}`), 'invalid candidate version/native platform')
  const output = path.join(projectRoot, 'artifacts/release')
  fs.mkdirSync(output, { recursive: true })
  const stem = `DSH-Work-${version}-${process.platform}-${process.arch}`
  const archive = path.join(output, `${stem}.${process.platform === 'darwin' ? 'tar.gz' : 'zip'}`)
  const archiveReceiptPath = path.join(output, `${stem}.receipt.json`)
  const checksumPath = path.join(output, `${stem}.sha256`)
  // Invalidate completion before even reading evidence: failed reruns must not
  // leave a previous candidate looking like the result of the current attempt.
  for (const file of [archiveReceiptPath, checksumPath, archive]) fs.rmSync(file, { force: true })
  const packageRoot = path.join(projectRoot, 'artifacts/package')
  const receiptPath = path.join(packageRoot, 'receipt.json')
  const smokePath = path.join(packageRoot, 'smoke.json')
  const receipt = read(receiptPath)
  const bundle = containedPath(projectRoot, receipt.bundle)
  requireEvidence(bundle.startsWith(`${path.join(packageRoot, 'bundles')}${path.sep}`), 'package receipt must reference a generated bundle')
  const resources = path.join(bundle, process.platform === 'darwin' ? 'DSH Work.app/Contents/Resources' : 'resources')
  const application = path.join(resources, 'app')
  const inventoryPath = path.join(resources, 'third-party/inventory.json')
  const replacementPath = path.join(resources, 'third-party/native-replacement-smoke.json')
  const materialLockPath = path.join(projectRoot, 'third-party/native-materials.json')
  const current = {
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim(),
    version, platform: process.platform, arch: process.arch, bundleSHA256: await bundleSHA256(bundle),
    lockfileSHA256: sha(fs.readFileSync(path.join(projectRoot, 'pnpm-lock.yaml'))),
    clean: execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: projectRoot, encoding: 'utf8' }).trim() === '',
  }
  const smoke = read(smokePath)
  const inventory = read(inventoryPath)
  const replacement = read(replacementPath)
  validateCandidateEvidence({ current, receipt, smoke, inventory, replacement, bundledManifest: read(path.join(application, 'package.json')) })
  verifyBundledDistribution({ application, resources, inventory, materialLock: read(materialLockPath), materialLockPath })
  writeCandidateArchive(bundle, archive, current.platform)
  requireEvidence(await bundleSHA256(bundle) === current.bundleSHA256, 'bundle changed while creating candidate archive')
  const archiveSHA256 = await fileSHA256(archive)
  const archiveReceipt = {
    schema: 'dsh-work.desktop-candidate-archive.v1', revision: current.revision, version: current.version,
    platform: current.platform, arch: current.arch, distribution: receipt.distribution,
    publication: 'draft-only-pending-human-acceptance',
    archive: { file: path.basename(archive), rootDirectory: path.basename(bundle), bytes: fs.statSync(archive).size, sha256: archiveSHA256, bundleSHA256: current.bundleSHA256 },
    package: receipt, smoke, replacement,
    evidenceSHA256: Object.fromEntries([
      ['packageReceipt', receiptPath], ['smoke', smokePath], ['inventory', inventoryPath],
      ['nativeReplacement', replacementPath], ['nativeMaterialLock', materialLockPath],
    ].map(([name, file]) => [name, sha(fs.readFileSync(file))])),
  }
  fs.writeFileSync(archiveReceiptPath, `${JSON.stringify(archiveReceipt, null, 2)}\n`)
  fs.writeFileSync(checksumPath, `${archiveSHA256}  ${path.basename(archive)}\n${await fileSHA256(archiveReceiptPath)}  ${path.basename(archiveReceiptPath)}\n`)
  console.log(`Verified draft candidate archive: ${path.relative(projectRoot, archive)}`)
  return archiveReceipt
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await archiveDesktop()
