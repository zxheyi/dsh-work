import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

import {
  WorkError,
  type CreateWorkSpec,
  type DispatchWorkRequest,
  type InspectSessionOutputsSpec,
  type InspectSessionOutputSourcesSpec,
  type ReadSessionOutputSpec,
  type PrepareSessionOutputRevisionSpec,
  type ImportSessionResourceSpec,
  type ImportConversationSpec,
  type SessionFileResource,
  type SessionOutputFile,
  type SessionOutputContent,
  type SessionOutputSource,
  type SessionOutputRevision,
  type SessionOutputRevisionFailure,
  type SaveSessionOutputSpec,
  type SessionOutputSave,
  type ShowSessionOutputSaveSpec,
  type WorkController,
  type WorkDeliverableContent as DomainWorkDeliverableContent,
  type WorkFollowFrame,
  type WorkSnapshot,
} from '../work-domain/index.ts'

export type WorkCreateSpec = CreateWorkSpec
export type WorkImportConversationSpec = ImportConversationSpec
export type WorkDispatchRequest = DispatchWorkRequest & Required<Pick<
  DispatchWorkRequest,
  'mutationId' | 'expectedRevision'
>>
export type WorkClientDispatchRequest = Omit<WorkDispatchRequest, 'mutationId' | 'expectedRevision'>
export type WorkDeliverableContent = DomainWorkDeliverableContent
export type WorkImportSessionResourceSpec = ImportSessionResourceSpec
export type WorkSessionFileResource = SessionFileResource
export type WorkInspectSessionOutputsSpec = InspectSessionOutputsSpec
export type WorkInspectSessionOutputSourcesSpec = InspectSessionOutputSourcesSpec
export type WorkSessionOutputFile = SessionOutputFile
export type WorkSessionOutputSource = SessionOutputSource
export type WorkReadSessionOutputSpec = ReadSessionOutputSpec
export type WorkSessionOutputContent = SessionOutputContent
export type WorkPrepareSessionOutputRevisionSpec = PrepareSessionOutputRevisionSpec
export type WorkSessionOutputRevision = SessionOutputRevision
export type WorkSessionOutputRevisionFailure = SessionOutputRevisionFailure
export type WorkSaveSessionOutputSpec = SaveSessionOutputSpec
export type WorkSessionOutputSave = SessionOutputSave
export type WorkShowSessionOutputSaveSpec = ShowSessionOutputSaveSpec

export interface WorkReadDeliverableRequest {
  readonly workId: string
}

export type WorkShowDeliveryRequest = WorkReadDeliverableRequest
export interface WorkShowDeliveryValue { readonly shown: true }
export interface WorkShowSessionOutputSaveValue { readonly shown: true }
export interface WorkSessionOutputsValue { readonly items: readonly WorkSessionOutputFile[] }
export interface WorkSessionOutputSourcesValue { readonly items: readonly WorkSessionOutputSource[] }

export interface WorkView {
  readonly workId: string
  readonly revision: number
  readonly title: string
  readonly goal: string
  readonly turnCount: number
  readonly resources: WorkSnapshot['resources']
  readonly deliverable: WorkSnapshot['deliverable']
  readonly status: WorkSnapshot['status']
  readonly execution: WorkSnapshot['execution']
  readonly lastFailure: { readonly message: string } | null
}

export interface WorkListValue {
  readonly items: readonly WorkView[]
}

export type WorkRemoteFollowFrame =
  | { readonly type: 'baseline'; readonly value: WorkListValue }
  | { readonly type: 'upsert'; readonly work: WorkView }

type RemoteInitializer = (this: WorkRemoteController) => void
const remoteInitializers: RemoteInitializer[] = []

