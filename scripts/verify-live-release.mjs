import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const root = path.resolve(import.meta.dirname, '..')
export function validateLiveReceipts(receipts) {
  const [live, desktop, relaunch] = receipts
  for (const receipt of receipts) {
    assert.equal(receipt.status, 'pass', 'Every live acceptance entry must pass')
    assert.equal(receipt.fixtureModel, false)
    assert.equal(receipt.runId, live.runId, 'Do not combine separate live runs')
  }
  for (const step of ['fresh-model-setup-ui', 'first-live-response', 'attachment-generate', 'revision-save',
    'restart-persistence', 'wrong-key', 'wrong-key-recovery', 'connection-refused', 'connection-refused-recovery']) {
    assert.ok(live.completed.includes(step), `Missing live acceptance: ${step}`)
  }
  assert.ok(desktop.completed.includes('reuse-profile') && desktop.completed.includes('active-window-close'))
  assert.ok(relaunch.completed.includes('background-result-retained-after-quit'))
  for (const receipt of [desktop, relaunch]) {
    assert.equal(receipt.sourceProfileUnchanged, true)
    assert.equal(receipt.clonedProfileUnchanged, true)
    assert.equal(receipt.cleanShutdown, true)
    assert.equal(receipt.priorCleanRecovered, true)
  }
}
export function verifyLiveRelease(directory) {
  const receipt = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'))
  validateLiveReceipts(receipt.executions)
  const mandatory = ['package.json', 'pnpm-lock.yaml', 'scripts/run-live-release-test.mjs',
    'tests/live-release-e2e.ts', 'tests/live-desktop-lifecycle-e2e.ts', 'tests/support/live-release-evidence.ts']
  for (const file of mandatory) assert.ok(receipt.sourceDigests[file], `Missing source digest: ${file}`)
  for (const [file, expected] of Object.entries(receipt.sourceDigests)) {
    const absolute = path.resolve(root, file)
    assert.ok(absolute.startsWith(root + path.sep))
    assert.equal(createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'), expected, `Stale live evidence: ${file}`)
  }
  for (const [file, expected] of Object.entries(receipt.evidenceDigests)) {
    assert.equal(path.basename(file), file)
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(directory, file))).digest('hex'), expected)
  }
  return receipt
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  verifyLiveRelease(path.join(root, 'docs/acceptance/release-0.0.1-evidence'))
  console.log('Live functional evidence verified; public distribution materials and F13 are separate gates.')
}
