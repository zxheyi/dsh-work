import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import z from 'zod'

import type {
  WorkAdoptSessionOutputVersionSpec,
  WorkCreateSpec,
  WorkDispatchRequest,
  WorkImportConversationSpec,
  WorkImportSessionResourceSpec,
  WorkInspectSessionOutputSourcesSpec,
  WorkInspectSessionOutputsSpec,
  WorkListSessionOutputVersionsSpec,
  WorkPrepareSessionOutputRevisionSpec,
  WorkSaveSessionOutputSpec,
  WorkShowSessionOutputSaveSpec,
  WorkReadSessionOutputSpec,
  WorkReadSessionOutputVersionSpec,
  WorkListValue,
  WorkDeliverableContent,
  WorkReadDeliverableRequest,
  WorkShowDeliveryRequest,
  WorkShowDeliveryValue,
  WorkSessionFileResource,
  WorkSessionOutputAdoption,
  WorkSessionOutputFile,
  WorkSessionOutputContent,
  WorkSessionOutputSource,
  WorkSessionOutputRevision,
  WorkSessionOutputRevisionFailure,
  WorkSessionOutputVersion,
  WorkSessionOutputVersionContent,
  WorkSessionOutputVersionsValue,
  WorkSessionOutputSave,
  WorkShowSessionOutputSaveValue,
  WorkSessionOutputSourcesValue,
  WorkSessionOutputsValue,
  WorkRemoteFollowFrame,
  WorkView,
} from './index.ts'

