import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

export function verifySource(directory, pin) {
  const git = (...args) => execFileSync('git', ['-C', directory, ...args], {
    encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
  if (git('remote', 'get-url', 'origin') !== pin.repository) throw new Error('upstream remote mismatch')
  if (git('rev-parse', 'HEAD') !== pin.commit) throw new Error('upstream revision mismatch')
  if (git('rev-parse', `refs/tags/${pin.tag}^{commit}`) !== pin.commit) throw new Error('upstream tag mismatch')
  if (git('status', '--porcelain', '--untracked-files=all', '--ignored')) throw new Error('upstream source is not byte-clean')
  return pin.commit
}

const digest = (bytes, algorithm = 'sha256', format = 'hex') => createHash(algorithm).update(bytes).digest(format)
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const tar = (...args) => execFileSync('tar', args, { timeout: 30_000, maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
const packageFailure = (code, message) => {
  const error = new Error(message)
  error.code = code
  throw error
}
const packageOperation = (code, action) => {
  try { return action() } catch (error) {
    if (String(error?.code).startsWith('package-')) throw error
    return packageFailure(code, 'published package verification unavailable')
  }
}

export function verifyPublishedPackage(tarball, installed, pin) {
  if (`sha512-${digest(packageOperation('package-archive-failed', () => fs.readFileSync(tarball)), 'sha512', 'base64')}` !== pin.integrity) {
    packageFailure('package-archive-failed', 'published package integrity mismatch')
  }
  const manifest = packageOperation('package-metadata-unavailable', () => readJSON(path.join(installed, 'package.json')))
  if (manifest.name !== pin.package || manifest.version !== pin.version || manifest.bin?.dsh !== 'lib/bin.js') {
    packageFailure('package-metadata-mismatch', 'installed runtime name/version mismatch')
  }
  const entries = packageOperation('package-archive-failed', () =>
    tar('-tf', tarball).toString('utf8').trim().split(/\r?\n/).filter(entry => !entry.endsWith('/')))
  const installedEntries = []
  function inventory(directory, prefix = '') {
    for (const name of fs.readdirSync(directory)) {
      // Only a root dependency directory is package-manager-owned, not release
      // payload. Never ignore a nested lib/node_modules or a new package.json.
      if (prefix === '' && name === 'node_modules') continue
      const file = path.join(directory, name)
      const relative = `${prefix}${name}`
      const stat = fs.lstatSync(file)
      if (stat.isSymbolicLink()) packageFailure('package-inventory-failed', 'installed package inventory differs: unexpected symlink')
      if (stat.isDirectory()) inventory(file, `${relative}/`)
      else installedEntries.push(`package/${relative}`)
    }
  }
  packageOperation('package-inventory-failed', () => inventory(installed))
  if (JSON.stringify(installedEntries.sort()) !== JSON.stringify([...entries].sort())) {
    packageFailure('package-inventory-failed', 'installed package inventory differs from official archive')
  }
  for (const entry of entries) {
    if (!entry.startsWith('package/') || entry.includes('..') || entry.includes('\\')) {
      packageFailure('package-archive-failed', 'unsafe package entry')
    }
    const file = path.join(installed, entry.slice('package/'.length))
    const matches = packageOperation('package-bytes-failed', () =>
      fs.existsSync(file) && fs.readFileSync(file).equals(tar('-xOf', tarball, entry)))
    if (!matches) {
      packageFailure('package-bytes-failed', 'installed package differs from official archive')
    }
  }
  if (!entries.includes('package/lib/bin.js')) packageFailure('package-archive-failed', 'published launcher missing')
  return entries.length
}

export function verifyNodeArchive(archive, executable, pin, platform = process.platform, arch = process.arch) {
  const artifact = pin.nodeArtifacts[`${platform}-${arch}`]
  if (!artifact) throw new Error('unsupported Node artifact platform')
  if (digest(fs.readFileSync(archive)) !== artifact.sha256) throw new Error('Node archive integrity mismatch')
  const member = platform === 'win32' ? `node-v${pin.node}-win-${arch}/node.exe` : `node-v${pin.node}-${platform}-${arch}/bin/node`
  if (!fs.readFileSync(executable).equals(tar('-xOf', archive, member))) throw new Error('Node executable differs from official archive')
  if (execFileSync(executable, ['--version'], { encoding: 'utf8', timeout: 10_000 }).trim() !== `v${pin.node}`) {
    throw new Error('Node version mismatch')
  }
  return artifact.sha256
}

export function verifyCandidate({ source, tarball, node, nodeArchive }) {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const probe = path.join(repo, 'prototypes/m0-runtime-upgrade')
  const sourcePin = readJSON(path.join(probe, 'source-pin.json'))
  const runtimePin = readJSON(path.join(probe, 'runtime-pin.json'))
  const commit = verifySource(source, sourcePin)
  if (readJSON(path.join(source, 'apps/cli/package.json')).version !== runtimePin.version) throw new Error('source/runtime version mismatch')
  const require = createRequire(path.join(probe, 'package.json'))
  const installed = path.dirname(require.resolve('@deepseek-ai/dsh/package.json'))
  const packageFiles = verifyPublishedPackage(tarball, installed, runtimePin)
  const nodeSHA256 = verifyNodeArchive(nodeArchive, node, runtimePin)
  const manifest = readJSON(path.join(probe, 'package.json'))
  if (manifest.dependencies['@deepseek-ai/dsh'] !== runtimePin.version || manifest.packageManager !== `pnpm@${runtimePin.pnpm}`) {
    throw new Error('probe dependency contract mismatch')
  }
  const lockfile = fs.readFileSync(path.join(probe, 'pnpm-lock.yaml'))
  if (!lockfile.toString().includes(runtimePin.integrity)) throw new Error('runtime integrity absent from lockfile')
  const family = []
  for (const entry of fs.readdirSync(path.join(probe, 'node_modules/.pnpm'))) {
    const scope = path.join(probe, 'node_modules/.pnpm', entry, 'node_modules/@deepseek-ai')
    if (!fs.existsSync(scope)) continue
    for (const name of fs.readdirSync(scope).filter(name => name === 'dsh' || name.startsWith('dsh-'))) {
      const dependency = readJSON(path.join(scope, name, 'package.json'))
      if (dependency.version !== runtimePin.version) throw new Error('installed DSH family version mismatch')
      family.push(`${dependency.name}@${dependency.version}`)
    }
  }
  if (!family.length) throw new Error('installed DSH family missing')
  return { status: 'candidate', sourceCommit: commit, runtime: runtimePin.version, packageFiles,
    installedDSHPackages: [...new Set(family)].length, node: runtimePin.node,
    nodeSHA256, lockfileSHA256: digest(lockfile),
    scope: 'source cleanliness, root npm archive bytes, Node artifact bytes, installed DSH family versions; not a product release manifest',
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [source, tarball, node, nodeArchive] = process.argv.slice(2)
  if (!source || !tarball || !node || !nodeArchive) {
    console.error('Usage: node scripts/verify-upstream-candidate.mjs SOURCE NPM_TARBALL NODE NODE_ARCHIVE')
    process.exitCode = 1
  } else {
    try { console.log(JSON.stringify(verifyCandidate({ source, tarball, node, nodeArchive }), null, 2)) }
    catch (error) { console.error(`Candidate verification failed: ${error.message}`); process.exitCode = 1 }
  }
}
