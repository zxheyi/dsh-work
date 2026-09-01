import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { requiredFiles, verifyContract, verifyMarkdownLinks } from './verify-contract.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('the checked-in repository contract is internally consistent', () => {
  assert.deepEqual(verifyContract(repositoryRoot), [])
})

test('missing contract files fail verification', () => {
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-contract-'))
  try {
    const errors = verifyContract(emptyRoot)
    assert.ok(errors.some((error) => error === 'missing required file: AGENTS.md'))
    assert.ok(errors.some((error) => error === 'missing required file: docs/workflow.md'))
    assert.ok(errors.some((error) => error === 'missing required file: docs/workflow-v1.zh-CN.md'))
    assert.ok(errors.some((error) => error === 'missing required file: .github/branch-protection.json'))
    assert.ok(errors.some((error) => error === 'missing required file: scripts/verify-pr-contract.mjs'))
  } finally {
    fs.rmSync(emptyRoot, { recursive: true, force: true })
  }
})

test('broken relative Markdown links fail verification', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-links-'))
  try {
    const errors = verifyMarkdownLinks(root, 'docs/example.md', '[missing](./not-found.md)')
    assert.deepEqual(errors, ['docs/example.md: broken relative link "./not-found.md"'])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('removing the no-reimplementation boundary fails verification', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-boundary-'))
  try {
    for (const relativePath of requiredFiles) {
      const target = path.join(root, relativePath)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(path.join(repositoryRoot, relativePath), target)
    }

    const agentsPath = path.join(root, 'AGENTS.md')
    const agents = fs
      .readFileSync(agentsPath, 'utf8')
      .replace('Compose Harness; do not reimplement it.', 'Compose Harness.')
    fs.writeFileSync(agentsPath, agents)

    const errors = verifyContract(root)
    assert.ok(
      errors.includes('AGENTS.md: missing required contract text "Compose Harness; do not reimplement it."'),
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('changing an accepted architecture decision fails verification', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-decisions-'))
  try {
    for (const relativePath of requiredFiles) {
      const target = path.join(root, relativePath)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(path.join(repositoryRoot, relativePath), target)
    }

    const target = path.join(root, 'docs/decisions/0001-electron-desktop-host.md')
    const original = fs.readFileSync(target, 'utf8')
    fs.writeFileSync(target, original.replace('Status: accepted', 'Status: proposed'))

    assert.ok(
      verifyContract(root).includes(
        'docs/decisions/0001-electron-desktop-host.md: missing required contract text "Status: accepted"',
      ),
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('every active runtime baseline field is locked to the accepted decision', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-baseline-'))
  try {
    for (const relativePath of requiredFiles) {
      const target = path.join(root, relativePath)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(path.join(repositoryRoot, relativePath), target)
    }

    const target = path.join(root, 'runtime/baseline.json')
    const original = JSON.parse(fs.readFileSync(target, 'utf8'))
    const paths = [
      ['status'], ['decision'], ['electron'],
      ...['repository', 'tag', 'commit'].map((key) => ['source', key]),
      ...['package', 'version', 'integrity', 'node', 'pnpm', 'tarball'].map((key) => ['runtime', key]),
      ...Object.keys(original.runtime.nodeArtifacts).flatMap((platform) =>
        ['filename', 'sha256'].map((key) => ['runtime', 'nodeArtifacts', platform, key])),
    ]
    for (const keys of paths) {
      const changed = structuredClone(original)
      let parent = changed
      for (const key of keys.slice(0, -1)) parent = parent[key]
      parent[keys.at(-1)] = 'unlocked'
      fs.writeFileSync(target, JSON.stringify(changed))
      assert.ok(
        verifyContract(root).includes('runtime/baseline.json: active selection does not match accepted decisions'),
        keys.join('.'),
      )
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('removing the Harness-native lifecycle boundary fails verification', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-lifecycle-'))
  try {
    for (const relativePath of requiredFiles) {
      const target = path.join(root, relativePath)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(path.join(repositoryRoot, relativePath), target)
    }

    const target = path.join(root, 'packages/lifecycle-bundle/index.mjs')
    const original = fs.readFileSync(target, 'utf8')
    fs.writeFileSync(target, original.replace('ctx.appReady.onReady', 'ctx.internalReady.onReady'))

    assert.ok(
      verifyContract(root).includes(
        'packages/lifecycle-bundle/index.mjs: missing required contract text "ctx.appReady.onReady"',
      ),
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('weakening the accepted crash-recovery ownership boundary fails verification', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-ownership-'))
  try {
    for (const relativePath of requiredFiles) {
      const target = path.join(root, relativePath)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(path.join(repositoryRoot, relativePath), target)
    }

    const target = path.join(root, 'docs/decisions/0004-crash-safe-runtime-ownership.md')
    const original = fs.readFileSync(target, 'utf8')
    fs.writeFileSync(target, original.replace(
      'the recorded PID is never signaled or probed as authority',
      'the recorded PID may be killed after a probe',
    ))

    assert.ok(
      verifyContract(root).includes(
        'docs/decisions/0004-crash-safe-runtime-ownership.md: missing required contract text "the recorded PID is never signaled or probed as authority"',
      ),
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('removing guardian disconnect ownership fails verification', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-guardian-contract-'))
  try {
    for (const relativePath of requiredFiles) {
      const target = path.join(root, relativePath)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(path.join(repositoryRoot, relativePath), target)
    }

    const target = path.join(root, 'packages/runtime-guardian/process.mjs')
    const original = fs.readFileSync(target, 'utf8')
    fs.writeFileSync(target, original.replace("process.once('disconnect'", "process.once('unrelated'"))

    assert.ok(
      verifyContract(root).includes(
        'packages/runtime-guardian/process.mjs: missing required contract text "process.once(\'disconnect\'"',
      ),
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
