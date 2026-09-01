import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export type WorkErrorCode = 'work/already-exists' | 'work/not-found'

export class WorkError extends Error {
  readonly code: WorkErrorCode

  constructor(code: WorkErrorCode, message: string) {
    super(message)
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
  readonly title: string
  readonly goal: string
  readonly workspace: WorkWorkspace
  readonly primarySession: WorkPrimarySession
}

export interface WorkWorkspace {
  readonly workspaceId: string
  readonly path: string
}

export interface WorkPrimarySession {
  readonly sessionId: string
  readonly turnCount: number
}

export interface WorkController {
  create(spec: CreateWorkSpec): Promise<WorkSnapshot>
  get(): Promise<WorkSnapshot | null>
  dispatch(request: DispatchWorkRequest, signal?: AbortSignal): Promise<WorkSnapshot>
}

export interface DispatchWorkRequest {
  readonly workId: string
  readonly command: SubmitTurnCommand
}

export interface SubmitTurnCommand {
  readonly type: 'submit-turn'
  readonly instruction: string
}

export interface WorkControllerOptions {
  readonly createId?: () => string
  readonly createSessionId?: () => string
  readonly createRequestId?: () => string
  readonly workspaceRoot: string
  readonly harness: HarnessWorkPort
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
  readonly cwd: string
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
      readonly cwd: string
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
      const session = await context.sessionController.create(request)
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
  let work: WorkSnapshot | null = null

  return {
    async create(spec) {
      if (work) throw new WorkError('work/already-exists', 'The first-phase product supports one Work.')
      const workId = createId()
      const workspace = await options.harness.ensureWorkspace({
        path: path.join(options.workspaceRoot, workId),
        title: spec.title,
      })
      const ensuredSession = await options.harness.ensurePrimarySession({
        sessionId: createSessionId(),
        workspaceId: workspace.workspaceId,
        cwd: workspace.path,
      })
      const primarySession = Object.freeze({
        sessionId: ensuredSession.sessionId,
        turnCount: 0,
      })
      work = Object.freeze({
        workId,
        title: spec.title,
        goal: spec.goal,
        workspace,
        primarySession,
      })
      return work
    },

    async get() {
      return work
    },

    async dispatch(request, signal) {
      if (!work || work.workId !== request.workId) {
        throw new WorkError('work/not-found', `Work not found: ${request.workId}`)
      }
      await options.harness.submitTurn({
        requestId: createRequestId(),
        sessionId: work.primarySession.sessionId,
        instruction: request.command.instruction,
      }, signal)
      work = Object.freeze({
        ...work,
        primarySession: Object.freeze({
          ...work.primarySession,
          turnCount: work.primarySession.turnCount + 1,
        }),
      })
      return work
    },
  }
}
