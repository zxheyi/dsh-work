import { Service, type Context } from '@deepseek-ai/cordis'
import {
  remoteErrorOf,
  type RemoteFailure,
  type RemoteResult,
} from '@deepseek-ai/dsh-typert-protocol'

import type {
  WorkCreateSpec,
  WorkClientDispatchRequest,
  WorkDispatchRequest,
  WorkDeliverableContent,
  WorkListValue,
  WorkImportConversationSpec,
  WorkImportSessionResourceSpec,
  WorkInspectSessionOutputsSpec,
  WorkReadSessionOutputSpec,
  WorkRemoteFollowFrame,
  WorkView,
  WorkShowDeliveryValue,
  WorkSessionFileResource,
  WorkSessionOutputFile,
  WorkSessionOutputContent,
  WorkSessionOutputsValue,
} from './index.ts'

export interface WorkClientRemote {
  create(spec: WorkCreateSpec): Promise<RemoteResult<WorkView>>
  importConversation(
    spec: WorkImportConversationSpec,
    signal?: AbortSignal,
  ): Promise<RemoteResult<WorkView>>
  dispatch(request: WorkDispatchRequest, signal?: AbortSignal): Promise<RemoteResult<WorkView>>
  readDeliverable(request: { readonly workId: string }): Promise<RemoteResult<WorkDeliverableContent>>
  showDelivery(request: { readonly workId: string }, signal?: AbortSignal): Promise<RemoteResult<WorkShowDeliveryValue>>
  importSessionResource(
    spec: WorkImportSessionResourceSpec,
    signal?: AbortSignal,
  ): Promise<RemoteResult<WorkSessionFileResource>>
  inspectSessionOutputs(
    spec: WorkInspectSessionOutputsSpec,
    signal?: AbortSignal,
  ): Promise<RemoteResult<WorkSessionOutputsValue>>
  readSessionOutput(
    spec: WorkReadSessionOutputSpec,
    signal?: AbortSignal,
  ): Promise<RemoteResult<WorkSessionOutputContent>>
  list(): Promise<RemoteResult<WorkListValue>>
  follow(signal?: AbortSignal): AsyncIterable<WorkRemoteFollowFrame>
}

export interface WorkClientSnapshot {
  readonly items: readonly WorkView[]
  readonly state: 'idle' | 'loading' | 'error'
  readonly phase: 'pending' | 'ready'
  readonly error: RemoteFailure | null
}

export interface WorkSource {
  getSnapshot(): WorkClientSnapshot
  subscribe(listener: () => void): () => void
}

export interface IWorks {
  readonly list: WorkSource
  create(spec: WorkCreateSpec): Promise<WorkView>
  importConversation(spec: WorkImportConversationSpec, signal?: AbortSignal): Promise<WorkView>
  dispatch(request: WorkClientDispatchRequest, signal?: AbortSignal): Promise<WorkView>
  readDeliverable(workId: string): Promise<WorkDeliverableContent>
  showDelivery(workId: string, signal?: AbortSignal): Promise<void>
  importSessionResource(
    spec: WorkImportSessionResourceSpec,
    signal?: AbortSignal,
  ): Promise<WorkSessionFileResource>
  inspectSessionOutputs(
    spec: WorkInspectSessionOutputsSpec,
    signal?: AbortSignal,
  ): Promise<readonly WorkSessionOutputFile[]>
  readSessionOutput(
    spec: WorkReadSessionOutputSpec,
    signal?: AbortSignal,
  ): Promise<WorkSessionOutputContent>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    readonly works: IWorks
  }
}

export class ClientWorkModel implements WorkSource {
  private readonly remote: WorkClientRemote
  private items: readonly WorkView[] = Object.freeze([])
  private state: WorkClientSnapshot['state'] = 'loading'
  private phase: WorkClientSnapshot['phase'] = 'pending'
  private error: RemoteFailure | null = null
  private readonly listeners = new Set<() => void>()
  private snapshot: WorkClientSnapshot = this.buildSnapshot()

  constructor(remote: WorkClientRemote) {
    this.remote = remote
  }

  async create(spec: WorkCreateSpec): Promise<RemoteResult<WorkView>> {
    const result = await this.remote.create(spec)
    if (result.ok) this.upsertView(result.value)
    return result
  }

  async importConversation(
    spec: WorkImportConversationSpec,
    signal?: AbortSignal,
  ): Promise<RemoteResult<WorkView>> {
    const result = await this.remote.importConversation(spec, signal)
    if (result.ok) this.upsertView(result.value)
    return result
  }

