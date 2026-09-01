import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const SCHEMA = 'dsh-work.runtime-generation.v1' as const

interface ActiveGeneration {
  readonly schema: typeof SCHEMA
  readonly generation: string
  readonly guardianPid: number
  readonly runtime: '0.1.2-alpha.2'
  readonly state: 'claimed'
  readonly claimedAt: string
}

interface TerminalGeneration {
  readonly schema: typeof SCHEMA
  readonly generation: string
  readonly status: 'clean'
  readonly confirmedAt: string
}

interface CleanGeneration {
  readonly schema: typeof SCHEMA
  readonly generation: string
  readonly confirmedAt: string
}

export interface ClaimedGeneration {
  readonly status: 'claimed'
  readonly generation: string
  readonly home: string
}

export interface BlockedGeneration {
  readonly status: 'blocked'
  readonly code: 'recovery-required'
}

export type GenerationSelection = ClaimedGeneration | BlockedGeneration

export interface GenerationStore {
  readonly paths: Readonly<{
    runtime: string
    active: string
    lastClean: string
    generations: string
    quarantine: string
  }>
  inspect(): unknown
  claim(): GenerationSelection
  recover(): GenerationSelection
  releaseClean(generation: string): boolean
}

interface GenerationStoreOptions {
  readonly pid?: number
  readonly id?: () => string
  readonly now?: () => string
}

const safeGeneration = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value)

const exactKeys = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())

const validTime = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value))

const validActive = (value: unknown): value is ActiveGeneration =>
  exactKeys(value, ['schema', 'generation', 'guardianPid', 'runtime', 'state', 'claimedAt']) &&
  value.schema === SCHEMA && safeGeneration(value.generation) &&
  typeof value.guardianPid === 'number' && Number.isSafeInteger(value.guardianPid) && value.guardianPid > 0 &&
  value.runtime === '0.1.2-alpha.2' && value.state === 'claimed' && validTime(value.claimedAt)

const validTerminal = (value: unknown): value is TerminalGeneration =>
  exactKeys(value, ['schema', 'generation', 'status', 'confirmedAt']) &&
  value.schema === SCHEMA && safeGeneration(value.generation) && value.status === 'clean' &&
  validTime(value.confirmedAt)

const validClean = (value: unknown): value is CleanGeneration =>
  exactKeys(value, ['schema', 'generation', 'confirmedAt']) &&
  value.schema === SCHEMA && safeGeneration(value.generation) && validTime(value.confirmedAt)

const isErrorCode = (error: unknown, code: string): boolean =>
  !!error && typeof error === 'object' && 'code' in error && error.code === code

function writeExclusive(file: string, value: unknown): void {
  const descriptor = fs.openSync(file, 'wx', 0o600)
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`)
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
}

function writeAtomic(file: string, value: unknown): void {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

function readJSON(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
  } catch {
    return null
  }
}

function ensureOwnedDirectory(directory: string): void {
  try {
    const value = fs.lstatSync(directory)
    if (!value.isDirectory() || value.isSymbolicLink()) throw new Error('runtime path must be an owned directory')
  } catch (error: unknown) {
    if (!isErrorCode(error, 'ENOENT')) throw error
    fs.mkdirSync(directory, { mode: 0o700 })
  }
}

function isOwnedDirectory(directory: string): boolean {
  try {
    const value = fs.lstatSync(directory)
    return value.isDirectory() && !value.isSymbolicLink()
  } catch {
    return false
  }
}

export function createGenerationStore(
  productRoot: string,
  { pid = process.pid, id = randomUUID, now = () => new Date().toISOString() }: GenerationStoreOptions = {},
): GenerationStore {
  if (!path.isAbsolute(productRoot)) throw new Error('absolute product root required')
  const runtime = path.join(productRoot, 'runtime')
  const generations = path.join(runtime, 'generations')
  const quarantine = path.join(runtime, 'quarantine')
  const history = path.join(runtime, 'history')
  const activePath = path.join(runtime, 'active.json')
  const lastCleanPath = path.join(runtime, 'last-clean.json')
  if (!fs.existsSync(productRoot)) fs.mkdirSync(productRoot, { recursive: true, mode: 0o700 })
  for (const directory of [productRoot, runtime, generations, quarantine, history]) ensureOwnedDirectory(directory)

  const homeFor = (generation: string): string => {
    if (!safeGeneration(generation)) throw new Error('invalid generation')
    return path.join(generations, generation)
  }
  const active = (): unknown => readJSON(activePath)
  const terminalPath = (generation: string): string => path.join(homeFor(generation), 'dsh-work-terminal.json')
  const record = (generation: string): ActiveGeneration => ({
    schema: SCHEMA,
    generation,
    guardianPid: pid,
    runtime: '0.1.2-alpha.2',
    state: 'claimed',
    claimedAt: now(),
  })
  const claimGeneration = (generation: string): GenerationSelection => {
    const home = homeFor(generation)
    try {
      writeExclusive(activePath, record(generation))
    } catch (error: unknown) {
      if (isErrorCode(error, 'EEXIST')) return { status: 'blocked', code: 'recovery-required' }
      throw error
    }
    fs.mkdirSync(home, { recursive: true, mode: 0o700 })
    if (!isOwnedDirectory(home)) throw new Error('generation path must be an owned directory')
    return { status: 'claimed', generation, home }
  }
  const archive = (source: string, directory: string, generation: unknown = 'unknown'): string => {
    const safe = safeGeneration(generation) ? generation : 'unknown'
    const target = path.join(directory, `${Date.parse(now()) || 0}-${safe}-${randomUUID()}.json`)
    fs.renameSync(source, target)
    return target
  }
  const reconcileClean = (value: unknown): string | null => {
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
    inspect(): unknown {
      return active()
    },
    claim(): GenerationSelection {
      if (fs.existsSync(activePath)) {
        const generation = reconcileClean(active())
        if (!generation) return { status: 'blocked', code: 'recovery-required' }
        return claimGeneration(generation)
      }
      const clean = readJSON(lastCleanPath)
      const generation = validClean(clean) && isOwnedDirectory(homeFor(clean.generation)) ? clean.generation : id()
      return claimGeneration(generation)
    },
    recover(): GenerationSelection {
      if (fs.existsSync(activePath)) {
        const value = active()
        archive(activePath, quarantine, validActive(value) ? value.generation : 'unknown')
      }
      return claimGeneration(id())
    },
    releaseClean(generation: string): boolean {
      const value = active()
      if (!validActive(value) || value.generation !== generation) return false
      if (!isOwnedDirectory(homeFor(generation))) return false
      writeAtomic(terminalPath(generation), {
        schema: SCHEMA,
        generation,
        status: 'clean',
        confirmedAt: now(),
      })
      return true
    },
  })
}
