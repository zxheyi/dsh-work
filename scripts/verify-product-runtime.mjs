import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { verifySource, verifyPublishedPackage, verifyNodeArchive } from './verify-upstream-candidate.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = file => JSON.parse(fs.readFileSync(path.join(root, file)))
export function verifyProductRuntime({ source, tarball, node, nodeArchive }) {
  const baseline = read('runtime/baseline.json')
  // Reuse the immutable, reviewed archive receipt, not the probe's dependency
  // installation. The active selection remains runtime/baseline.json.
  const artifacts = read('prototypes/m0-runtime-upgrade/runtime-pin.json')
  if (artifacts.node !== baseline.runtime.node) throw new Error('Node receipt does not match baseline')
  const sourceCommit = verifySource(source, baseline.source)
  const packageFiles = verifyPublishedPackage(tarball, fs.realpathSync(path.join(root, 'node_modules/@deepseek-ai/dsh')), baseline.runtime)
  const nodeSHA256 = verifyNodeArchive(nodeArchive, node, artifacts)
  const family = new Set()
  for (const entry of fs.readdirSync(path.join(root, 'node_modules/.pnpm'))) {
    const scope = path.join(root, 'node_modules/.pnpm', entry, 'node_modules/@deepseek-ai')
    if (!fs.existsSync(scope)) continue
    for (const name of fs.readdirSync(scope).filter(name => name === 'dsh' || name.startsWith('dsh-'))) {
      const manifest = JSON.parse(fs.readFileSync(path.join(scope, name, 'package.json')))
      if (manifest.version !== baseline.runtime.version) throw new Error('product DSH family mismatch')
      family.add(manifest.name)
    }
  }
  if (family.size < 215) throw new Error('product DSH closure missing')
  const lock = fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))
  if (!lock.toString().includes(baseline.runtime.integrity)) throw new Error('product lock integrity missing')
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
