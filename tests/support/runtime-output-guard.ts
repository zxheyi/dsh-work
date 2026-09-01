// Test-output guard, not a general-purpose credential sanitizer. Raw output is
// never published; these patterns make known launch-token leaks fail the smoke.
type OutputStream = 'stdout' | 'stderr'

export function createOutputGuard(limit = 64 * 1024) {
  let bytes = 0, sensitive = false, overflow = false
  const tails: Record<OutputStream, string> = { stdout: '', stderr: '' }
  return {
    observe(chunk: Buffer, stream: OutputStream = 'stdout'): void {
      bytes += chunk.length
      if (bytes > limit) { overflow = true; tails.stdout = ''; tails.stderr = ''; return }
      const sample = tails[stream] + chunk.toString('utf8')
      sensitive ||= /[?&]token=|set-cookie\s*:|authorization\s*:\s*bearer/i.test(sample)
      tails[stream] = sample.slice(-128)
    },
    status(): Readonly<{ sensitive: boolean; overflow: boolean }> { return { sensitive, overflow } },
  }
}
