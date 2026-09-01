export const GUARDIAN_PROTOCOL = 'dsh-work.guardian.v1'
export const GUARDIAN_COMMANDS = Object.freeze(['start', 'stop', 'recover', 'snapshot'])

const states = new Set(['stopped', 'starting', 'ready', 'stopping', 'failed'])
const codes = new Set([
  null, 'runtime-unavailable', 'process-error', 'control-pipe-error', 'lifecycle-disconnected',
  'invalid-lifecycle-message', 'startup-timeout', 'output-limit', 'unexpected-exit',
  'runtime-exit-failed', 'disposal-unconfirmed', 'forced-stop', 'cleanup-unconfirmed',
  'recovery-required', 'guardian-unavailable',
])

const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())

export function validGuardianCommand(value) {
  return exactKeys(value, ['protocol', 'id', 'command']) && value.protocol === GUARDIAN_PROTOCOL &&
    Number.isSafeInteger(value.id) && value.id > 0 && GUARDIAN_COMMANDS.includes(value.command)
}

export function boundedGuardianSnapshot(value) {
  if (!exactKeys(value, ['state', 'code', 'canStart', 'canStop', 'canRecover']) ||
      !states.has(value.state) || !codes.has(value.code) ||
      !['canStart', 'canStop', 'canRecover'].every(key => typeof value[key] === 'boolean')) return null
  return Object.freeze({ state: value.state, code: value.code, canStart: value.canStart,
    canStop: value.canStop, canRecover: value.canRecover })
}
