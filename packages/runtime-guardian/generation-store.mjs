import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const SCHEMA = 'dsh-work.runtime-generation.v1'
const safeGeneration = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value)
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
const validActive = value => exactKeys(value,
  ['schema', 'generation', 'guardianPid', 'runtime', 'state', 'claimedAt']) &&
  value.schema === SCHEMA && safeGeneration(value.generation) &&
  Number.isSafeInteger(value.guardianPid) && value.guardianPid > 0 &&
  value.runtime === '0.1.2-alpha.2' && value.state === 'claimed' && validTime(value.claimedAt)
const validTerminal = value => exactKeys(value, ['schema', 'generation', 'status', 'confirmedAt']) &&
  value.schema === SCHEMA && safeGeneration(value.generation) && value.status === 'clean' && validTime(value.confirmedAt)
const validClean = value => exactKeys(value, ['schema', 'generation', 'confirmedAt']) &&
  value.schema === SCHEMA && safeGeneration(value.generation) && validTime(value.confirmedAt)

function writeExclusive(file, value) {
  const descriptor = fs.openSync(file, 'wx', 0o600)
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`)
    fs.fsyncSync(descriptor)
  } finally { fs.closeSync(descriptor) }
}

function writeAtomic(file, value) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function ensureOwnedDirectory(directory) {
  try {
    const value = fs.lstatSync(directory)
    if (!value.isDirectory() || value.isSymbolicLink()) throw new Error('runtime path must be an owned directory')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    fs.mkdirSync(directory, { mode: 0o700 })
  }
}

function isOwnedDirectory(directory) {
  try {
    const value = fs.lstatSync(directory)
    return value.isDirectory() && !value.isSymbolicLink()
  } catch { return false }
}

export function createGenerationStore(productRoot, {
  pid = process.pid,
  id = randomUUID,
  now = () => new Date().toISOString(),
} = {}) {
  if (!path.isAbsolute(productRoot)) throw new Error('absolute product root required')
  const runtime = path.join(productRoot, 'runtime')
  const generations = path.join(runtime, 'generations')
  const quarantine = path.join(runtime, 'quarantine')
  const history = path.join(runtime, 'history')
  const activePath = path.join(runtime, 'active.json')
  const lastCleanPath = path.join(runtime, 'last-clean.json')
  if (!fs.existsSync(productRoot)) fs.mkdirSync(productRoot, { recursive: true, mode: 0o700 })
  for (const directory of [productRoot, runtime, generations, quarantine, history]) ensureOwnedDirectory(directory)

  const homeFor = generation => {
    if (!safeGeneration(generation)) throw new Error('invalid generation')
    return path.join(generations, generation)
  }
  const active = () => readJSON(activePath)
  const terminalPath = generation => path.join(homeFor(generation), 'dsh-work-terminal.json')
  const record = generation => ({ schema: SCHEMA, generation, guardianPid: pid,
    runtime: '0.1.2-alpha.2', state: 'claimed', claimedAt: now() })
  const claimGeneration = generation => {
    const home = homeFor(generation)
    try { writeExclusive(activePath, record(generation)) } catch (error) {
      if (error?.code === 'EEXIST') return { status: 'blocked', code: 'recovery-required' }
      throw error
    }
    fs.mkdirSync(home, { recursive: true, mode: 0o700 })
    if (!isOwnedDirectory(home)) throw new Error('generation path must be an owned directory')
    return { status: 'claimed', generation, home }
  }
  const archive = (source, directory, generation = 'unknown') => {
    const safe = safeGeneration(generation) ? generation : 'unknown'
    const target = path.join(directory, `${Date.parse(now()) || 0}-${safe}-${randomUUID()}.json`)
    fs.renameSync(source, target)
    return target
  }
  const reconcileClean = value => {
    if (!validActive(value)) return null
    if (!isOwnedDirectory(homeFor(value.generation))) return null
    const terminal = readJSON(terminalPath(value.generation))
    if (!validTerminal(terminal) || terminal.generation !== value.generation) return null
    archive(activePath, history, value.generation)
    fs.unlinkSync(terminalPath(value.generation))
    writeAtomic(lastCleanPath, { schema: SCHEMA, generation: value.generation, confirmedAt: terminal.confirmedAt })
    return value.generation
  }

  return Object.freeze({
    paths: Object.freeze({ runtime, active: activePath, lastClean: lastCleanPath, generations, quarantine }),
    inspect() { return active() },
    claim() {
      if (fs.existsSync(activePath)) {
        const generation = reconcileClean(active())
        if (!generation) return { status: 'blocked', code: 'recovery-required' }
        return claimGeneration(generation)
      }
      const clean = readJSON(lastCleanPath)
      const generation = validClean(clean) &&
        isOwnedDirectory(homeFor(clean.generation)) ? clean.generation : id()
      return claimGeneration(generation)
    },
    recover() {
      if (fs.existsSync(activePath)) archive(activePath, quarantine, active()?.generation)
      const generation = id()
      return claimGeneration(generation)
    },
    releaseClean(generation) {
      const value = active()
      if (!validActive(value) || value.generation !== generation) return false
      if (!isOwnedDirectory(homeFor(generation))) return false
      writeAtomic(terminalPath(generation), { schema: SCHEMA, generation, status: 'clean', confirmedAt: now() })
      return true
    },
  })
}
