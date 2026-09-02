import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import z from 'zod'

import type {
  WorkCreateSpec,
  WorkDispatchRequest,
  WorkImportConversationSpec,
  WorkListValue,
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
      id: '@dsh-work/work-api#work/list',
      service: 'workApi',
      namespace: 'work',
      method: 'list',
      invocation: Object.freeze({ kind: 'direct' as const }),
      parameters: Object.freeze([]),
      result: strict('@dsh-work/work-api#WorkListValue', listSchema),
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
    'work/list': () => Promise<RemoteResult<WorkListValue>>
    'work/follow': (signal?: AbortSignal) => AsyncIterable<WorkRemoteFollowFrame>
  }

  interface TypertRemoteNamespaceMap {
    work: {
      create: TypertRemoteMap['work/create']
      importConversation: TypertRemoteMap['work/importConversation']
      dispatch: TypertRemoteMap['work/dispatch']
      list: TypertRemoteMap['work/list']
      follow: TypertRemoteMap['work/follow']
    }
  }
}

export default TYPERT_REMOTE
