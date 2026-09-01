import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

test('builds Work Client API as a Harness ModuleLoader bundle', () => {
  const manifest = JSON.parse(fs.readFileSync(
    new URL('../packages/work-api/package.json', import.meta.url),
    'utf8',
  ))
  assert.equal(manifest.exports['./client'], './client.js')
  assert.deepEqual(manifest.dsh.client, {
    external: ['@deepseek-ai/dsh-api-gateway/client'],
    inject: ['@deepseek-ai/dsh-api-gateway', '@deepseek-ai/dsh-client-connection'],
    platform: 'web',
  })

  const source = fs.readFileSync(new URL('../dist/packages/work-api/client.js', import.meta.url), 'utf8')
  let registration: { id: string; factory: (require: (id: string) => unknown) => unknown } | undefined
  const context = vm.createContext({
    window: {
      __ModuleLoader__: {
        load(value: typeof registration) {
          registration = value
        },
      },
    },
  })
  new vm.Script(source, { filename: 'work-api/client.js' }).runInContext(context)

  assert.equal(registration?.id, '@dsh-work/work-api')
  assert.equal(typeof registration?.factory, 'function')
  class Service {}
  class RemoteSnapshotStream {}
  class RemoteStreamCarrierError extends Error {}
  const exports = registration!.factory(specifier => {
    if (specifier === '@deepseek-ai/cordis') return { Service }
    if (specifier === '@deepseek-ai/dsh-api-gateway/client') {
      return { RemoteSnapshotStream, RemoteStreamCarrierError }
    }
    throw new Error(`unexpected Work Client external: ${specifier}`)
  }) as { apply?: unknown; inject?: unknown }
  assert.equal(typeof exports.apply, 'function')
  assert.deepEqual(Array.from(exports.inject as string[]), ['remote'])
  assert.equal(source.includes('node:crypto'), false)
  assert.equal(source.includes('/Users/'), false)
})
