import type { RuntimeHostCode, RuntimeHostState } from '../runtime-host/index.ts'

export const GUARDIAN_PROTOCOL = 'dsh-work.guardian.v1' as const
export const GUARDIAN_COMMANDS = Object.freeze(['start', 'stop', 'recover', 'snapshot'] as const)

export type GuardianCommandName = typeof GUARDIAN_COMMANDS[number]
export type GuardianCode = RuntimeHostCode | 'recovery-required' | 'guardian-unavailable'

export interface GuardianSnapshot {
  readonly state: RuntimeHostState
  readonly code: GuardianCode | null
  readonly canStart: boolean
  readonly canStop: boolean
  readonly canRecover: boolean
}

export interface GuardianCommand {
  readonly protocol: typeof GUARDIAN_PROTOCOL
  readonly id: number
  readonly command: GuardianCommandName
}

const states = new Set<RuntimeHostState>(['stopped', 'starting', 'ready', 'stopping', 'failed'])
const codes = new Set<GuardianCode | null>([
  null,
  'runtime-unavailable',
  'process-error',
  'control-pipe-error',
  'lifecycle-disconnected',
  'invalid-lifecycle-message',
  'startup-timeout',
  'output-limit',
  'unexpected-exit',
  'runtime-exit-failed',
  'disposal-unconfirmed',
  'forced-stop',
  'cleanup-unconfirmed',
  'recovery-required',
  'guardian-unavailable',
])

const exactKeys = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())

export function validGuardianCommand(value: unknown): value is GuardianCommand {
  return exactKeys(value, ['protocol', 'id', 'command']) && value.protocol === GUARDIAN_PROTOCOL &&
    typeof value.id === 'number' && Number.isSafeInteger(value.id) && value.id > 0 &&
    typeof value.command === 'string' && GUARDIAN_COMMANDS.includes(value.command as GuardianCommandName)
}

export function boundedGuardianSnapshot(value: unknown): GuardianSnapshot | null {
  if (!exactKeys(value, ['state', 'code', 'canStart', 'canStop', 'canRecover']) ||
      !states.has(value.state as RuntimeHostState) || !codes.has(value.code as GuardianCode | null) ||
      !['canStart', 'canStop', 'canRecover'].every(key => typeof value[key] === 'boolean')) return null
  return Object.freeze({
    state: value.state as RuntimeHostState,
    code: value.code as GuardianCode | null,
    canStart: value.canStart as boolean,
    canStop: value.canStop as boolean,
    canRecover: value.canRecover as boolean,
  })
}
