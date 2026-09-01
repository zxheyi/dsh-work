import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { removeOwnedTestHome } from './support/owned-test-home.ts'

test('owned test home cleanup detaches nested directory links without traversing their targets', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-link-target-'))
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-owned-home-'))
  try {
    fs.writeFileSync(path.join(target, 'retained.txt'), 'retained')
    const nested = path.join(home, 'profiles/node_modules/@deepseek-ai')
    fs.mkdirSync(nested, { recursive: true })
    fs.symlinkSync(target, path.join(nested, 'package'), 'junction')
    assert.equal(removeOwnedTestHome(home), 1)
    assert.equal(fs.existsSync(home), false)
    assert.equal(fs.readFileSync(path.join(target, 'retained.txt'), 'utf8'), 'retained')
  } finally {
    fs.rmSync(target, { recursive: true, force: true })
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('owned test home cleanup refuses a directory outside the test namespace', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'other-owned-home-'))
  try {
    assert.throws(() => removeOwnedTestHome(directory), /only a direct dsh-work test home/)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('owned test home cleanup refuses a linked root', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-root-target-'))
  const linkedRoot = path.join(os.tmpdir(), `dsh-work-linked-root-${randomUUID()}`)
  try {
    fs.symlinkSync(target, linkedRoot, 'junction')
    assert.throws(() => removeOwnedTestHome(linkedRoot), /test home must be an owned directory/)
  } finally {
    if (fs.existsSync(linkedRoot)) fs.unlinkSync(linkedRoot)
    fs.rmSync(target, { recursive: true, force: true })
  }
})
