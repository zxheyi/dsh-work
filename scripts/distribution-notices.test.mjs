import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { inventoryPackages } from './distribution-notices.mjs'
test('inventory covers scoped and nested installed packages and reports missing texts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-notices-'))
  try {
    const add = (relative, name, license, text) => {
      const p = path.join(root, relative); fs.mkdirSync(p, { recursive: true })
      fs.writeFileSync(path.join(p, 'package.json'), JSON.stringify({ name, version: '1.0.0', license }))
      if (text) fs.writeFileSync(path.join(p, 'LICENSE'), text)
    }
    add('node_modules/a', 'a', 'MIT', 'Copyright Example')
    add('node_modules/a/node_modules/@scope/b', '@scope/b', 'BSD-3-Clause')
    const packages = inventoryPackages(root)
    assert.equal(packages.length, 2)
    assert.equal(packages.find(p => p.name === 'a').notices.length, 1)
    assert.equal(packages.find(p => p.name === '@scope/b').notices.length, 0)
    add('node_modules/unknown', 'unknown', undefined)
    assert.throws(() => inventoryPackages(root), /license metadata/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
