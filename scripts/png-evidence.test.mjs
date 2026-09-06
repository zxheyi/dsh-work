import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { inspectPng } from './png-evidence.mjs'

test('inspectPng decodes a complete screenshot', () => {
  const screenshot = fs.readFileSync(path.resolve(import.meta.dirname, '../docs/design/familiar-v5/01-new-conversation.png'))
  const dimensions = inspectPng(screenshot, 'design screenshot')
  assert.ok(dimensions.width >= 390)
  assert.ok(dimensions.height >= 390)
})

test('inspectPng rejects a signature and dimensions masquerading as a PNG', () => {
  const forged = Buffer.alloc(24)
  Buffer.from('89504e470d0a1a0a', 'hex').copy(forged)
  forged.writeUInt32BE(1200, 16)
  forged.writeUInt32BE(800, 20)
  assert.throws(() => inspectPng(forged, 'forged screenshot'), /truncated file/u)
})

test('inspectPng rejects a screenshot with a corrupt chunk checksum', () => {
  const screenshot = Buffer.from(fs.readFileSync(path.resolve(import.meta.dirname, '../docs/design/familiar-v5/01-new-conversation.png')))
  screenshot[29] ^= 0xff
  assert.throws(() => inspectPng(screenshot, 'corrupt screenshot'), /checksum mismatch/u)
})