  async dispatch(
    request: WorkDispatchRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<WorkView>> {
    const result = await this.remote.dispatch(request, signal)
    if (result.ok) this.upsertView(result.value)
    return result
  }

  readDeliverable(workId: string): Promise<RemoteResult<WorkDeliverableContent>> {
    return this.remote.readDeliverable({ workId })
  }

  showDelivery(workId: string, signal?: AbortSignal): Promise<RemoteResult<WorkShowDeliveryValue>> {
    return this.remote.showDelivery({ workId }, signal)
  }

  importSessionResource(
    spec: WorkImportSessionResourceSpec,
    signal?: AbortSignal,
  ): Promise<RemoteResult<WorkSessionFileResource>> {
    return this.remote.importSessionResource(spec, signal)
  }

  inspectSessionOutputs(
    spec: WorkInspectSessionOutputsSpec,
    signal?: AbortSignal,
  ): Promise<RemoteResult<WorkSessionOutputsValue>> {
    return this.remote.inspectSessionOutputs(spec, signal)
  }

  readSessionOutput(
    spec: WorkReadSessionOutputSpec,
    signal?: AbortSignal,
  ): Promise<RemoteResult<WorkSessionOutputContent>> {
    return this.remote.readSessionOutput(spec, signal)
  }

  replaceBaseline(value: WorkListValue): void {
    const incoming = value.items[0]
    const installed = this.items[0]
    if (incoming && (!installed || incoming.revision >= installed.revision)) {
      this.items = Object.freeze([incoming])
    }
    this.state = 'idle'
    this.phase = 'ready'
    this.error = null
    this.publish()
  }

  upsertView(work: WorkView): void {
    const installed = this.items[0]
    if (installed && installed.workId === work.workId && installed.revision > work.revision) return
    this.items = Object.freeze([work])
    this.publish()
  }

  handleCarrierFailure(): void {
    this.state = 'loading'
    this.error = null
    this.publish()
  }

  handleStreamFailure(error: unknown): void {
    const failure = remoteErrorOf(error)
    if (!failure) throw error
    this.state = 'error'
    this.error = failure
    this.publish()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot(): WorkClientSnapshot {
    return this.snapshot
  }

  private buildSnapshot(): WorkClientSnapshot {
    return Object.freeze({
      items: this.items,
      state: this.state,
      phase: this.phase,
      error: this.error,
    })
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot()
    for (const listener of this.listeners) listener()
  }
}

export class WorksController extends Service implements IWorks {
  readonly list: WorkSource
  private readonly model: ClientWorkModel
  private readonly createMutationId: () => string

  constructor(
    ctx: Context,
    model: ClientWorkModel,
    createMutationId: () => string = () => globalThis.crypto.randomUUID(),
  ) {
    super(ctx, 'works')
    this.model = model
    this.createMutationId = createMutationId
    this.list = model
  }

  async create(spec: WorkCreateSpec): Promise<WorkView> {
    const result = await this.model.create(spec)
    if (!result.ok) throw result.error
    return result.value
  }

  async importConversation(
    spec: WorkImportConversationSpec,
    signal?: AbortSignal,
  ): Promise<WorkView> {
    const result = await this.model.importConversation(spec, signal)
    if (!result.ok) throw result.error
    return result.value
  }

  async dispatch(request: WorkClientDispatchRequest, signal?: AbortSignal): Promise<WorkView> {
    const current = this.model.getSnapshot().items.find(work => work.workId === request.workId)
    if (!current) throw new Error('Work is not available for mutation.')
    const result = await this.model.dispatch({
      ...request,
      mutationId: this.createMutationId(),
      expectedRevision: current.revision,
    }, signal)
    if (!result.ok) throw result.error
    return result.value
  }

  async readDeliverable(workId: string): Promise<WorkDeliverableContent> {
    const result = await this.model.readDeliverable(workId)
    if (!result.ok) throw result.error
    return result.value
  }

  async showDelivery(workId: string, signal?: AbortSignal): Promise<void> {
    const result = await this.model.showDelivery(workId, signal)
    if (!result.ok) throw result.error
  }

  async importSessionResource(
    spec: WorkImportSessionResourceSpec,
    signal?: AbortSignal,
  ): Promise<WorkSessionFileResource> {
    const result = await this.model.importSessionResource(spec, signal)
    if (!result.ok) throw result.error
    return result.value
  }

  async inspectSessionOutputs(
    spec: WorkInspectSessionOutputsSpec,
    signal?: AbortSignal,
  ): Promise<readonly WorkSessionOutputFile[]> {
    const result = await this.model.inspectSessionOutputs(spec, signal)
    if (!result.ok) throw result.error
    return result.value.items
  }

  async readSessionOutput(
    spec: WorkReadSessionOutputSpec,
    signal?: AbortSignal,
  ): Promise<WorkSessionOutputContent> {
    const result = await this.model.readSessionOutput(spec, signal)
    if (!result.ok) throw result.error
    return result.value
  }
}
