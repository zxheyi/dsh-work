export const RUNTIME_STATES = Object.freeze([
  'stopped',
  'starting',
  'ready',
  'stopping',
  'failed',
] as const)

export const RUNTIME_HOST_CODES = Object.freeze([
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
] as const)

export const RUNTIME_CODES = Object.freeze([
  ...RUNTIME_HOST_CODES,
  'recovery-required',
  'guardian-unavailable',
] as const)

export const RUNTIME_COMMANDS = Object.freeze([
  'start',
  'stop',
  'recover',
  'snapshot',
] as const)

export type RuntimeState = typeof RUNTIME_STATES[number]
export type RuntimeHostCode = typeof RUNTIME_HOST_CODES[number]
export type RuntimeCode = typeof RUNTIME_CODES[number]
export type RuntimeCommandName = typeof RUNTIME_COMMANDS[number]

export interface RuntimeSnapshot {
  readonly state: RuntimeState
  readonly code: RuntimeCode | null
  readonly canStart: boolean
  readonly canStop: boolean
  readonly canRecover: boolean
}

// Guardian implementations and their desktop adapters share this seam. The
// renderer keeps a separate all-async interface because Electron IPC changes
// snapshot semantics.
export interface RuntimeControl {
  start(): Promise<RuntimeSnapshot>
  stop(): Promise<RuntimeSnapshot>
  recover(): Promise<RuntimeSnapshot>
  snapshot(): RuntimeSnapshot
  subscribe(listener: (snapshot: RuntimeSnapshot) => void): () => void
}