declare module '@deepseek-ai/cordis' {
  interface Context {
    readonly workController: WorkController
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'work/already-exists': Record<string, never>
    'work/not-found': Record<string, never>
    'work/deliverable-exists': Record<string, never>
    'work/deliverable-invalid': Record<string, never>
    'work/delivery-failed': Record<string, never>
    'work/import-invalid': Record<string, never>
    'work/invalid-transition': Record<string, never>
    'work/mutation-conflict': Record<string, never>
    'work/recovery-conflict': Record<string, never>
    'work/resource-invalid': Record<string, never>
    'work/resource-limit': Record<string, never>
    'work/session-output-invalid': Record<string, never>
    'work/session-output-save-failed': Record<string, never>
    'work/session-resource-invalid': Record<string, never>
    'work/turn-failed': Record<string, never>
  }
}

function projectWork(work: WorkSnapshot): WorkView {
  return Object.freeze({
    workId: work.workId,
    revision: work.revision,
    title: work.title,
    goal: work.goal,
    turnCount: work.primarySession.turnCount,
    resources: work.resources,
    deliverable: work.deliverable,
    status: work.status,
    execution: work.execution,
    lastFailure: work.lastFailure ? Object.freeze({ message: work.lastFailure.message }) : null,
  })
}

async function workResult<Value>(operation: () => Promise<Value>): Promise<Value> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof WorkError) {
      throw new RemoteError(error.code, error.message, {}, { cause: error })
    }
    throw error
  }
}

async function* projectFollow(
  frames: AsyncIterable<WorkFollowFrame>,
): AsyncIterable<WorkRemoteFollowFrame> {
  for await (const frame of frames) {
    if (frame.type === 'baseline') {
      yield Object.freeze({
        type: 'baseline',
        value: Object.freeze({ items: Object.freeze(frame.value.items.map(projectWork)) }),
      })
    } else {
      yield Object.freeze({ type: 'upsert', work: projectWork(frame.work) })
    }
  }
}

export class WorkRemoteController extends TypertRemoteService {
  static inject = ['typert', 'workController']

  private readonly controller: WorkController

  constructor(ctx: Context) {
    super(ctx, 'workApi', { namespace: 'work' })
    this.controller = ctx.workController
    for (const initialize of remoteInitializers) initialize.call(this)
  }

  create(spec: WorkCreateSpec): Promise<WorkView> {
    return workResult(async () => projectWork(await this.controller.create(spec)))
  }

  importConversation(spec: WorkImportConversationSpec, signal?: AbortSignal): Promise<WorkView> {
    return workResult(async () => projectWork(await this.controller.importConversation(spec, signal)))
  }

  dispatch(request: WorkDispatchRequest, signal?: AbortSignal): Promise<WorkView> {
    return workResult(async () => projectWork(await this.controller.dispatch(request, signal)))
  }

  readDeliverable(request: WorkReadDeliverableRequest): Promise<WorkDeliverableContent> {
    return workResult(() => this.controller.readDeliverable(request.workId))
  }

  showDelivery(request: WorkShowDeliveryRequest, signal?: AbortSignal): Promise<WorkShowDeliveryValue> {
    return workResult(async () => {
      await this.controller.showDelivery(request.workId, signal)
      return Object.freeze({ shown: true as const })
    })
  }

  importSessionResource(
    spec: WorkImportSessionResourceSpec,
    signal?: AbortSignal,
  ): Promise<WorkSessionFileResource> {
    return workResult(() => this.controller.importSessionResource(spec, signal))
  }

  inspectSessionOutputs(
    spec: WorkInspectSessionOutputsSpec,
    signal?: AbortSignal,
  ): Promise<WorkSessionOutputsValue> {
    return workResult(async () => Object.freeze({
      items: await this.controller.inspectSessionOutputs(spec, signal),
    }))
  }

  inspectSessionOutputSources(
    spec: WorkInspectSessionOutputSourcesSpec,
    signal?: AbortSignal,
  ): Promise<WorkSessionOutputSourcesValue> {
    return workResult(async () => Object.freeze({
      items: await this.controller.inspectSessionOutputSources(spec, signal),
    }))
  }

  prepareSessionOutputRevision(
    spec: WorkPrepareSessionOutputRevisionSpec,
    signal?: AbortSignal,
  ): Promise<WorkSessionOutputRevision> {
    return workResult(() => this.controller.prepareSessionOutputRevision(spec, signal))
  }

