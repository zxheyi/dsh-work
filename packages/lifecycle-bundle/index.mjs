import { exitOnStdinEnd } from '@deepseek-ai/dsh-cmdline'

export default function lifecycle(ctx) {
  if (!process.send || !ctx.appReady || !ctx.appExit) throw new Error('desktop lifecycle unavailable')
  const emit = event => {
    if (!process.connected) return
    // Channel disappearance is normal when the host exits. EOF remains the
    // shutdown authority; no referenced IPC listener keeps this child alive.
    try { process.send({ protocol: 'dsh-work.lifecycle.v1', event }, () => {}) } catch {}
  }
  exitOnStdinEnd(ctx, 'dsh-work')
  ctx.effect(() => ctx.appReady.onReady(() => emit('ready')))
  ctx.effect(() => () => { emit('disposed'); process.stdin.pause() })
  // DSH Work owns this otherwise-empty control pipe, never an Agent protocol.
  process.stdin.resume()
}
