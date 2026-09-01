import path from 'node:path'

import { createOfficialLauncher, prepareProductProfile } from '../runtime-host/official-launcher.ts'
import { createGenerationStore } from './generation-store.ts'
import { GUARDIAN_PROTOCOL, validGuardianCommand } from './protocol.ts'
import { createGuardianService } from './service.ts'

const productRoot = process.argv[2]
if (!productRoot || !path.isAbsolute(productRoot) || !process.send) process.exit(2)

const service = createGuardianService({
  store: createGenerationStore(productRoot),
  prepare: prepareProductProfile,
  launcher: home => createOfficialLauncher({ node: process.execPath, home }),
})

const send = (message: object): void => {
  if (process.connected) {
    try { process.send!(message, () => {}) } catch {}
  }
}

service.subscribe(value => send({ protocol: GUARDIAN_PROTOCOL, event: 'status', value }))
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
