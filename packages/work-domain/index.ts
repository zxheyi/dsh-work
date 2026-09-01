import { randomUUID } from 'node:crypto'

export type WorkErrorCode = 'work/already-exists'

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
}

export interface WorkController {
  create(spec: CreateWorkSpec): Promise<WorkSnapshot>
  get(): Promise<WorkSnapshot | null>
}

export interface WorkControllerOptions {
  readonly createId?: () => string
}

export function createWorkController(options: WorkControllerOptions = {}): WorkController {
  const createId = options.createId ?? randomUUID
  let work: WorkSnapshot | null = null

  return {
    async create(spec) {
      if (work) throw new WorkError('work/already-exists', 'The first-phase product supports one Work.')
      work = Object.freeze({
        workId: createId(),
        title: spec.title,
        goal: spec.goal,
      })
      return work
    },

    async get() {
      return work
    },
  }
}