const deliverableSchema = z.object({
  kind: z.literal('file'),
  path: z.string().min(1),
}).strict()
const failureSchema = z.object({ message: z.string().min(1) }).strict()
const resourceSchema = z.object({
  resourceId: z.string().regex(/^[a-f0-9]{64}$/u),
  kind: z.literal('file'),
  name: z.string().min(1).max(200),
  path: z.string().min(1),
  bytes: z.number().int().positive().max(25 * 1024 * 1024),
  mediaType: z.string().min(1).max(128).nullable(),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict()
const workViewSchema: z.ZodType<WorkView> = z.object({
  workId: z.string().min(1),
  revision: z.number().int().positive(),
  title: z.string(),
  goal: z.string(),
  turnCount: z.number().int().nonnegative(),
  resources: z.array(resourceSchema).max(20),
  deliverable: deliverableSchema.nullable(),
  status: z.enum(['working', 'awaiting-review', 'completed', 'delivered']),
  execution: z.enum(['idle', 'failed']),
  lastFailure: failureSchema.nullable(),
}).strict()
const createSchema: z.ZodType<WorkCreateSpec> = z.object({
  title: z.string(),
  goal: z.string(),
}).strict()
const importConversationSchema = z.object({
  title: z.string().min(1).max(200),
  goal: z.string().min(1).max(10_000),
  source: z.object({
    sourceSystem: z.enum(['dsh', 'dsh-desktop', 'other']),
    sourceSessionId: z.string().min(1).max(256).optional(),
    sourceVersion: z.string().min(1).max(128).optional(),
    content: z.string().min(1).max(100_000),
  }).strict(),
}).strict()
const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('submit-turn'), instruction: z.string() }).strict(),
  z.object({
    type: z.literal('produce-markdown'),
    instruction: z.string().min(1).max(20_000),
  }).strict(),
  z.object({
    type: z.literal('revise-markdown'),
    instruction: z.string().min(1).max(20_000),
  }).strict(),
  z.object({
    type: z.literal('add-file-resource'),
    name: z.string().min(1).max(200),
    mediaType: z.string().min(1).max(128).optional(),
    dataBase64: z.string().min(1).max(Math.ceil((25 * 1024 * 1024) / 3) * 4),
  }).strict(),
  z.object({ type: z.literal('record-file'), path: z.string() }).strict(),
  z.object({ type: z.literal('complete') }).strict(),
  z.object({ type: z.literal('deliver') }).strict(),
])
const dispatchSchema: z.ZodType<WorkDispatchRequest> = z.object({
  workId: z.string().min(1),
  mutationId: z.string().min(1).max(128),
  expectedRevision: z.number().int().positive(),
  command: commandSchema,
}).strict()
const readDeliverableRequestSchema: z.ZodType<WorkReadDeliverableRequest> = z.object({
  workId: z.string().min(1),
}).strict()
const deliverableContentSchema: z.ZodType<WorkDeliverableContent> = z.object({
  path: z.string().min(1),
  content: z.string().min(1).max(5 * 1024 * 1024),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict()
const showDeliveryValueSchema: z.ZodType<WorkShowDeliveryValue> = z.object({
  shown: z.literal(true),
}).strict()
const importSessionResourceSchema: z.ZodType<WorkImportSessionResourceSpec> = z.object({
  sessionId: z.string().min(1).max(256),
  name: z.string().min(1).max(200),
  mediaType: z.string().min(1).max(128).optional(),
  dataBase64: z.string().min(1).max(Math.ceil((25 * 1024 * 1024) / 3) * 4),
}).strict()
const sessionFileResourceSchema: z.ZodType<WorkSessionFileResource> = z.object({
  sessionId: z.string().min(1).max(256),
  name: z.string().min(1).max(200),
  path: z.string().min(1),
  bytes: z.number().int().positive().max(25 * 1024 * 1024),
  mediaType: z.string().min(1).max(128).nullable(),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict()
const sessionOutputRevisionLeaseSchema = z.object({
  leaseId: z.string().regex(/^[a-f0-9]{32}$/u),
  expectedContentDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  path: z.string().min(1).max(4096),
}).strict()
const inspectSessionOutputsSchema: z.ZodType<WorkInspectSessionOutputsSpec> = z.object({
  sessionId: z.string().min(1).max(256),
  turn: z.number().int().nonnegative(),
  throughSeq: z.number().int().nonnegative(),
  revisionLease: sessionOutputRevisionLeaseSchema.optional(),
}).strict()
const sessionOutputFileSchema: z.ZodType<WorkSessionOutputFile> = z.object({
  sessionId: z.string().min(1).max(256),
  turn: z.number().int().nonnegative(),
  name: z.string().min(1).max(512),
  path: z.string().min(1).max(4096),
  bytes: z.number().int().positive(),
  mediaType: z.string().min(1).max(128).nullable(),
}).strict()
const sessionOutputsValueSchema: z.ZodType<WorkSessionOutputsValue> = z.object({
  items: z.array(sessionOutputFileSchema).max(64),
}).strict()
const sessionOutputSourceSchema: z.ZodType<WorkSessionOutputSource> = z.object({
  sessionId: z.string().min(1).max(256),
  turn: z.number().int().nonnegative(),
  name: z.string().min(1).max(200),
  path: z.string().min(1).max(4096),
  reference: z.string().min(2).max(4099),
  bytes: z.number().int().positive().max(25 * 1024 * 1024).nullable(),
  mediaType: z.string().min(1).max(128).nullable(),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  status: z.enum(['verified', 'unverified', 'missing', 'changed', 'inaccessible']),
}).strict()
const sessionOutputSourcesValueSchema: z.ZodType<WorkSessionOutputSourcesValue> = z.object({
  items: z.array(sessionOutputSourceSchema).max(20),
}).strict()
const readSessionOutputSchema: z.ZodType<WorkReadSessionOutputSpec> = z.object({
  sessionId: z.string().min(1).max(256),
  turn: z.number().int().nonnegative(),
  throughSeq: z.number().int().nonnegative(),
  path: z.string().min(1).max(4096),
}).strict()
const sessionOutputVersionIdentitySchema = z.object({
  fileId: z.string().regex(/^[a-f0-9]{32}$/u),
  versionId: z.string().regex(/^[a-f0-9]{32}$/u),
}).strict()
const saveSessionOutputSchema: z.ZodType<WorkSaveSessionOutputSpec> = z.object({
  sessionId: z.string().min(1).max(256),
  turn: z.number().int().nonnegative(),
  throughSeq: z.number().int().nonnegative(),
  path: z.string().min(1).max(4096),
  version: sessionOutputVersionIdentitySchema.optional(),
}).strict()
const prepareSessionOutputRevisionSchema: z.ZodType<WorkPrepareSessionOutputRevisionSpec> = z.object({
  sessionId: z.string().min(1).max(256),
  turn: z.number().int().nonnegative(),
  throughSeq: z.number().int().nonnegative(),
  path: z.string().min(1).max(4096),
  baseVersion: sessionOutputVersionIdentitySchema.optional(),
  intent: z.enum(['modify', 'restore']).optional(),
}).strict()
const sessionOutputRevisionBaseVersionSchema = z.object({
  fileId: z.string().regex(/^[a-f0-9]{32}$/u),
  versionId: z.string().regex(/^[a-f0-9]{32}$/u),
  ordinal: z.number().int().positive().max(512),
  path: z.string().min(1).max(4096),
  reference: z.string().min(2).max(4099),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict()
const sessionOutputRevisionSchema: z.ZodType<WorkSessionOutputRevision> = z.object({
  sessionId: z.string().min(1).max(256),
  sourceTurn: z.number().int().nonnegative(),
  preparedAfterTurn: z.number().int().nonnegative(),
  name: z.string().min(1).max(512),
  path: z.string().min(1).max(4096),
  reference: z.string().min(2).max(4099),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  revisionLease: sessionOutputRevisionLeaseSchema,
  baseVersion: sessionOutputRevisionBaseVersionSchema.optional(),
  intent: z.literal('restore').optional(),
}).strict()
const sessionOutputRevisionFailureSchema: z.ZodType<WorkSessionOutputRevisionFailure> = z.object({
  sessionId: z.string().min(1).max(256),
  turn: z.number().int().nonnegative(),
  name: z.string().min(1).max(512),
  path: z.string().min(1).max(4096),
  reference: z.string().min(2).max(4099),
  status: z.literal('failed'),
  reason: z.enum(['invalid-output', 'conflict']),
  message: z.string().min(1).max(512),
}).strict()
const sessionOutputSaveSchema: z.ZodType<WorkSessionOutputSave> = z.object({
  sessionId: z.string().min(1).max(256),
  turn: z.number().int().nonnegative(),
  name: z.string().min(1).max(512),
  path: z.string().min(1).max(4096),
  bytes: z.number().int().positive().max(25 * 1024 * 1024),
  mediaType: z.string().min(1).max(128).nullable(),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  sourceVersion: z.object({
    fileId: z.string().regex(/^[a-f0-9]{32}$/u),
    versionId: z.string().regex(/^[a-f0-9]{32}$/u),
    ordinal: z.number().int().positive().max(512),
  }).strict().optional(),
  saveId: z.string().regex(/^[a-f0-9]{32}$/u),
  fileName: z.string().min(1).max(160),
  location: z.string().min(1).max(4096),
}).strict()
const showSessionOutputSaveSchema: z.ZodType<WorkShowSessionOutputSaveSpec> = z.object({
  saveId: z.string().regex(/^[a-f0-9]{32}$/u),
  fileName: z.string().min(1).max(160),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict()
const showSessionOutputSaveValueSchema: z.ZodType<WorkShowSessionOutputSaveValue> = z.object({
  shown: z.literal(true),
}).strict()
const sessionOutputContentSchema: z.ZodType<WorkSessionOutputContent> = z.object({
  sessionId: z.string().min(1).max(256),
  turn: z.number().int().nonnegative(),
  name: z.string().min(1).max(512),
  path: z.string().min(1).max(4096),
  bytes: z.number().int().positive(),
  mediaType: z.string().min(1).max(128).nullable(),
  content: z.string().min(1).max(5 * 1024 * 1024),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  sources: z.array(sessionOutputSourceSchema).max(20),
}).strict()
const listSessionOutputVersionsSchema: z.ZodType<WorkListSessionOutputVersionsSpec> = z.object({
  sessionId: z.string().min(1).max(256),
  path: z.string().min(1).max(4096),
}).strict()
const readSessionOutputVersionSchema: z.ZodType<WorkReadSessionOutputVersionSpec> = z.object({
  fileId: sessionOutputVersionIdentitySchema.shape.fileId,
  versionId: sessionOutputVersionIdentitySchema.shape.versionId,
}).strict()
const adoptSessionOutputVersionSchema: z.ZodType<WorkAdoptSessionOutputVersionSpec> =
  readSessionOutputVersionSchema
const sessionOutputAdoptionSchema: z.ZodType<WorkSessionOutputAdoption> = z.object({
  fileId: z.string().regex(/^[a-f0-9]{32}$/u),
  versionId: z.string().regex(/^[a-f0-9]{32}$/u),
  sessionId: z.string().min(1).max(256),
  path: z.string().min(1).max(4096),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  summary: z.string().min(1).max(101),
  adoptedAt: z.iso.datetime(),
}).strict()
const sessionOutputVersionObjectSchema = z.object({
  fileId: z.string().regex(/^[a-f0-9]{32}$/u),
  versionId: z.string().regex(/^[a-f0-9]{32}$/u),
  ordinal: z.number().int().positive().max(512),
  origin: z.enum(['generated', 'migration-baseline']),
  sessionId: z.string().min(1).max(256),
  turn: z.number().int().nonnegative().nullable(),
  throughSeq: z.number().int().nonnegative().nullable(),
  name: z.string().min(1).max(512),
  path: z.string().min(1).max(4096),
  bytes: z.number().int().positive().max(25 * 1024 * 1024),
  mediaType: z.string().min(1).max(128).nullable(),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  createdAt: z.iso.datetime(),
  sources: z.array(sessionOutputSourceSchema).max(20),
  adoption: sessionOutputAdoptionSchema.optional(),
}).strict()
const sessionOutputVersionSchema: z.ZodType<WorkSessionOutputVersion> = sessionOutputVersionObjectSchema
  .refine(value => (value.turn === null) === (value.throughSeq === null))
const sessionOutputVersionsValueSchema: z.ZodType<WorkSessionOutputVersionsValue> = z.object({
  items: z.array(sessionOutputVersionSchema).max(512),
}).strict()
const sessionOutputVersionContentSchema: z.ZodType<WorkSessionOutputVersionContent> = sessionOutputVersionObjectSchema.extend({
  content: z.string().min(1).max(5 * 1024 * 1024),
}).strict().refine(value => (value.turn === null) === (value.throughSeq === null))
const listSchema: z.ZodType<WorkListValue> = z.object({
  items: z.array(workViewSchema).max(1),
}).strict()
const followSchema: z.ZodType<WorkRemoteFollowFrame> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('baseline'), value: listSchema }).strict(),
  z.object({ type: z.literal('upsert'), work: workViewSchema }).strict(),
])

const strict = (typeSymbol: string, schema: z.ZodType): {
  readonly mode: 'strict'
  readonly typeSymbol: string
  readonly schema: z.ZodType
} => Object.freeze({ mode: 'strict', typeSymbol, schema })

export const TYPERT_REMOTE: TypertRemoteContribution = Object.freeze({
  package: '@dsh-work/work-api',
  descriptors: Object.freeze([
    Object.freeze({
      id: '@dsh-work/work-api#work/create',
      service: 'workApi',
      namespace: 'work',
      method: 'create',
      invocation: Object.freeze({ kind: 'direct' as const }),
      parameters: Object.freeze([Object.freeze({
        name: 'spec',
        wire: 'spec',
        source: 'json' as const,
        codec: strict('@dsh-work/work-api#WorkCreateSpec', createSchema),
      })]),
      result: strict('@dsh-work/work-api#WorkView', workViewSchema),
    }),
    Object.freeze({
      id: '@dsh-work/work-api#work/importConversation',
      service: 'workApi',
      namespace: 'work',
      method: 'importConversation',
      invocation: Object.freeze({ kind: 'direct' as const }),
      parameters: Object.freeze([Object.freeze({
        name: 'spec',
        wire: 'spec',
        source: 'json' as const,
        codec: strict(
          '@dsh-work/work-api#WorkImportConversationSpec',
          importConversationSchema,
        ),
      })]),
      cancellation: Object.freeze({ parameter: 'signal' as const }),
      result: strict('@dsh-work/work-api#WorkView', workViewSchema),
    }),
    Object.freeze({
      id: '@dsh-work/work-api#work/dispatch',
      service: 'workApi',
      namespace: 'work',
      method: 'dispatch',
      invocation: Object.freeze({ kind: 'direct' as const }),
      parameters: Object.freeze([Object.freeze({
        name: 'request',
        wire: 'request',
        source: 'json' as const,
        codec: strict('@dsh-work/work-api#WorkDispatchRequest', dispatchSchema),
      })]),
      cancellation: Object.freeze({ parameter: 'signal' as const }),
      result: strict('@dsh-work/work-api#WorkView', workViewSchema),
    }),
    Object.freeze({
      id: '@dsh-work/work-api#work/readDeliverable',
      service: 'workApi',
      namespace: 'work',
      method: 'readDeliverable',
      invocation: Object.freeze({ kind: 'direct' as const }),
      parameters: Object.freeze([Object.freeze({
        name: 'request',
        wire: 'request',
        source: 'json' as const,
        codec: strict('@dsh-work/work-api#WorkReadDeliverableRequest', readDeliverableRequestSchema),
      })]),
      result: strict('@dsh-work/work-api#WorkDeliverableContent', deliverableContentSchema),
    }),
    Object.freeze({
      id: '@dsh-work/work-api#work/showDelivery',
      service: 'workApi',
      namespace: 'work',
      method: 'showDelivery',
      invocation: Object.freeze({ kind: 'direct' as const }),
      parameters: Object.freeze([Object.freeze({
        name: 'request',
        wire: 'request',
        source: 'json' as const,
        codec: strict('@dsh-work/work-api#WorkShowDeliveryRequest', readDeliverableRequestSchema),
      })]),
      cancellation: Object.freeze({ parameter: 'signal' as const }),
      result: strict('@dsh-work/work-api#WorkShowDeliveryValue', showDeliveryValueSchema),
    }),
    Object.freeze({
      id: '@dsh-work/work-api#work/importSessionResource',
      service: 'workApi',
      namespace: 'work',
      method: 'importSessionResource',
      invocation: Object.freeze({ kind: 'direct' as const }),
      parameters: Object.freeze([Object.freeze({
        name: 'spec',
        wire: 'spec',
        source: 'json' as const,
        codec: strict('@dsh-work/work-api#WorkImportSessionResourceSpec', importSessionResourceSchema),
      })]),
      cancellation: Object.freeze({ parameter: 'signal' as const }),
      result: strict('@dsh-work/work-api#WorkSessionFileResource', sessionFileResourceSchema),
    }),
    Object.freeze({
      id: '@dsh-work/work-api#work/list',
      service: 'workApi',
      namespace: 'work',
      method: 'list',
      invocation: Object.freeze({ kind: 'direct' as const }),
      parameters: Object.freeze([]),
      result: strict('@dsh-work/work-api#WorkListValue', listSchema),
    }),
    Object.freeze({
      id: '@dsh-work/work-api#work/inspectSessionOutputs',
      service: 'workApi',
      namespace: 'work',
      method: 'inspectSessionOutputs',
      invocation: Object.freeze({ kind: 'direct' as const }),
      parameters: Object.freeze([Object.freeze({
        name: 'spec',
        wire: 'spec',
        source: 'json' as const,
        codec: strict('@dsh-work/work-api#WorkInspectSessionOutputsSpec', inspectSessionOutputsSchema),
      })]),
      cancellation: Object.freeze({ parameter: 'signal' as const }),
      result: strict('@dsh-work/work-api#WorkSessionOutputsValue', sessionOutputsValueSchema),
    }),
    Object.freeze({
      id: '@dsh-work/work-api#work/inspectSessionOutputSources',
      service: 'workApi',
      namespace: 'work',
      method: 'inspectSessionOutputSources',
      invocation: Object.freeze({ kind: 'direct' as const }),
      parameters: Object.freeze([Object.freeze({
        name: 'spec',
        wire: 'spec',
        source: 'json' as const,
        codec: strict('@dsh-work/work-api#WorkInspectSessionOutputSourcesSpec', inspectSessionOutputsSchema),
      })]),
      cancellation: Object.freeze({ parameter: 'signal' as const }),
      result: strict('@dsh-work/work-api#WorkSessionOutputSourcesValue', sessionOutputSourcesValueSchema),
    }),
    Object.freeze({
      id: '@dsh-work/work-api#work/readSessionOutput',
      service: 'workApi',
      namespace: 'work',
      method: 'readSessionOutput',
      invocation: Object.freeze({ kind: 'direct' as const }),
      parameters: Object.freeze([Object.freeze({
        name: 'spec',
        wire: 'spec',
        source: 'json' as const,
        codec: strict('@dsh-work/work-api#WorkReadSessionOutputSpec', readSessionOutputSchema),
      })]),
      cancellation: Object.freeze({ parameter: 'signal' as const }),
      result: strict('@dsh-work/work-api#WorkSessionOutputContent', sessionOutputContentSchema),
    }),
    Object.freeze({
      id: '@dsh-work/work-api#work/prepareSessionOutputRevision',
      service: 'workApi',
      namespace: 'work',
      method: 'prepareSessionOutputRevision',
      invocation: Object.freeze({ kind: 'direct' as const }),
      parameters: Object.freeze([Object.freeze({
        name: 'spec',
        wire: 'spec',
        source: 'json' as const,
        codec: strict('@dsh-work/work-api#WorkPrepareSessionOutputRevisionSpec', prepareSessionOutputRevisionSchema),
      })]),
      cancellation: Object.freeze({ parameter: 'signal' as const }),
      result: strict('@dsh-work/work-api#WorkSessionOutputRevision', sessionOutputRevisionSchema),
    }),
    Object.freeze({
      id: '@dsh-work/work-api#work/inspectSessionRevision',
      service: 'workApi',
      namespace: 'work',
      method: 'inspectSessionRevision',
      invocation: Object.freeze({ kind: 'direct' as const }),
      parameters: Object.freeze([Object.freeze({
        name: 'spec',
        wire: 'spec',
        source: 'json' as const,
        codec: strict('@dsh-work/work-api#WorkInspectSessionOutputsSpec', inspectSessionOutputsSchema),
      })]),
      cancellation: Object.freeze({ parameter: 'signal' as const }),
      result: strict(
        '@dsh-work/work-api#WorkSessionOutputRevisionFailure',
        sessionOutputRevisionFailureSchema.nullable(),
      ),
    }),
    Object.freeze({
      id: '@dsh-work/work-api#work/saveSessionOutput',
      service: 'workApi',
      namespace: 'work',
      method: 'saveSessionOutput',
      invocation: Object.freeze({ kind: 'direct' as const }),
      parameters: Object.freeze([Object.freeze({
        name: 'spec',
        wire: 'spec',
        source: 'json' as const,
        codec: strict('@dsh-work/work-api#WorkSaveSessionOutputSpec', saveSessionOutputSchema),
      })]),
      cancellation: Object.freeze({ parameter: 'signal' as const }),
      result: strict('@dsh-work/work-api#WorkSessionOutputSave', sessionOutputSaveSchema),
    }),
    Object.freeze({
      id: '@dsh-work/work-api#work/showSessionOutputSave',
      service: 'workApi',
      namespace: 'work',
      method: 'showSessionOutputSave',
      invocation: Object.freeze({ kind: 'direct' as const }),
      parameters: Object.freeze([Object.freeze({
        name: 'spec',
        wire: 'spec',
        source: 'json' as const,
        codec: strict('@dsh-work/work-api#WorkShowSessionOutputSaveSpec', showSessionOutputSaveSchema),
      })]),
      cancellation: Object.freeze({ parameter: 'signal' as const }),
      result: strict(
        '@dsh-work/work-api#WorkShowSessionOutputSaveValue',
        showSessionOutputSaveValueSchema,
      ),
    }),
    Object.freeze({
      id: '@dsh-work/work-api#work/listSessionOutputVersions',
      service: 'workApi',
      namespace: 'work',
      method: 'listSessionOutputVersions',
      invocation: Object.freeze({ kind: 'direct' as const }),
      parameters: Object.freeze([Object.freeze({
        name: 'spec',
        wire: 'spec',
        source: 'json' as const,
        codec: strict(
          '@dsh-work/work-api#WorkListSessionOutputVersionsSpec',
          listSessionOutputVersionsSchema,
        ),
      })]),
      cancellation: Object.freeze({ parameter: 'signal' as const }),
      result: strict(
        '@dsh-work/work-api#WorkSessionOutputVersionsValue',
        sessionOutputVersionsValueSchema,
      ),
    }),
    Object.freeze({
      id: '@dsh-work/work-api#work/readSessionOutputVersion',
      service: 'workApi',
      namespace: 'work',
      method: 'readSessionOutputVersion',
      invocation: Object.freeze({ kind: 'direct' as const }),
      parameters: Object.freeze([Object.freeze({
        name: 'spec',
        wire: 'spec',
        source: 'json' as const,
        codec: strict(
          '@dsh-work/work-api#WorkReadSessionOutputVersionSpec',
          readSessionOutputVersionSchema,
        ),
      })]),
      cancellation: Object.freeze({ parameter: 'signal' as const }),
      result: strict(
        '@dsh-work/work-api#WorkSessionOutputVersionContent',
        sessionOutputVersionContentSchema,
      ),
    }),
    Object.freeze({
      id: '@dsh-work/work-api#work/adoptSessionOutputVersion',
      service: 'workApi',
      namespace: 'work',
      method: 'adoptSessionOutputVersion',
      invocation: Object.freeze({ kind: 'direct' as const }),
      parameters: Object.freeze([Object.freeze({
        name: 'spec',
        wire: 'spec',
        source: 'json' as const,
        codec: strict(
          '@dsh-work/work-api#WorkAdoptSessionOutputVersionSpec',
          adoptSessionOutputVersionSchema,
        ),
      })]),
      cancellation: Object.freeze({ parameter: 'signal' as const }),
      result: strict('@dsh-work/work-api#WorkSessionOutputAdoption', sessionOutputAdoptionSchema),
    }),
    Object.freeze({
      id: '@dsh-work/work-api#work/follow',
      service: 'workApi',
      namespace: 'work',
      method: 'follow',
      mode: 'stream' as const,
      invocation: Object.freeze({ kind: 'direct' as const }),
      parameters: Object.freeze([]),
      cancellation: Object.freeze({ parameter: 'signal' as const }),
      result: strict('@dsh-work/work-api#WorkRemoteFollowFrame', followSchema),
    }),
  ]),
})

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'work/create': (spec: WorkCreateSpec) => Promise<RemoteResult<WorkView>>
    'work/importConversation': (
      spec: WorkImportConversationSpec,
      signal?: AbortSignal,
    ) => Promise<RemoteResult<WorkView>>
    'work/dispatch': (
      request: WorkDispatchRequest,
      signal?: AbortSignal,
    ) => Promise<RemoteResult<WorkView>>
    'work/readDeliverable': (
      request: WorkReadDeliverableRequest,
    ) => Promise<RemoteResult<WorkDeliverableContent>>
    'work/showDelivery': (
      request: WorkShowDeliveryRequest,
      signal?: AbortSignal,
    ) => Promise<RemoteResult<WorkShowDeliveryValue>>
    'work/importSessionResource': (
      spec: WorkImportSessionResourceSpec,
      signal?: AbortSignal,
    ) => Promise<RemoteResult<WorkSessionFileResource>>
    'work/inspectSessionOutputs': (
      spec: WorkInspectSessionOutputsSpec,
      signal?: AbortSignal,
    ) => Promise<RemoteResult<WorkSessionOutputsValue>>
    'work/inspectSessionOutputSources': (
      spec: WorkInspectSessionOutputSourcesSpec,
      signal?: AbortSignal,
    ) => Promise<RemoteResult<WorkSessionOutputSourcesValue>>
    'work/prepareSessionOutputRevision': (
      spec: WorkPrepareSessionOutputRevisionSpec,
      signal?: AbortSignal,
    ) => Promise<RemoteResult<WorkSessionOutputRevision>>
    'work/inspectSessionRevision': (
      spec: WorkInspectSessionOutputsSpec,
      signal?: AbortSignal,
    ) => Promise<RemoteResult<WorkSessionOutputRevisionFailure | null>>
    'work/saveSessionOutput': (
      spec: WorkSaveSessionOutputSpec,
      signal?: AbortSignal,
    ) => Promise<RemoteResult<WorkSessionOutputSave>>
    'work/showSessionOutputSave': (
      spec: WorkShowSessionOutputSaveSpec,
      signal?: AbortSignal,
    ) => Promise<RemoteResult<WorkShowSessionOutputSaveValue>>
    'work/listSessionOutputVersions': (
      spec: WorkListSessionOutputVersionsSpec,
      signal?: AbortSignal,
    ) => Promise<RemoteResult<WorkSessionOutputVersionsValue>>
    'work/readSessionOutputVersion': (
      spec: WorkReadSessionOutputVersionSpec,
      signal?: AbortSignal,
    ) => Promise<RemoteResult<WorkSessionOutputVersionContent>>
    'work/adoptSessionOutputVersion': (
      spec: WorkAdoptSessionOutputVersionSpec,
      signal?: AbortSignal,
    ) => Promise<RemoteResult<WorkSessionOutputAdoption>>
    'work/readSessionOutput': (
      spec: WorkReadSessionOutputSpec,
      signal?: AbortSignal,
    ) => Promise<RemoteResult<WorkSessionOutputContent>>
    'work/list': () => Promise<RemoteResult<WorkListValue>>
    'work/follow': (signal?: AbortSignal) => AsyncIterable<WorkRemoteFollowFrame>
  }

  interface TypertRemoteNamespaceMap {
    work: {
      create: TypertRemoteMap['work/create']
      importConversation: TypertRemoteMap['work/importConversation']
      dispatch: TypertRemoteMap['work/dispatch']
      readDeliverable: TypertRemoteMap['work/readDeliverable']
      showDelivery: TypertRemoteMap['work/showDelivery']
      importSessionResource: TypertRemoteMap['work/importSessionResource']
      inspectSessionOutputs: TypertRemoteMap['work/inspectSessionOutputs']
      inspectSessionOutputSources: TypertRemoteMap['work/inspectSessionOutputSources']
      prepareSessionOutputRevision: TypertRemoteMap['work/prepareSessionOutputRevision']
      inspectSessionRevision: TypertRemoteMap['work/inspectSessionRevision']
      saveSessionOutput: TypertRemoteMap['work/saveSessionOutput']
      showSessionOutputSave: TypertRemoteMap['work/showSessionOutputSave']
      listSessionOutputVersions: TypertRemoteMap['work/listSessionOutputVersions']
      readSessionOutputVersion: TypertRemoteMap['work/readSessionOutputVersion']
      adoptSessionOutputVersion: TypertRemoteMap['work/adoptSessionOutputVersion']
      readSessionOutput: TypertRemoteMap['work/readSessionOutput']
      list: TypertRemoteMap['work/list']
      follow: TypertRemoteMap['work/follow']
    }
  }
}

export default TYPERT_REMOTE
