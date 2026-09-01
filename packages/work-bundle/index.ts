import path from 'node:path'

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
const deliverableSchema = z.object({
  kind: z.literal('file'),
  path: z.string().min(1),
})
const workSnapshotSchema = z.object({
  workId: z.string().min(1),
  title: z.string(),
  goal: z.string(),
  workspace: workspaceSchema,
  primarySession: primarySessionSchema,
  deliverable: deliverableSchema.nullable(),
  status: z.enum(['working', 'awaiting-review', 'completed', 'delivered']),
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
  readonly dshHomePath: string
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

export default async function workBundle(context: WorkBundleContext): Promise<void> {
  const domain = await context.storageDomain.open(workDomainSpec)
  context.effect(() => () => domain.close())
  context.provide('workController', createWorkController({
    workspaceRoot: path.join(context.dshHomePath, 'workspaces'),
    harness: createHarnessWorkPort(context),
    store: createDomainWorkStore(domain.global),
  }))
}
