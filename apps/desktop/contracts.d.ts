export type RuntimeState = 'stopped' | 'starting' | 'ready' | 'stopping' | 'failed'
export type RuntimeCode = 'runtime-unavailable' | 'process-error' | 'control-pipe-error' |
  'lifecycle-disconnected' | 'invalid-lifecycle-message' | 'startup-timeout' |
  'output-limit' | 'unexpected-exit' | 'runtime-exit-failed' | 'disposal-unconfirmed' |
  'forced-stop' | 'cleanup-unconfirmed'
export interface RuntimeStatus {
  readonly state: RuntimeState
  readonly code: RuntimeCode | null
  readonly canStart: boolean
  readonly canStop: boolean
}
export interface DesktopBridge {
  start(): Promise<RuntimeStatus>
  stop(): Promise<RuntimeStatus>
  snapshot(): Promise<RuntimeStatus>
  subscribe(listener: (status: RuntimeStatus) => void): () => void
}
declare global { interface Window { readonly dshWork: DesktopBridge } }
