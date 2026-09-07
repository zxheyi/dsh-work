import type {
  RuntimeCode,
  RuntimeSnapshot,
  RuntimeState,
} from '../../packages/runtime-contract/index.ts'

export type { RuntimeCode, RuntimeState } from '../../packages/runtime-contract/index.ts'
export type RuntimeStatus = RuntimeSnapshot

export interface DesktopProfileSummary {
  readonly id: string
  readonly name: string
}

export interface DesktopStartupContext {
  readonly choiceRequired: boolean
  readonly homeLabel: '~/.dsh' | '$DSH_HOME'
  readonly profiles: readonly DesktopProfileSummary[]
  readonly rejectedCount: number
  readonly selected: 'isolated' | string | null
}

export interface DesktopBridge {
  readonly hasRetainedContext: boolean
  start(): Promise<RuntimeStatus>
  stop(): Promise<RuntimeStatus>
  recover(): Promise<RuntimeStatus>
  snapshot(): Promise<RuntimeStatus>
  startup(): Promise<DesktopStartupContext>
  selectProfile(profileId: string | null): Promise<RuntimeStatus>
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
