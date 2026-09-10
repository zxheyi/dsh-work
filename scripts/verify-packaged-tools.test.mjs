import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { completeToolProbe } from './verify-packaged-tools.mjs'

test('completed tool probe flushes evidence and exits even when native worker handles remain', () => {
  const script = `setInterval(() => {}, 1000); (${completeToolProbe.toString()})({ pty: true });`
  const stdout = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 3000 })
  assert.deepEqual(JSON.parse(stdout), { pty: true })
})
