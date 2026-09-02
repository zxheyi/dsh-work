import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export type WorkErrorCode =
  | 'work/already-exists'
  | 'work/not-found'
  | 'work/deliverable-exists'
  | 'work/deliverable-invalid'
  | 'work/invalid-transition'
  | 'work/mutation-conflict'
  | 'work/recovery-conflict'
  | 'work/turn-failed'

export class WorkError extends Error {
  readonly code: WorkErrorCode

  constructor(code: WorkErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'WorkError'
    this.code = code
  }
}

export interface CreateWorkSpec {
  readonly title: string
  readonly goal: string
}

export interface WorkSnapshot {
  readonly workId: string
  readonly revision: number
  readonly title: string
  readonly goal: string
  readonly workspace: WorkWorkspace
  readonly primarySession: WorkPrimarySession
  readonly deliverable: WorkFileDeliverable | null
  readonly status: WorkStatus
  readonly execution: WorkExecution
  readonly lastFailure: WorkFailure | null
  readonly lastMutationId: string | null
  readonly lastMutationDigest: string | null
}

export type WorkStatus = 'working' | 'awaiting-review' | 'completed' | 'delivered'
export type WorkExecution = 'idle' | 'failed'

export interface WorkFailure {
  readonly requestId: string
  readonly message: string
}

export interface WorkWorkspace {
  readonly workspaceId: string
  readonly path: string
}

export interface WorkPrimarySession {
  readonly sessionId: string
  readonly turnCount: number
}

export interface WorkFileDeliverable {
  readonly kind: 'file'
  readonly path: string
}

export interface WorkController {
  create(spec: CreateWorkSpec): Promise<WorkSnapshot>
  get(): Promise<WorkSnapshot | null>
  list(): Promise<readonly WorkSnapshot[]>
  follow(signal?: AbortSignal): AsyncIterable<WorkFollowFrame>
  dispatch(request: DispatchWorkRequest, signal?: AbortSignal): Promise<WorkSnapshot>
}

export interface WorkBaseline {
  readonly items: readonly WorkSnapshot[]
}

export type WorkFollowFrame =
  | { readonly type: 'baseline'; readonly value: WorkBaseline }
  | { readonly type: 'upsert'; readonly work: WorkSnapshot }

export interface DispatchWorkRequest {
  readonly workId: string
  readonly mutationId?: string
  readonly expectedRevision?: number
  readonly command: WorkCommand
}

export type WorkCommand = SubmitTurnCommand | RecordFileCommand | CompleteWorkCommand | DeliverWorkCommand

export interface SubmitTurnCommand {
  readonly type: 'submit-turn'
  readonly instruction: string
}

export interface RecordFileCommand {
  readonly type: 'record-file'
  readonly path: string
}

export interface CompleteWorkCommand {
  readonly type: 'complete'
}

export interface DeliverWorkCommand {
  readonly type: 'deliver'
}

export interface WorkControllerOptions {
  readonly createId?: () => string
  readonly createSessionId?: () => string
  readonly createRequestId?: () => string
  readonly workspaceRoot: string
  readonly harness: HarnessWorkPort
  readonly store?: WorkStore
}

export interface WorkStore {
  load(): Promise<WorkSnapshot | null>
  save(work: WorkSnapshot): Promise<void>
}

export interface WorkDomainState {
  readonly work: WorkSnapshot | null
}

export interface WorkDomainGlobal {
  get(): WorkDomainState
  set(state: WorkDomainState): Promise<void>
}

export function createMemoryWorkStore(initial: WorkSnapshot | null = null): WorkStore {
  let stored = initial ? structuredClone(initial) : null
  return {
    async load() {
      return stored ? structuredClone(stored) : null
    },
    async save(work) {
      stored = structuredClone(work)
    },
  }
}

export function createDomainWorkStore(global: WorkDomainGlobal): WorkStore {
  return {
    async load() {
      return global.get().work
    },
    async save(work) {
      await global.set({ work })
    },
  }
}

export interface EnsureWorkspaceRequest {
  readonly path: string
  readonly title: string
}

export interface HarnessWorkPort {
  ensureWorkspace(request: EnsureWorkspaceRequest): Promise<WorkWorkspace>
  ensurePrimarySession(request: EnsurePrimarySessionRequest): Promise<{ readonly sessionId: string }>
  submitTurn(request: SubmitTurnRequest, signal?: AbortSignal): Promise<void>
}

export interface EnsurePrimarySessionRequest {
  readonly sessionId: string
  readonly workspaceId: string
}

export interface SubmitTurnRequest {
  readonly requestId: string
  readonly sessionId: string
  readonly instruction: string
}

