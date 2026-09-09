import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
const root = path.resolve(import.meta.dirname, '..')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const cache = path.join(root, 'artifacts/native-sources')
const lockPath = path.join(root, 'third-party/native-materials.json')
const safePath = (base, file) => {
  if (typeof file !== 'string' || !/^[A-Za-z0-9._+/-]+$/u.test(file) || file.includes('\\') || path.isAbsolute(file) || file.split('/').some(part => part === '..' || part === '.')) throw new Error('invalid native material path')
  return path.join(base, file)
}
const verifyFile = (base, item, label) => {
  const file = safePath(base, item.file)
  if (!fs.existsSync(file)) return `missing ${label}: ${item.file}`
  if (!fs.lstatSync(file).isFile()) return `invalid ${label}: ${item.file}`
  return sha(fs.readFileSync(file)) === item.sha256 ? null : `${label} digest mismatch: ${item.file}`
}

export function verifyNativeMaterials(item, record, packageRoot, materialRoot) {
  if (!record) return [`unreviewed native package: ${item.name}@${item.version}`]
  const errors = []
  const canonical = value => JSON.stringify(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b)))
  if (canonical(item.nativeComponents) !== canonical(record.nativeComponents)) errors.push('native component versions mismatch')
  if (!record.binaries?.length || !record.materials?.length) errors.push('empty native binary/material coverage')
  for (const component of new Set([...Object.keys(item.nativeComponents ?? {}), ...Object.keys(record.componentSources ?? {})])) {
    if (!record.materials?.some(material => material.id === record.componentSources?.[component] && material.kind === 'source')) {
      errors.push(`missing corresponding source: ${component}`)
    }
  }
  for (const kind of ['source', 'license', 'build', 'relinking']) {
    if (!record.materials?.some(material => material.kind === kind)) errors.push(`missing material category: ${kind}`)
  }
  const observed = []
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error('native package contains an unreviewed symlink')
      if (entry.isDirectory()) visit(file)
      else if (/\.(?:dll|dylib|node|so)(?:\.[0-9.]+)?$/u.test(entry.name)) observed.push(path.relative(packageRoot, file).split(path.sep).join('/'))
    }
  }
  visit(packageRoot)
  if (JSON.stringify(observed.sort()) !== JSON.stringify((record.binaries ?? []).map(item => item.file).sort())) errors.push('native binary coverage mismatch')
  for (const binary of record.binaries ?? []) {
    const error = verifyFile(packageRoot, binary, 'binary')
    if (error) errors.push(error)
  }
  for (const material of record.materials ?? []) {
    const error = verifyFile(materialRoot, material, 'material')
    if (error) errors.push(error)
  }
  return errors
}

export function retainNativeMaterials(item, application, destination) {
  if (!fs.existsSync(lockPath)) return ['native materials lock is missing']
  const lock = JSON.parse(fs.readFileSync(lockPath))
  const selected = lock.packages[`${item.name}@${item.version}`]
  if (!selected) return [`unreviewed native package: ${item.name}@${item.version}`]
  const materials = selected.materials.map(id => {
    const material = lock.materials.find(value => value.id === id)
    if (!material) throw new Error(`missing locked material: ${id}`)
    return material
  })
  const failures = verifyNativeMaterials(item, { ...selected, materials }, path.join(application, item.path), cache)
  if (failures.length) return failures
  const native = path.join(destination, 'native')
  fs.mkdirSync(native, { recursive: true })
  for (const material of materials) {
    const output = safePath(native, material.file)
    fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.copyFileSync(safePath(cache, material.file), output)
  }
  fs.copyFileSync(lockPath, path.join(native, 'materials.json'))
  item.nativeMaterials = materials.map(({ id, file, sha256, url, kind }) => ({ id, file: `native/${file}`, sha256, source: url, kind }))
  item.nativeBinaries = selected.binaries
  return []
}

export async function prepareNativeMaterials() {
  const lock = JSON.parse(fs.readFileSync(lockPath))
  fs.mkdirSync(cache, { recursive: true })
  const entries = [...lock.materials]
  // Preparation is build-time only. Verification and application startup never download.
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (entries.length) {
      const item = entries.shift()
      if (!verifyFile(cache, item, 'material')) continue
      const target = safePath(cache, item.file)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      let bytes
      if (item.repositoryFile) bytes = fs.readFileSync(safePath(root, item.repositoryFile))
      else {
        if (!item.url?.startsWith('https://')) throw new Error(`HTTPS material URL required: ${item.id}`)
        const response = await fetch(item.url, { signal: AbortSignal.timeout(600_000) })
        if (!response.ok) throw new Error(`material download failed: ${item.id}: HTTP ${response.status}`)
        bytes = Buffer.from(await response.arrayBuffer())
      }
      if (sha(bytes) !== item.sha256) throw new Error(`material digest mismatch: ${item.id}`)
      const temporary = `${target}.partial`
      fs.writeFileSync(temporary, bytes)
      fs.renameSync(temporary, target)
    }
  }))
  console.log(`Verified ${lock.materials.length} locked native source, license and build materials.`)
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await prepareNativeMaterials()
