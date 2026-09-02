import { exitOnStdinEnd } from '@deepseek-ai/dsh-cmdline'

type LifecycleContext = Parameters<typeof exitOnStdinEnd>[0]
type LifecycleEvent = 'ready' | 'disposed'

interface DesktopSurfaceContext extends LifecycleContext {
  readonly connection?: { authenticatedUrl(baseUrl: string): string }
  readonly webServer?: { readonly host: string; readonly port?: number }
}

export const inject = ['appReady', 'appExit', 'connection', 'webServer'] as const
export const name = 'dsh-work-lifecycle'

export function apply(ctx: DesktopSurfaceContext): void {
  const appReady = ctx.appReady
  if (!process.send || !appReady || !ctx.appExit || !ctx.connection || !ctx.webServer) {
    throw new Error('desktop lifecycle unavailable')
  }
  const emit = (event: LifecycleEvent): void => {
    if (!process.connected) return
    // Channel disappearance is normal when the host exits. EOF remains the
    // shutdown authority; no referenced IPC listener keeps this child alive.
    try { process.send!({ protocol: 'dsh-work.lifecycle.v1', event }, () => {}) } catch {}
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
    emitSurface()
    emit('ready')
  }))
  ctx.effect(() => () => {
    emit('disposed')
    process.stdin.pause()
  })
  // DSH Work owns this otherwise-empty control pipe, never an Agent protocol.
  process.stdin.resume()
}
