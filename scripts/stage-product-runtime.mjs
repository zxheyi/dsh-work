import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { verifyProductRuntime } from './verify-product-runtime.mjs'

const SCHEMA = 'dsh-work.packaged-runtime.v1'

function nodeTree(node) {
  if (!path.isAbsolute(node)) throw new Error('absolute verified Node path required')
  const executable = fs.lstatSync(node)
  if (!executable.isFile() || executable.isSymbolicLink()) throw new Error('verified Node executable unavailable')
  return path.basename(node).toLowerCase() === 'node.exe'
    ? path.dirname(node)
    : path.dirname(path.dirname(node))
}

export function stageProductRuntime(context, destination, verify = verifyProductRuntime) {
  if (!path.isAbsolute(destination) || destination === path.parse(destination).root) {
    throw new Error('safe absolute product resources path required')
  }
  const evidence = verify(context)
  const source = nodeTree(context.node)
  const runtime = path.join(destination, 'runtime')
  const target = path.join(runtime, 'node')
  const manifest = Object.freeze({
    schema: SCHEMA,
    runtime: evidence.runtime,
    node: evidence.node,
    nodeArchiveSHA256: evidence.nodeSHA256,
  })
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 })
  fs.rmSync(runtime, { recursive: true, force: true })
  fs.mkdirSync(runtime, { recursive: true, mode: 0o700 })
  // Keep npm/npx and their relative links available to native terminal tools.
  // Headers and manuals are build/development material, not runtime inputs.
  fs.cpSync(source, target, { recursive: true, verbatimSymlinks: true,
    filter: file => !['include', 'share'].includes(path.relative(source, file).split(path.sep)[0]),
  })
  fs.writeFileSync(path.join(runtime, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
  return manifest
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const contextPath = process.argv[2]
  const destination = process.argv[3]
  if (!contextPath || !destination) throw new Error('runtime context and destination required')
  const context = JSON.parse(fs.readFileSync(path.resolve(contextPath), 'utf8'))
  const manifest = stageProductRuntime(context, path.resolve(destination))
  console.log(JSON.stringify(manifest, null, 2))
}
