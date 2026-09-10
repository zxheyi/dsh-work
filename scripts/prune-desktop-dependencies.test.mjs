import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pruneDesktopDependencies } from './prune-desktop-dependencies.mjs'

test('pruning retains runtime sources, notices, binaries and current PTY; removes only reviewed files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-prune-'))
  try {
    const write = file => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), 'fixture') }
    const removed = ['node-pty/prebuilds/win32-x64/pty.node', 'node-pty/lib/unixTerminal.test.js', '@mixmark-io/domino/test/fixture.html', 'sdk/index.js.map', 'sdk/types.d.ts.map']
    const kept = ['node-pty/prebuilds/darwin-arm64/pty.node', 'node-pty/prebuilds/darwin-arm64/spawn-helper', 'node-pty/lib/unixTerminal.js', 'sdk/LICENSE', 'sdk/README.md', 'sdk/index.js', 'sdk/index.ts', 'sdk/types.d.ts', 'sdk/data.map', 'sdk/test/runtime.js']
    for (const file of [...removed, ...kept]) write(file)
    const result = pruneDesktopDependencies(root, 'darwin', 'arm64')
    for (const file of removed) assert.equal(fs.existsSync(path.join(root, file)), false, file)
    for (const file of kept) assert.equal(fs.existsSync(path.join(root, file)), true, file)
    assert.ok(result.bytesRemoved > 0)
    assert.equal(pruneDesktopDependencies(root, 'darwin', 'arm64').bytesRemoved, 0)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('pruning does not follow dependency symlinks outside staging', () => {
  if (process.platform === 'win32') return
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-prune-link-'))
  try {
    fs.mkdirSync(path.join(root, 'modules'))
    fs.writeFileSync(path.join(root, 'keep.js.map'), 'external')
    fs.symlinkSync(root, path.join(root, 'modules/link'))
    pruneDesktopDependencies(path.join(root, 'modules'), 'darwin', 'arm64')
    assert.equal(fs.readFileSync(path.join(root, 'keep.js.map'), 'utf8'), 'external')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
