import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { verifySource, verifyPublishedPackage, verifyNodeArchive } from './verify-upstream-candidate.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = file => JSON.parse(fs.readFileSync(path.join(root, file)))
class ProductRuntimeVerificationError extends Error {
  constructor(code) {
    super('Product runtime provenance check failed')
    this.code = code
  }
}
const checked = (code, action, allowed = new Set()) => {
  try { return action() } catch (error) {
    throw new ProductRuntimeVerificationError(allowed.has(error?.code) ? error.code : code)
  }
}
export const productRuntimeFailureCode = error =>
  error instanceof ProductRuntimeVerificationError ? error.code : 'product-provenance-failed'

export function verifyProductRuntime({ source, tarball, node, nodeArchive }) {
  const baseline = checked('configuration-provenance-failed', () => read('runtime/baseline.json'))
  // Reuse the immutable, reviewed archive receipt, not the probe's dependency
  // installation. The active selection remains runtime/baseline.json.
  const artifacts = checked('configuration-provenance-failed', () => {
    const value = read('prototypes/m0-runtime-upgrade/runtime-pin.json')
    if (value.node !== baseline.runtime.node) throw new Error('mismatch')
    return value
  })
  const sourceCommit = checked('source-provenance-failed', () => verifySource(source, baseline.source))
  const packageCodes = new Set(['package-archive-failed', 'package-metadata-failed',
    'package-inventory-failed', 'package-bytes-failed'])
  const packageFiles = checked('package-provenance-failed', () => verifyPublishedPackage(
    tarball, fs.realpathSync(path.join(root, 'node_modules/@deepseek-ai/dsh')), baseline.runtime), packageCodes)
  const nodeSHA256 = checked('node-provenance-failed', () => verifyNodeArchive(nodeArchive, node, artifacts))
  const family = checked('family-provenance-failed', () => {
    const found = new Set()
    for (const entry of fs.readdirSync(path.join(root, 'node_modules/.pnpm'))) {
      const scope = path.join(root, 'node_modules/.pnpm', entry, 'node_modules/@deepseek-ai')
      if (!fs.existsSync(scope)) continue
      for (const name of fs.readdirSync(scope).filter(name => name === 'dsh' || name.startsWith('dsh-'))) {
        const manifest = JSON.parse(fs.readFileSync(path.join(scope, name, 'package.json')))
        if (manifest.version !== baseline.runtime.version) throw new Error('mismatch')
        found.add(manifest.name)
      }
    }
    if (found.size < 215) throw new Error('missing')
    return found
  })
  const lock = checked('lock-provenance-failed', () => {
    const bytes = fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))
    if (!bytes.toString().includes(baseline.runtime.integrity)) throw new Error('missing')
    return bytes
  })
  return { sourceCommit, runtime: baseline.runtime.version, packageFiles, node: baseline.runtime.node,
    nodeSHA256, installedDSHPackages: family.size,
    lockfileSHA256: createHash('sha256').update(lock).digest('hex'),
    scope: 'source cleanliness, official root package and Node bytes, DSH family versions; not complete transitive bytes or distribution proof',
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(verifyProductRuntime(JSON.parse(fs.readFileSync(process.argv[2]))), null, 2)) }
  catch { console.error('Product runtime provenance check failed'); process.exitCode = 1 }
}
