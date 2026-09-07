import { exitOnStdinEnd } from '@deepseek-ai/dsh-cmdline'

type LifecycleContext = Parameters<typeof exitOnStdinEnd>[0]
type LifecycleEvent = 'ready' | 'disposed'
type AgentStatus = 'idle' | 'running'

interface DesktopSurfaceContext extends LifecycleContext {
  readonly connection?: { authenticatedUrl(baseUrl: string): string }
  readonly webServer?: { readonly host: string; readonly port?: number }
  readonly agents?: { list(): readonly { readonly status?: AgentStatus }[] }
}

interface AgentEventContext {
  on(event: 'agent/status', listener: (payload: { readonly status: AgentStatus }) => void): () => void
}

export const inject = ['appReady', 'appExit', 'connection', 'webServer', 'agents'] as const
export const name = 'dsh-work-lifecycle'

export const hasActiveAgent = (agents: readonly { readonly status?: AgentStatus }[]): boolean =>
  agents.some(agent => agent.status === 'running')

export function apply(ctx: DesktopSurfaceContext): void {
  const appReady = ctx.appReady
  if (!process.send || !appReady || !ctx.appExit || !ctx.connection || !ctx.webServer || !ctx.agents) {
    throw new Error('desktop lifecycle unavailable')
  }
  const emit = (event: LifecycleEvent): void => {
    if (!process.connected) return
    // Channel disappearance is normal when the host exits. EOF remains the
    // shutdown authority; no referenced IPC listener keeps this child alive.
    try { process.send!({ protocol: 'dsh-work.lifecycle.v1', event }, () => {}) } catch {}
  }
  let lastActive: boolean | null = null
  const emitActivity = (): void => {
    const active = hasActiveAgent(ctx.agents!.list())
    if (active === lastActive) return
    lastActive = active
    if (!process.connected) return
    try { process.send!({ protocol: 'dsh-work.lifecycle.v1', event: 'activity', active }, () => {}) } catch {}
  }
  const emitSurface = (): void => {
    const port = ctx.webServer?.port
    if (ctx.webServer?.host !== '127.0.0.1' || !Number.isSafeInteger(port) || !port) {
      throw new Error('desktop surface unavailable')
    }
    const url = ctx.connection!.authenticatedUrl(`http://127.0.0.1:${String(port)}`)
    if (!process.connected) return
    try { process.send!({ protocol: 'dsh-work.lifecycle.v1', event: 'surface', url }, () => {}) } catch {}
  }
  exitOnStdinEnd(ctx, 'dsh-work')
  ctx.effect(() => appReady.onReady(() => {
    emitActivity()
    emitSurface()
    emit('ready')
  }))
  ;(ctx as unknown as AgentEventContext).on('agent/status', emitActivity)
  ctx.effect(() => () => {
    if (lastActive) {
      lastActive = false
      try { process.send!({ protocol: 'dsh-work.lifecycle.v1', event: 'activity', active: false }, () => {}) } catch {}
    }
    emit('disposed')
    process.stdin.pause()
  })
  // DSH Work owns this otherwise-empty control pipe, never an Agent protocol.
  process.stdin.resume()
}