export interface HarnessWorkContext {
  readonly workspaceRegistry: {
    create(path: string, title?: string): Promise<{ readonly id: string; readonly path: string }>
  }
  readonly sessionController: {
    create(request: {
      readonly sessionId: string
      readonly workspaceId: string
    }): Promise<{ readonly sessionId: string }>
    prompt(request: {
      readonly requestId: string
      readonly sessionId: string
      readonly mode: 'queue'
      readonly content: readonly [{ readonly type: 'text'; readonly text: string }]
    }, signal: AbortSignal): Promise<{ readonly accepted: true }>
  }
}

export function createHarnessWorkPort(context: HarnessWorkContext): HarnessWorkPort {
  return {
    async ensureWorkspace(request) {
      await fs.mkdir(request.path, { recursive: true })
      const workspace = await context.workspaceRegistry.create(request.path, request.title)
      return Object.freeze({
        workspaceId: workspace.id,
        path: workspace.path,
      })
    },
    async ensurePrimarySession(request) {
      const session = await context.sessionController.create({
        sessionId: request.sessionId,
        workspaceId: request.workspaceId,
      })
      return Object.freeze({ sessionId: session.sessionId })
    },
    async submitTurn(request, signal = new AbortController().signal) {
      await context.sessionController.prompt({
        requestId: request.requestId,
        sessionId: request.sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: request.instruction }],
      }, signal)
    },
  }
}

