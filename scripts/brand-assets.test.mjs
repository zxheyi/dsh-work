import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
const read = relative => fs.readFileSync(new URL(`../${relative}`, import.meta.url))
test('approved brand assets have native formats and matching embedded UI artwork', () => {
  const icon = read('assets/brand/app-icon.png')
  assert.equal(icon.subarray(1, 4).toString(), 'PNG')
  assert.equal(icon.readUInt32BE(16), 1024)
  assert.equal(icon.readUInt32BE(20), 1024)
  assert.equal(icon[25], 6, 'system icon retains alpha')
  const icns = read('assets/brand/app-icon.icns')
  assert.equal(icns.subarray(0, 4).toString(), 'icns')
  assert.equal(icns.readUInt32BE(4), icns.length)
  const ico = read('assets/brand/app-icon.ico')
  assert.equal(ico.readUInt16LE(2), 1)
  assert.ok(ico.readUInt16LE(4) >= 6)
  const embedded = read('packages/work-api/brand-assets.ts').toString().match(/base64,([^']+)/)[1]
  assert.deepEqual(Buffer.from(embedded, 'base64'), read('assets/brand/work-whale.png'))
})
