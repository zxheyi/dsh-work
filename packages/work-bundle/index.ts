import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import z from 'zod'

import {
  createDomainWorkStore,
  createHarnessWorkPort,
  createWorkController,
  type HarnessWorkContext,
  type WorkController,
  type WorkDomainGlobal,
} from '../work-domain/index.ts'

const workspaceSchema = z.object({
  workspaceId: z.string().min(1),
  path: z.string().min(1),
})
const primarySessionSchema = z.object({
  sessionId: z.string().min(1),
  turnCount: z.number().int().nonnegative(),
})
const resourceSchema = z.object({
  resourceId: z.string().regex(/^[a-f0-9]{64}$/u),
  kind: z.literal('file'),
  name: z.string().min(1).max(200),
  path: z.string().min(1),
  bytes: z.number().int().positive().max(25 * 1024 * 1024),
  mediaType: z.string().min(1).max(128).nullable(),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/u),
})
const deliverableSchema = z.object({
  kind: z.literal('file'),
  path: z.string().min(1),
})
const failureSchema = z.object({
  requestId: z.string().min(1),
  message: z.string().min(1),
})
const importSourceSchema = z.object({
  sourceSystem: z.enum(['dsh', 'dsh-desktop', 'other']),
  sourceSessionId: z.string().min(1).nullable(),
  sourceVersion: z.string().min(1).nullable(),
  importedAt: z.iso.datetime(),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/u),
})
const workSnapshotSchema = z.object({
  workId: z.string().min(1),
  revision: z.number().int().positive(),
  title: z.string(),
  goal: z.string(),
  workspace: workspaceSchema,
  primarySession: primarySessionSchema,
  resources: z.array(resourceSchema).max(20).default([]),
  deliverable: deliverableSchema.nullable(),
  status: z.enum(['working', 'awaiting-review', 'completed', 'delivered']),
  execution: z.enum(['idle', 'failed']),
  lastFailure: failureSchema.nullable(),
  lastMutationId: z.string().min(1).nullable().default(null),
  lastMutationDigest: z.string().regex(/^[a-f0-9]{64}$/u).nullable().default(null),
  importSource: importSourceSchema.nullable().default(null),
})

export const workDomainSpec = defineDomain({
  name: 'dsh_work',
  version: 1,
  global: {
    schema: z.object({ work: workSnapshotSchema.nullable() }),
    initial: { work: null },
  },
  tables: {},
})

interface WorkBundleContext extends HarnessWorkContext {
  readonly dshHomePath: (...segments: string[]) => string
  readonly storageDomain: {
    open(spec: typeof workDomainSpec): Promise<{
      readonly global: WorkDomainGlobal
      close(): Promise<void>
    }>
  }
  provide(name: string, service: WorkController): unknown
  effect(execute: () => () => Promise<void>): unknown
}

export const inject = ['dshHomePath', 'storageDomain', 'workspaceRegistry', 'sessionController']
export const name = 'dsh-work'

export async function apply(context: WorkBundleContext): Promise<void> {
  const domain = await context.storageDomain.open(workDomainSpec)
  context.effect(() => () => domain.close())
  const controller = createWorkController({
    workspaceRoot: context.dshHomePath('workspaces'),
    deliveryRoot: context.dshHomePath('deliveries'),
    harness: createHarnessWorkPort(context),
    store: createDomainWorkStore(domain.global),
  })
  await controller.initialize()
  context.provide('workController', controller)
}