export function createWorkController(options: WorkControllerOptions): WorkController {
  const createId = options.createId ?? randomUUID
  const createSessionId = options.createSessionId ?? randomUUID
  const createRequestId = options.createRequestId ?? randomUUID
  const store = options.store ?? createMemoryWorkStore()
  let work: WorkSnapshot | null = null
  const followers = new Set<{
    readonly frames: WorkFollowFrame[]
    wake: (() => void) | null
  }>()

  const freezeSnapshot = (snapshot: WorkSnapshot): WorkSnapshot => Object.freeze({
    ...snapshot,
    workspace: Object.freeze({ ...snapshot.workspace }),
    primarySession: Object.freeze({ ...snapshot.primarySession }),
    deliverable: snapshot.deliverable ? Object.freeze({ ...snapshot.deliverable }) : null,
    lastFailure: snapshot.lastFailure ? Object.freeze({ ...snapshot.lastFailure }) : null,
  })

  const initialize = async (): Promise<void> => {
    const restored = await store.load()
    if (!restored) return
    const workspace = await options.harness.ensureWorkspace({
      path: restored.workspace.path,
      title: restored.title,
    })
    if (workspace.workspaceId !== restored.workspace.workspaceId || workspace.path !== restored.workspace.path) {
      throw new WorkError('work/recovery-conflict', 'Harness resolved a different Workspace during Work recovery.')
    }
    const session = await options.harness.ensurePrimarySession({
      sessionId: restored.primarySession.sessionId,
      workspaceId: restored.workspace.workspaceId,
    })
    if (session.sessionId !== restored.primarySession.sessionId) {
      throw new WorkError('work/recovery-conflict', 'Harness resolved a different Primary Session during Work recovery.')
    }
    work = freezeSnapshot(restored)
  }

  let initialization: Promise<void> | null = null
  let mutationTail: Promise<void> = Promise.resolve()
  const ready = (): Promise<void> => initialization ??= initialize()
  const publish = (frame: WorkFollowFrame): void => {
    for (const follower of followers) {
      follower.frames.push(frame)
      follower.wake?.()
      follower.wake = null
    }
  }
  const commit = async (next: WorkSnapshot): Promise<WorkSnapshot> => {
    const frozen = freezeSnapshot({
      ...next,
      revision: work ? work.revision + 1 : 1,
    })
    await store.save(frozen)
    work = frozen
    publish(Object.freeze({ type: 'upsert', work: frozen }))
    return frozen
  }

  return {
    async create(spec) {
      await ready()
      if (work) throw new WorkError('work/already-exists', 'The first-phase product supports one Work.')
      const workId = createId()
      const workspace = await options.harness.ensureWorkspace({
        path: path.join(options.workspaceRoot, workId),
        title: spec.title,
      })
      const ensuredSession = await options.harness.ensurePrimarySession({
        sessionId: createSessionId(),
        workspaceId: workspace.workspaceId,
      })
      const primarySession = Object.freeze({
        sessionId: ensuredSession.sessionId,
        turnCount: 0,
      })
      return commit({
        workId,
        revision: 1,
        title: spec.title,
        goal: spec.goal,
        workspace,
        primarySession,
        deliverable: null,
        status: 'working',
        execution: 'idle',
        lastFailure: null,
        lastMutationId: null,
        lastMutationDigest: null,
      })
    },

    async get() {
      await ready()
      return work
    },

    async list() {
      await ready()
      return Object.freeze(work ? [work] : [])
    },

    async *follow(signal = new AbortController().signal) {
      await ready()
      if (signal.aborted) return
      const follower = {
        frames: [] as WorkFollowFrame[],
        wake: null as (() => void) | null,
      }
      const wake = (): void => {
        follower.wake?.()
        follower.wake = null
      }
      followers.add(follower)
      signal.addEventListener('abort', wake)
      try {
        yield Object.freeze({
          type: 'baseline' as const,
          value: Object.freeze({ items: Object.freeze(work ? [work] : []) }),
        })
        while (!signal.aborted) {
          const frame = follower.frames.shift()
          if (frame) {
            yield frame
            continue
          }
          await new Promise<void>((resolve) => {
            follower.wake = resolve
          })
        }
      } finally {
        signal.removeEventListener('abort', wake)
        followers.delete(follower)
      }
    },

    dispatch(request, signal) {
      const operation = mutationTail.then(async () => {
        await ready()
      if (!work || work.workId !== request.workId) {
        throw new WorkError('work/not-found', `Work not found: ${request.workId}`)
      }
      const mutationDigest = request.mutationId === undefined ? null : createHash('sha256')
        .update(JSON.stringify(request.command))
        .digest('hex')
      if (request.mutationId !== undefined && request.mutationId === work.lastMutationId) {
        if (mutationDigest !== work.lastMutationDigest) {
          throw new WorkError('work/mutation-conflict', 'Mutation id was already used for a different command.')
        }
        if (work.execution === 'failed' && work.lastFailure) {
          throw new WorkError('work/turn-failed', work.lastFailure.message)
        }
        return work
      }
      if (request.expectedRevision !== undefined && request.expectedRevision !== work.revision) {
        throw new WorkError('work/mutation-conflict', 'Work changed before this command could acquire its mutation lease.')
      }
      const mutated = (next: WorkSnapshot): WorkSnapshot => request.mutationId === undefined
        ? next
        : { ...next, lastMutationId: request.mutationId, lastMutationDigest: mutationDigest }
      if (request.command.type === 'submit-turn') {
        if (work.status === 'completed' || work.status === 'delivered') {
          throw new WorkError('work/invalid-transition', `Cannot submit a Turn while Work is ${work.status}.`)
        }
        const requestId = createRequestId()
        try {
          await options.harness.submitTurn({
            requestId,
            sessionId: work.primarySession.sessionId,
            instruction: request.command.instruction,
          }, signal)
        } catch (cause) {
          await commit(mutated({
            ...work,
            execution: 'failed',
            lastFailure: {
              requestId,
              message: 'Harness did not accept the Turn.',
            },
          }))
          throw new WorkError('work/turn-failed', 'Harness did not accept the Turn.', { cause })
        }
        return commit(mutated({
          ...work,
          primarySession: Object.freeze({
            ...work.primarySession,
            turnCount: work.primarySession.turnCount + 1,
          }),
          execution: 'idle',
          lastFailure: null,
        }))
      } else if (request.command.type === 'record-file') {
        if (work.deliverable) {
          throw new WorkError('work/deliverable-exists', 'The first-phase product supports one file deliverable.')
        }
        const workspacePath = await fs.realpath(work.workspace.path)
        const candidatePath = path.resolve(workspacePath, request.command.path)
        const relativePath = path.relative(workspacePath, candidatePath)
        if (
          path.isAbsolute(request.command.path)
          || relativePath === ''
          || relativePath === '..'
          || relativePath.startsWith(`..${path.sep}`)
          || path.isAbsolute(relativePath)
        ) {
          throw new WorkError('work/deliverable-invalid', 'The file deliverable must be inside the managed Workspace.')
        }
        let resolvedFilePath: string
        try {
          resolvedFilePath = await fs.realpath(candidatePath)
          if (!(await fs.stat(resolvedFilePath)).isFile()) throw new Error('not a regular file')
        } catch {
          throw new WorkError('work/deliverable-invalid', 'The file deliverable must be an existing regular file.')
        }
        const resolvedRelativePath = path.relative(workspacePath, resolvedFilePath)
        if (
          resolvedRelativePath === '..'
          || resolvedRelativePath.startsWith(`..${path.sep}`)
          || path.isAbsolute(resolvedRelativePath)
        ) {
          throw new WorkError('work/deliverable-invalid', 'The file deliverable must resolve inside the managed Workspace.')
        }
        return commit(mutated({
          ...work,
          deliverable: Object.freeze({
            kind: 'file',
            path: resolvedRelativePath.split(path.sep).join(path.posix.sep),
          }),
          status: 'awaiting-review',
        }))
      } else if (request.command.type === 'complete') {
        if (work.status !== 'awaiting-review') {
          throw new WorkError('work/invalid-transition', 'Work must be awaiting review before completion.')
        }
        return commit(mutated({ ...work, status: 'completed' }))
      } else {
        if (work.status !== 'completed') {
          throw new WorkError('work/invalid-transition', 'Work must be completed before delivery.')
        }
        return commit(mutated({ ...work, status: 'delivered' }))
      }
      })
      mutationTail = operation.then(() => undefined, () => undefined)
      return operation
    },
  }
}
