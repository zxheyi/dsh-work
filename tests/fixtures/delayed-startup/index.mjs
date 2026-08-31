// Test-only external plugin. Harness still owns all startup and disposal.
export default async function delayedStartup(ctx, config) {
  process.stdout.write('dsh-work-delay:loaded\n')
  await new Promise(resolve => setTimeout(resolve, 9_000))
  process.stdout.write(`dsh-work-delay:${config.reject ? 'rejected' : 'completed'}\n`)
  if (config.reject) throw new Error('deliberate delayed startup rejection')
}
