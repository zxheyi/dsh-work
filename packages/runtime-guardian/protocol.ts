import {
  RUNTIME_CODES,
  RUNTIME_COMMANDS,
  RUNTIME_STATES,
  type RuntimeCode,
  type RuntimeCommandName,
  type RuntimeSnapshot,
  type RuntimeState,
} from '../runtime-contract/index.ts'

export const GUARDIAN_PROTOCOL = 'dsh-work.guardian.v1' as const

export interface GuardianCommand {
  readonly protocol: typeof GUARDIAN_PROTOCOL
  readonly id: number
  readonly command: RuntimeCommandName
}

const states = new Set<RuntimeState>(RUNTIME_STATES)
const codes = new Set<RuntimeCode | null>([null, ...RUNTIME_CODES])

const exactKeys = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())

export function validGuardianCommand(value: unknown): value is GuardianCommand {
  return exactKeys(value, ['protocol', 'id', 'command']) && value.protocol === GUARDIAN_PROTOCOL &&
    typeof value.id === 'number' && Number.isSafeInteger(value.id) && value.id > 0 &&
    typeof value.command === 'string' && RUNTIME_COMMANDS.includes(value.command as RuntimeCommandName)
}

export function boundedGuardianSnapshot(value: unknown): RuntimeSnapshot | null {
  if (!exactKeys(value, ['state', 'code', 'canStart', 'canStop', 'canRecover']) ||
      !states.has(value.state as RuntimeState) || !codes.has(value.code as RuntimeCode | null) ||
      !['canStart', 'canStop', 'canRecover'].every(key => typeof value[key] === 'boolean')) return null
  return Object.freeze({
    state: value.state as RuntimeState,
    code: value.code as RuntimeCode | null,
    canStart: value.canStart as boolean,
    canStop: value.canStop as boolean,
    canRecover: value.canRecover as boolean,
  })
}
