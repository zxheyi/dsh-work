import assert from 'node:assert/strict'
import test from 'node:test'
import { signingOptions } from './package-desktop.mjs'

test('signed packaging refuses missing credentials and unsupported platforms', () => {
  assert.throws(() => signingOptions(true, 'darwin', {}), /Developer ID/)
  assert.throws(() => signingOptions(true, 'win32', {}), /macOS/)
  assert.deepEqual(signingOptions(false, 'darwin', {}), {})
  assert.throws(() => signingOptions(true, 'darwin', { DSH_WORK_SIGN_IDENTITY: 'Apple Development: Example' }), /Developer ID/)
  assert.throws(() => signingOptions(true, 'darwin', { DSH_WORK_SIGN_IDENTITY: 'Developer ID Application: Example' }), /keychain/)
})
