import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { verifyContract, verifyMarkdownLinks } from './verify-contract.mjs'

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
