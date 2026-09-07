export const WORK_RECOVERY_CONTEXT_PREFIX = 'dsh-work-recovery:v1:'

const MAX_CONTEXT_BYTES = 64 * 1024
export const MAX_RECOVERY_REVISION_LEASES = 8
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

export interface WorkRecoveryRevisionLease {
  readonly sessionId: string
  readonly preparedAfterTurn: number
  readonly leaseId: string
  readonly expectedContentDigest: string
  readonly path: string
  readonly rejected: {
    readonly turn: number
    readonly leaseId: string
    readonly expectedContentDigest: string
  } | null
}

export interface WorkRecoveryContext {
  readonly schema: 'dsh-work.recovery-context.v1'
  readonly sessionId: string
  readonly draft: string
  readonly selection: WorkRecoveryOutputSelection | null
  readonly revisionLeases: readonly WorkRecoveryRevisionLease[]
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

const validRevisionLease = (value: unknown): value is WorkRecoveryContext['revisionLeases'][number] =>
  exactKeys(value, [
    'sessionId', 'preparedAfterTurn', 'leaseId', 'expectedContentDigest', 'path', 'rejected',
  ])
  && boundedString(value.sessionId, MAX_SESSION_ID)
  && Number.isSafeInteger(value.preparedAfterTurn) && (value.preparedAfterTurn as number) >= 0
  && typeof value.leaseId === 'string' && /^[a-f0-9]{32}$/u.test(value.leaseId)
  && typeof value.expectedContentDigest === 'string'
  && /^[a-f0-9]{64}$/u.test(value.expectedContentDigest)
  && boundedString(value.path, MAX_PATH)
  && (value.rejected === null || (
    exactKeys(value.rejected, ['turn', 'leaseId', 'expectedContentDigest'])
    && Number.isSafeInteger(value.rejected.turn) && (value.rejected.turn as number) >= 0
    && typeof value.rejected.leaseId === 'string' && /^[a-f0-9]{32}$/u.test(value.rejected.leaseId)
    && typeof value.rejected.expectedContentDigest === 'string'
    && /^[a-f0-9]{64}$/u.test(value.rejected.expectedContentDigest)
  ))

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
  if (!(exactKeys(parsed, ['schema', 'sessionId', 'draft', 'selection'])
      || exactKeys(parsed, ['schema', 'sessionId', 'draft', 'selection', 'revisionLeases']))
    || parsed.schema !== 'dsh-work.recovery-context.v1'
    || !boundedString(parsed.sessionId, MAX_SESSION_ID)
    || !boundedString(parsed.draft, MAX_DRAFT, true)
    || (parsed.selection !== null && !validSelection(parsed.selection))
    || ('revisionLeases' in parsed && (!Array.isArray(parsed.revisionLeases)
      || parsed.revisionLeases.length > MAX_RECOVERY_REVISION_LEASES
      || !parsed.revisionLeases.every(validRevisionLease)
      || new Set(parsed.revisionLeases.map(lease => lease.sessionId)).size !== parsed.revisionLeases.length))) return null
  if (parsed.selection && parsed.selection.sessionId !== parsed.sessionId) return null
  const revisionLeases = 'revisionLeases' in parsed && Array.isArray(parsed.revisionLeases)
    ? Object.freeze(parsed.revisionLeases.map(lease => Object.freeze({ ...lease })))
    : Object.freeze([])
  return Object.freeze({
    schema: parsed.schema,
    sessionId: parsed.sessionId,
    draft: parsed.draft,
    selection: parsed.selection ? Object.freeze({ ...parsed.selection }) : null,
    revisionLeases,
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

export function mergeWorkRecoveryRevisionLease(
  sessionId: string,
  retained: WorkRecoveryRevisionLease | undefined,
  next: Omit<WorkRecoveryRevisionLease, 'sessionId'>,
): WorkRecoveryRevisionLease {
  return Object.freeze({
    sessionId,
    ...next,
    rejected: next.rejected ?? retained?.rejected ?? null,
  })
}

export function workRecoveryRevisionLeaseForTurn(
  retained: WorkRecoveryRevisionLease | undefined,
  turn: number,
): Pick<WorkRecoveryRevisionLease, 'leaseId' | 'expectedContentDigest' | 'path'> | null {
  if (!retained) return null
  if (retained.rejected?.turn === turn) return Object.freeze({
    leaseId: retained.rejected.leaseId,
    expectedContentDigest: retained.rejected.expectedContentDigest,
    path: retained.path,
  })
  if (turn <= retained.preparedAfterTurn) return null
  return Object.freeze({
    leaseId: retained.leaseId,
    expectedContentDigest: retained.expectedContentDigest,
    path: retained.path,
  })
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
