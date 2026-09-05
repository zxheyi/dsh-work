import type {
  RuntimeCode,
  RuntimeSnapshot,
  RuntimeState,
} from '../../packages/runtime-contract/index.ts'

export type { RuntimeCode, RuntimeState } from '../../packages/runtime-contract/index.ts'
export type RuntimeStatus = RuntimeSnapshot

export interface DesktopBridge {
  readonly hasRetainedContext: boolean
  start(): Promise<RuntimeStatus>
  stop(): Promise<RuntimeStatus>
  recover(): Promise<RuntimeStatus>
  snapshot(): Promise<RuntimeStatus>
  subscribe(listener: (status: RuntimeStatus) => void): () => void
}

export interface DesktopRecoveryBridge {
  read(): string
  update(value: string): void
}

declare global {
  type DshWorkRuntimeState = RuntimeState
  type DshWorkRuntimeCode = RuntimeCode
  type DshWorkRuntimeStatus = RuntimeStatus

  interface Window {
    readonly dshWork: DesktopBridge
    readonly dshWorkRecovery?: DesktopRecoveryBridge
  }
}