  inspectSessionRevision(
    spec: WorkInspectSessionOutputsSpec,
    signal?: AbortSignal,
  ): Promise<WorkSessionOutputRevisionFailure | null> {
    return workResult(() => this.controller.inspectSessionRevision(spec, signal))
  }

  saveSessionOutput(
    spec: WorkSaveSessionOutputSpec,
    signal?: AbortSignal,
  ): Promise<WorkSessionOutputSave> {
    return workResult(() => this.controller.saveSessionOutput(spec, signal))
  }

  showSessionOutputSave(
    spec: WorkShowSessionOutputSaveSpec,
    signal?: AbortSignal,
  ): Promise<WorkShowSessionOutputSaveValue> {
    return workResult(async () => {
      await this.controller.showSessionOutputSave(spec, signal)
      return Object.freeze({ shown: true as const })
    })
  }

  readSessionOutput(
    spec: WorkReadSessionOutputSpec,
    signal?: AbortSignal,
  ): Promise<WorkSessionOutputContent> {
    return workResult(() => this.controller.readSessionOutput(spec, signal))
  }

  async list(): Promise<WorkListValue> {
    return Object.freeze({
      items: Object.freeze((await this.controller.list()).map(projectWork)),
    })
  }

  follow(signal?: AbortSignal): AsyncIterable<WorkRemoteFollowFrame> {
    return projectFollow(this.controller.follow(signal))
  }
}

type RemoteMethodName = 'create' | 'importConversation' | 'dispatch' | 'readDeliverable' | 'showDelivery' | 'importSessionResource' | 'inspectSessionOutputs' | 'inspectSessionOutputSources' | 'prepareSessionOutputRevision' | 'inspectSessionRevision' | 'saveSessionOutput' | 'showSessionOutputSave' | 'readSessionOutput' | 'list' | 'follow'
type RemoteMethod = (this: WorkRemoteController, ...args: unknown[]) => unknown
type RemoteDecorator = (
  method: RemoteMethod,
  context: ClassMethodDecoratorContext<WorkRemoteController, RemoteMethod>,
) => void

function installRemoteMarker(name: RemoteMethodName, decorator: RemoteDecorator): void {
  const prototype = WorkRemoteController.prototype
  decorator(Reflect.get(prototype, name) as RemoteMethod, {
    kind: 'method',
    name,
    static: false,
    private: false,
    metadata: Object.create(null) as DecoratorMetadata,
    access: {
      has: value => name in value,
      get: value => Reflect.get(value, name) as RemoteMethod,
    },
    addInitializer(initializer) {
      remoteInitializers.push(initializer as RemoteInitializer)
    },
  })
}

installRemoteMarker('create', Remote as RemoteDecorator)
installRemoteMarker('importConversation', Remote as RemoteDecorator)
installRemoteMarker('dispatch', Remote as RemoteDecorator)
installRemoteMarker('readDeliverable', Remote as RemoteDecorator)
installRemoteMarker('showDelivery', Remote as RemoteDecorator)
installRemoteMarker('importSessionResource', Remote as RemoteDecorator)
installRemoteMarker('inspectSessionOutputs', Remote as RemoteDecorator)
installRemoteMarker('inspectSessionOutputSources', Remote as RemoteDecorator)
installRemoteMarker('prepareSessionOutputRevision', Remote as RemoteDecorator)
installRemoteMarker('inspectSessionRevision', Remote as RemoteDecorator)
installRemoteMarker('saveSessionOutput', Remote as RemoteDecorator)
installRemoteMarker('showSessionOutputSave', Remote as RemoteDecorator)
installRemoteMarker('readSessionOutput', Remote as RemoteDecorator)
installRemoteMarker('list', Remote as RemoteDecorator)
installRemoteMarker('follow', Remote({ mode: 'stream' }) as RemoteDecorator)

export default WorkRemoteController
