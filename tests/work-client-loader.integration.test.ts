import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

import { createOfficialLauncher, prepareDevelopmentProfile } from '../packages/runtime-host/official-launcher.ts'
import { createRuntimeHost, type RuntimeHost } from '../packages/runtime-host/index.ts'
import { removeOwnedTestHome } from './support/owned-test-home.ts'

async function reserveLoopbackPort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  })
  return address.port
}

test('real Profile serves and registers the Work Client bundle through Harness Loader', {
  timeout: 45_000,
}, async () => {
  const node = process.env.DSH_WORK_NODE
  assert.ok(node, 'explicit standalone Node is required; no global fallback')
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-client-loader-'))
  let host: RuntimeHost | null = null
  try {
    prepareDevelopmentProfile(home)
    const patchPath = path.join(home, 'profiles/dsh-work/cordis.patch.yml')
    const patch = JSON.parse(fs.readFileSync(patchPath, 'utf8')) as Array<{
      id?: string
      config?: { printUrl?: boolean }
    }>
    const webRuntime = patch.find(row => row.id === 'web-runtime')
    assert.ok(webRuntime?.config)
    webRuntime.config.printUrl = true
    fs.writeFileSync(patchPath, JSON.stringify(patch))
    const port = await reserveLoopbackPort()
    const launch = createOfficialLauncher({ node, home, port })
    let resolveUrl!: (url: string) => void
    const announcedUrl = new Promise<string>(resolve => {
      resolveUrl = resolve
    })
    host = createRuntimeHost({ launch: () => {
      const child = launch()
      let stdout = ''
      child.stdout.on('data', bytes => {
        stdout = `${stdout}${bytes.toString('utf8')}`.slice(-4_096)
        const match = stdout.match(/dsh web: (http:\/\/[^\s]+)/)
        if (match?.[1]) resolveUrl(match[1])
      })
      child.stderr.resume()
      return child
    } })
    assert.equal((await host.start()).state, 'ready')

    const origin = `http://127.0.0.1:${String(port)}`
    let announcementTimer: NodeJS.Timeout | undefined
    const authenticated = await Promise.race([
      announcedUrl,
      new Promise<never>((_, reject) => {
        announcementTimer = setTimeout(
          () => reject(new Error('Harness did not announce its authenticated URL')),
          5_000,
        )
      }),
    ])
    if (announcementTimer) clearTimeout(announcementTimer)
    const exchange = await fetch(authenticated, { redirect: 'manual' })
    assert.equal(exchange.status, 303)
    const cookie = exchange.headers.get('set-cookie')?.split(';', 1)[0]
    assert.ok(cookie)
    const index = await fetch(origin, { headers: { cookie } })
    assert.equal(index.ok, true, `Harness index returned HTTP ${String(index.status)}`)
    const html = await index.text()
    assert.match(html, /@dsh-work\/work-api/)

    const registrations: string[] = []
    const browserGlobal: {
      __DSH_BOOT__?: {
        readonly batches?: ReadonlyArray<{ readonly entries?: readonly string[]; readonly url?: string }>
      }
      readonly __ModuleLoader__: { load(value: { readonly id: string }): void }
      window?: unknown
    } = {
      __ModuleLoader__: {
        load(value) {
          registrations.push(value.id)
        },
      },
    }
    browserGlobal.window = browserGlobal
    const context = vm.createContext(browserGlobal)
    for (const match of html.matchAll(/<script(?![^>]+src=)[^>]*>([\s\S]*?)<\/script>/g)) {
      const inline = match[1] ?? ''
      if (!inline.includes('__DSH_BOOT__')) continue
      new vm.Script(inline, { filename: 'index-inline.js' }).runInContext(context)
    }
    const workBatch = browserGlobal.__DSH_BOOT__?.batches?.find(batch =>
      batch.entries?.includes('@dsh-work/work-api'))
    assert.ok(workBatch?.url, 'Harness boot graph must schedule the Work Client bundle')

    for (const source of [workBatch.url]) {
      const response = await fetch(new URL(source, origin))
      assert.equal(response.ok, true, source)
      new vm.Script(await response.text(), { filename: source }).runInContext(context)
    }

    assert.ok(registrations.includes('@dsh-work/work-api'))
  } finally {
    await host?.stop()
    removeOwnedTestHome(home)
  }
})
