// Research fixture only. All lifecycle execution remains owned by Harness.
import { exitOnStdinEnd } from '@deepseek-ai/dsh-cmdline'

export default async function lifecycleProbe(ctx, config = {}) {
  if (!ctx.appReady || !ctx.appExit) throw new Error('required public lifecycle service unavailable')
  const emit = event => process.stdout.write(`dsh-work-probe:${event}\n`)
  let active = true
  const abort = new AbortController()
  emit('loaded')
  exitOnStdinEnd(ctx, 'dsh-work-lifecycle-probe')
  ctx.effect(() => ctx.appReady.onReady(() => {
    void (async () => {
      if (config.web) {
        // Use only public services. Auth values remain inside this test child;
        // stdout reports facts, never launch URLs, cookies, or credentials.
        if (ctx.webServer.host !== '127.0.0.1') throw new Error('non-loopback bind')
        const origin = `http://127.0.0.1:${ctx.webServer.port}`
        const request = (url, options) => fetch(url, {
          ...options, redirect: 'manual', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]),
        })
        const denied = await request(origin)
        await denied.body?.cancel()
        if (denied.status !== 401) throw new Error('unauthenticated root was not denied')
        const exchange = await request(ctx.connection.authenticatedUrl(origin))
        await exchange.body?.cancel()
        const cookies = exchange.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
        const destination = new URL(exchange.headers.get('location'), origin)
        if (exchange.status !== 303 || !cookies || destination.href !== `${origin}/`) {
          throw new Error('unexpected auth exchange')
        }
        const page = await request(destination, { headers: { cookie: cookies } })
        const body = await page.text()
        if (page.status !== 200 || !body.toLowerCase().includes('<!doctype html')) {
          throw new Error('authenticated HTML unavailable')
        }
        if (!active) return
        emit('authenticated')
      }
      if (active) emit('ready')
    })().catch(() => { if (active) ctx.appExit(1) })
  }))
  ctx.effect(() => () => { active = false; abort.abort(); emit('disposed'); process.stdin.pause() })
  // The public EOF helper deliberately does not consume stdin. This fixture
  // owns an otherwise-unused input pipe; it carries no user/Agent protocol.
  process.stdin.resume()
  if (config.rejectStartup) {
    await new Promise(resolve => setTimeout(resolve, 50))
    emit('rejected')
    throw new Error('dsh-work-probe: deliberate startup rejection')
  }
}
