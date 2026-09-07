import path from 'node:path'

import { createOfficialLauncher, prepareProductProfile } from '../runtime-host/official-launcher.ts'
import { readStartupSelection, resolveSelectedProfile } from '../runtime-profile/preferences.ts'
import { prepareShadowProfile, type PreparedRuntimeProfile } from '../runtime-profile/shadow.ts'
import { createGenerationStore } from './generation-store.ts'
import { GUARDIAN_PROTOCOL, validGuardianCommand } from './protocol.ts'
import { createGuardianService } from './service.ts'

const productRoot = process.argv[2]
if (!productRoot || !path.isAbsolute(productRoot) || !process.send) process.exit(2)

const plans = new Map<string, PreparedRuntimeProfile>()
const service = createGuardianService({
  store: createGenerationStore(productRoot),
  prepare(home) {
    const selection = readStartupSelection(productRoot)
    const source = resolveSelectedProfile(selection)
    if (selection?.kind === 'shared' && !source) throw new Error('selected Profile unavailable')
    const plan = source ? prepareShadowProfile(home, source) : (() => {
      prepareProductProfile(home)
      return Object.freeze({ home, profile: 'dsh-work' as const, patches: Object.freeze([]) })
    })()
    plans.set(home, plan)
  },
  launcher(home) {
    const plan = plans.get(home)
    if (!plan) throw new Error('runtime Profile unavailable')
    return createOfficialLauncher({ node: process.execPath, ...plan })
  },
})

const send = (message: object): void => {
  if (process.connected) {
    try { process.send!(message, () => {}) } catch {}
  }
}

service.subscribe(value => send({ protocol: GUARDIAN_PROTOCOL, event: 'status', value }))
service.subscribeSurface(url => send({ protocol: GUARDIAN_PROTOCOL, event: 'surface', url }))
process.on('message', async (message: unknown) => {
  if (!validGuardianCommand(message)) {
    process.disconnect()
    return
  }
  const result = message.command === 'snapshot' ? service.snapshot() : await service[message.command]()
  send({ protocol: GUARDIAN_PROTOCOL, id: message.id, result })
})
process.once('disconnect', async () => {
  await service.dispose()
  process.exit(0)
})
send({ protocol: GUARDIAN_PROTOCOL, event: 'guardian-ready', value: service.snapshot() })
