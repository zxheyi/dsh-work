export const WORK_RECOVERY_CONTEXT_PREFIX = 'dsh-work-recovery:v1:'

const MAX_CONTEXT_BYTES = 32 * 1024
const MAX_SESSION_ID = 256
const MAX_DRAFT = 20 * 1024
const MAX_NAME = 512
const MAX_PATH = 4 * 1024
const MAX_MEDIA_TYPE = 256

export interface WorkRecoveryOutputSelection {
  readonly sessionId: string
  readonly turn: number
  readonly throughSeq: number
  readonly name: string
  readonly path: string
  readonly bytes: number
  readonly mediaType: string | null
}

export interface WorkRecoveryContext {
  readonly schema: 'dsh-work.recovery-context.v1'
  readonly sessionId: string
  readonly draft: string
  readonly selection: WorkRecoveryOutputSelection | null
}

export type WorkRecoverySessionDisposition = 'wait' | 'open' | 'discard'

const exactKeys = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())

const boundedString = (value: unknown, maximum: number, allowEmpty = false): value is string =>
  typeof value === 'string' && value.length <= maximum && (allowEmpty || value.length > 0)

const validSelection = (value: unknown): value is WorkRecoveryOutputSelection =>
  exactKeys(value, ['sessionId', 'turn', 'throughSeq', 'name', 'path', 'bytes', 'mediaType'])
  && boundedString(value.sessionId, MAX_SESSION_ID)
  && Number.isSafeInteger(value.turn) && (value.turn as number) >= 0
  && Number.isSafeInteger(value.throughSeq) && (value.throughSeq as number) >= 0
  && boundedString(value.name, MAX_NAME)
  && boundedString(value.path, MAX_PATH)
  && Number.isSafeInteger(value.bytes) && (value.bytes as number) > 0
  && (value.mediaType === null || boundedString(value.mediaType, MAX_MEDIA_TYPE))

export function serializeWorkRecoveryContext(value: WorkRecoveryContext): string {
  const encoded = `${WORK_RECOVERY_CONTEXT_PREFIX}${JSON.stringify(value)}`
  if (encoded.length > MAX_CONTEXT_BYTES || !parseWorkRecoveryContext(encoded)) return ''
  return encoded
}

export function parseWorkRecoveryContext(value: unknown): WorkRecoveryContext | null {
  if (!boundedString(value, MAX_CONTEXT_BYTES) || !value.startsWith(WORK_RECOVERY_CONTEXT_PREFIX)) return null
  let parsed: unknown
  try { parsed = JSON.parse(value.slice(WORK_RECOVERY_CONTEXT_PREFIX.length)) }
  catch { return null }
  if (!exactKeys(parsed, ['schema', 'sessionId', 'draft', 'selection'])
    || parsed.schema !== 'dsh-work.recovery-context.v1'
    || !boundedString(parsed.sessionId, MAX_SESSION_ID)
    || !boundedString(parsed.draft, MAX_DRAFT, true)
    || (parsed.selection !== null && !validSelection(parsed.selection))) return null
  if (parsed.selection && parsed.selection.sessionId !== parsed.sessionId) return null
  return Object.freeze({
    schema: parsed.schema,
    sessionId: parsed.sessionId,
    draft: parsed.draft,
    selection: parsed.selection ? Object.freeze({ ...parsed.selection }) : null,
  })
}

export function matchesWorkRecoveryOutput(
  retained: WorkRecoveryOutputSelection,
  candidate: WorkRecoveryOutputSelection,
): boolean {
  return retained.sessionId === candidate.sessionId
    && retained.turn === candidate.turn
    && retained.throughSeq === candidate.throughSeq
    && retained.path === candidate.path
    && retained.bytes === candidate.bytes
    && retained.name === candidate.name
    && retained.mediaType === candidate.mediaType
}

export function recoveredDraftForSession(
  retained: Pick<WorkRecoveryContext, 'sessionId' | 'draft'> | null,
  sessionId: string,
  currentDraft: string,
): string {
  return retained?.sessionId === sessionId && currentDraft.length === 0
    ? retained.draft
    : currentDraft
}

export function recoverySessionDisposition(
  retainedSessionId: string,
  snapshot: {
    readonly phase: 'pending' | 'ready'
    readonly byId: Readonly<Record<string, unknown>>
  },
): WorkRecoverySessionDisposition {
  if (Object.prototype.hasOwnProperty.call(snapshot.byId, retainedSessionId)) return 'open'
  return snapshot.phase === 'pending' ? 'wait' : 'discard'
}
