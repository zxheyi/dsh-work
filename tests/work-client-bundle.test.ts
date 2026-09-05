import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

test('builds Work Client API as a Harness ModuleLoader bundle', async () => {
  const manifest = JSON.parse(fs.readFileSync(
    new URL('../packages/work-api/package.json', import.meta.url),
    'utf8',
  ))
  assert.equal(manifest.exports['./client'], './client.js')
  assert.deepEqual(manifest.dsh.client, {
    external: ['@deepseek-ai/dsh-api-gateway/client', 'react'],
    inject: [
      '@deepseek-ai/dsh-api-gateway',
      '@deepseek-ai/dsh-client-connection',
      '@deepseek-ai/dsh-client-ui-layout',
      '@deepseek-ai/dsh-client-ui-renderer',
      '@deepseek-ai/dsh-client-ui-sidebar',
    ],
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
  class RemoteSnapshotStream {
    start(): void {}
    async dispose(): Promise<void> {}
  }
  class RemoteStreamCarrierError extends Error {}
  const exports = registration!.factory(specifier => {
    if (specifier === '@deepseek-ai/cordis') return { Service }
    if (specifier === '@deepseek-ai/dsh-api-gateway/client') {
      return { RemoteSnapshotStream, RemoteStreamCarrierError }
    }
    if (specifier === 'react') return {
      createElement() {},
      useCallback(value: unknown) { return value },
      useEffect() {},
      useMemo(value: () => unknown) { return value() },
      useRef(value: unknown) { return { current: value } },
      useState(value: unknown) { return [value, () => {}] },
      useSyncExternalStore(_subscribe: unknown, getSnapshot: () => unknown) { return getSnapshot() },
    }
    throw new Error(`unexpected Work Client external: ${specifier}`)
  }) as {
    apply?: (ctx: unknown) => Promise<() => Promise<void>>
    inject?: unknown
  }
  assert.equal(typeof exports.apply, 'function')
  assert.deepEqual(Array.from(exports.inject as string[]), ['remote', 'slots'])

  const injectedSlots: string[] = []
  const injectedServices: string[][] = []
  const registeredSlots: Array<{ name: string; priority?: number }> = []
  const remote = {
    async $mount() { return async () => {} },
    $stream() { return {} },
    work: {
      async create() { throw new Error('not called') },
      async importConversation() { throw new Error('not called') },
      async dispatch() { throw new Error('not called') },
      async importSessionResource() { throw new Error('not called') },
      async list() { return { ok: true, value: { items: [] } } },
      async *follow() {},
    },
  }
  let scopedDispose: (() => Promise<void> | void) | undefined
  const clientContext = {
    remote,
    inject(deps: string[], apply: (ctx: unknown) => (() => Promise<void> | void)) {
      injectedServices.push(deps)
      scopedDispose = apply(clientContext)
      return {
        then(resolve: () => void) { resolve() },
        async dispose() { await scopedDispose?.() },
      }
    },
    slots: {
      inject(name: string, register: () => void) {
        injectedSlots.push(name)
        register()
      },
      register(options: { name: string; priority?: number }) {
        registeredSlots.push({
          name: options.name,
          ...(options.priority === undefined ? {} : { priority: options.priority }),
        })
        return () => {}
      },
    },
  }
  const dispose = await exports.apply!(clientContext)
  assert.deepEqual(injectedServices.map(value => Array.from(value)), [['remote.work']])
  assert.deepEqual(injectedSlots, [
    'sidebar.brand.name',
    'conversation.input.left',
    'sidebar.brand.mark',
    'sidebar.footer.action',
    'shell.overlay',
  ])
  assert.deepEqual(registeredSlots, [
    { name: 'sidebar.brand.name', priority: -100 },
    { name: 'conversation.input.left' },
    { name: 'sidebar.brand.mark', priority: -100 },
    { name: 'sidebar.footer.action' },
    { name: 'shell.overlay' },
  ])
  assert.match(source, /data-dsh-work-brand/)
  assert.match(source, /data-work-legacy-deliverable-open/)
  assert.match(source, /data-work-legacy-deliverable-preview/)
  assert.match(source, /data-work-session-resource/)
  assert.equal(source.includes('data-work-legacy-open'), false)
  assert.equal(source.includes('data-work-legacy-surface'), false)
  assert.equal(source.includes('你想完成什么？'), false)
  await dispose()
  assert.equal(source.includes('node:crypto'), false)
  assert.equal(source.includes('/Users/'), false)
})
