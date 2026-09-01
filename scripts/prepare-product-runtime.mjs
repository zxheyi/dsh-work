// Controlled build/verification materialization. Never invoked by ordinary Harness launch.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const baseline = JSON.parse(fs.readFileSync(path.join(root, 'runtime/baseline.json')))
const sourcePin = baseline.source
const runtimePin = baseline.runtime
const artifact = runtimePin.nodeArtifacts[`${process.platform}-${process.arch}`]
if (!artifact) throw new Error('No accepted Node artifact for this native platform')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-runtime-'))
const digest = (bytes, algorithm, format) => createHash(algorithm).update(bytes).digest(format)
async function download(url, target, algorithm, expected, format = 'hex') {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) })
  if (!response.ok) throw new Error(`official artifact download failed: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (digest(bytes, algorithm, format) !== expected) throw new Error('official artifact integrity mismatch')
  fs.writeFileSync(target, bytes)
}

const nodeArchive = path.join(directory, artifact.filename)
const tarball = path.join(directory, 'dsh.tgz')
await download(`https://nodejs.org/dist/v${runtimePin.node}/${artifact.filename}`, nodeArchive, 'sha256', artifact.sha256)
await download(runtimePin.tarball, tarball, 'sha512', runtimePin.integrity.slice('sha512-'.length), 'base64')
execFileSync('tar', ['-xf', nodeArchive, '-C', directory], { timeout: 60_000 })
const extractedRoot = path.join(directory, artifact.filename.replace(/\.tar\.gz$|\.zip$/, ''))
const node = path.join(extractedRoot, process.platform === 'win32' ? 'node.exe' : 'bin/node')
const source = path.join(directory, 'upstream')
execFileSync('git', ['clone', '--depth', '1', '--branch', sourcePin.tag, sourcePin.repository, source], {
  timeout: 180_000, stdio: ['ignore', 'pipe', 'pipe'],
})
const artifacts = path.join(root, 'artifacts/runtime')
fs.mkdirSync(artifacts, { recursive: true })
fs.writeFileSync(path.join(artifacts, 'context.json'), JSON.stringify({ source, tarball, node, nodeArchive }, null, 2))
console.log('Product runtime artifacts materialized. Run pnpm runtime:verify next.')
