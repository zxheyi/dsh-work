import assert from 'node:assert/strict'
import test from 'node:test'

import { WorkError, createWorkController } from '../packages/work-domain/index.ts'

test('creates the only Work and returns it through the public controller', async () => {
  const controller = createWorkController({ createId: () => 'work-1' })

  const created = await controller.create({
    title: 'Prepare launch brief',
    goal: 'Produce a launch brief that is ready to deliver.',
  })

  assert.deepEqual(created, {
    workId: 'work-1',
    title: 'Prepare launch brief',
    goal: 'Produce a launch brief that is ready to deliver.',
  })
  assert.deepEqual(await controller.get(), created)
})

test('rejects a second Work instead of silently replacing the first one', async () => {
  const controller = createWorkController({ createId: () => 'work-1' })
  await controller.create({ title: 'First', goal: 'Keep this Work.' })

  await assert.rejects(
    controller.create({ title: 'Second', goal: 'Replace the Work.' }),
    (error: unknown) => error instanceof WorkError && error.code === 'work/already-exists',
  )
  assert.equal((await controller.get())?.title, 'First')
})
