import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import z from 'zod'

import type {
  WorkCreateSpec,
  WorkDispatchRequest,
  WorkListValue,
  WorkRemoteFollowFrame,
  WorkView,
} from './index.ts'

const deliverableSchema = z.object({
  kind: z.literal('file'),
  path: z.string().min(1),
}).strict()
const failureSchema = z.object({ message: z.string().min(1) }).strict()
const workViewSchema: z.ZodType<WorkView> = z.object({
  workId: z.string().min(1),
  revision: z.number().int().positive(),
  title: z.string(),
  goal: z.string(),
  turnCount: z.number().int().nonnegative(),
  deliverable: deliverableSchema.nullable(),
  status: z.enum(['working', 'awaiting-review', 'completed', 'delivered']),
  execution: z.enum(['idle', 'failed']),
  lastFailure: failureSchema.nullable(),
}).strict()
const createSchema: z.ZodType<WorkCreateSpec> = z.object({
  title: z.string(),
  goal: z.string(),
}).strict()
const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('submit-turn'), instruction: z.string() }).strict(),
  z.object({ type: z.literal('record-file'), path: z.string() }).strict(),
  z.object({ type: z.literal('complete') }).strict(),
  z.object({ type: z.literal('deliver') }).strict(),
])
const dispatchSchema: z.ZodType<WorkDispatchRequest> = z.object({
  workId: z.string().min(1),
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
      dispatch: TypertRemoteMap['work/dispatch']
      list: TypertRemoteMap['work/list']
      follow: TypertRemoteMap['work/follow']
    }
  }
}

export default TYPERT_REMOTE
