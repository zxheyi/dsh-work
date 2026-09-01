import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

test('product dependencies match the accepted baseline with a frozen DSH family', () => {
  const baseline = JSON.parse(fs.readFileSync(new URL('../runtime/baseline.json', import.meta.url)))
  const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)))
  const lock = fs.readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8')
  assert.equal(manifest.packageManager, `pnpm@${baseline.runtime.pnpm}`)
  assert.deepEqual(manifest.dependencies, {
    '@deepseek-ai/cordis': '4.0.2',
    '@deepseek-ai/dsh': baseline.runtime.version,
    '@deepseek-ai/dsh-api-gateway': baseline.runtime.version,
    '@deepseek-ai/dsh-cmdline': baseline.runtime.version,
    '@deepseek-ai/dsh-storage-domain': baseline.runtime.version,
    '@deepseek-ai/dsh-typert-protocol': baseline.runtime.version,
    zod: '4.5.4',
  })
  assert.deepEqual(manifest.devDependencies, {
    '@types/node': '24.13.3',
    electron: baseline.electron,
    tsdown: '0.22.2',
    typescript: '7.0.2',
  })
  assert.ok(lock.includes(baseline.runtime.integrity))
  const family = [...lock.matchAll(/^  '@deepseek-ai\/(dsh(?:-[^@']+)?)@([^':(]+)(?:\([^']*\))?':/gm)]
  assert.ok(family.length >= 215)
  for (const [, name, version] of family) assert.equal(version, baseline.runtime.version, name)
})
