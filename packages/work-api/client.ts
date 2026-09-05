import type { Context } from '@deepseek-ai/cordis'
import {
  RemoteSnapshotStream,
  RemoteStreamCarrierError,
  type ClientRemote,
} from '@deepseek-ai/dsh-api-gateway/client'
import type { WorkRemoteFollowFrame } from './index.ts'
import { ClientWorkModel, WorksController } from './client-model.ts'
import { TYPERT_REMOTE } from './remote.ts'
import { registerWorkSurface } from './surface.ts'

export * from './client-model.ts'

type WorkBaselineFrame = Extract<WorkRemoteFollowFrame, { readonly type: 'baseline' }>
type WorkIncrementFrame = Extract<WorkRemoteFollowFrame, { readonly type: 'upsert' }>

export type WorkStateStream = RemoteSnapshotStream<WorkBaselineFrame, WorkIncrementFrame>

export function createWorkStateStream(
  remote: ClientRemote,
  model: ClientWorkModel,
): WorkStateStream {
  return new RemoteSnapshotStream<WorkBaselineFrame, WorkIncrementFrame>(remote.$stream({
    name: 'Work state stream',
    open: signal => remote.work.follow(signal),
    ended: accepted => accepted
      ? new RemoteStreamCarrierError('Work state stream ended without a terminal result')
      : new Error('Work state stream ended before its opening snapshot'),
    carrierFailed: () => {
      model.handleCarrierFailure()
    },
  }), {
    name: 'Work state stream',
    isSnapshot: (frame): frame is WorkBaselineFrame => frame.type === 'baseline',
    replace: frame => {
      model.replaceBaseline(frame.value)
    },
    update: frame => {
      model.upsertView(frame.work)
    },
    failed: error => {
      model.handleStreamFailure(error)
    },
  })
}

export const inject = ['remote', 'slots', 'layout']

export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE)
  const workScope = ctx.inject(['remote.work', 'layout'], workCtx => {
    const model = new ClientWorkModel(workCtx.remote.work)
    const works = new WorksController(workCtx, model)
    const disposeSurface = registerWorkSurface(workCtx, works)
    const control = createWorkStateStream(workCtx.remote, model)
    control.start()
    return async () => {
      await control.dispose()
      disposeSurface()
    }
  })
  try {
    await workScope
  } catch (error) {
    await disposeRemote()
    throw error
  }
  return async () => {
    await workScope.dispose()
    await disposeRemote()
  }
}
