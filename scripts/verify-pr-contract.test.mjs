import assert from 'node:assert/strict'
import test from 'node:test'

import { verifyPullRequestContract } from './verify-pr-contract.mjs'

const validBody = `## User outcome / 用户结果

Maintainers can deliver a repository change through enforced checks.

## Related Issue / 关联 Issue

Closes #1

## Scope and boundary / 范围与边界

- [x] Harness-native composition is used; pinned upstream source is unchanged and no Harness-owned service is duplicated.

## Acceptance evidence / 验收证据

- Criterion one maps to a passing contract test.

## Verification actually run / 实际执行的验证

- [x] Contract tests

Commands and results:

\`\`\`text
node --test scripts/verify-contract.test.mjs # pass
\`\`\`

## Risks and rollback / 风险与回滚

Revert the workflow commit if the gate blocks valid changes.
`

test('accepts a ready pull request with linked work and checkable evidence', () => {
  assert.deepEqual(
    verifyPullRequestContract({ draft: false, body: validBody }),
    [],
  )
})

test('allows a draft pull request to collect evidence incrementally', () => {
  assert.deepEqual(verifyPullRequestContract({ draft: true, body: '' }), [])
})

test('rejects a ready pull request without an issue-closing reference', () => {
  const body = validBody.replace('Closes #1', 'Issue #1')
  const errors = verifyPullRequestContract({ draft: false, body })

  assert.ok(errors.some((error) => error.includes('closing Issue reference')))
})

test('rejects a ready pull request without the upstream boundary confirmation', () => {
  const body = validBody.replace(
    '- [x] Harness-native composition is used;',
    '- [ ] Harness-native composition is used;',
  )
  const errors = verifyPullRequestContract({ draft: false, body })

  assert.ok(errors.some((error) => error.includes('Harness-native composition')))
})

test('rejects empty required sections and missing executed verification', () => {
  const body = validBody
    .replace('Maintainers can deliver a repository change through enforced checks.', '<!-- outcome -->')
    .replace('- [x] Contract tests', '- [ ] Contract tests')
    .replace('node --test scripts/verify-contract.test.mjs # pass', '')
  const errors = verifyPullRequestContract({ draft: false, body })

  assert.ok(errors.some((error) => error.includes('User outcome')))
  assert.ok(errors.some((error) => error.includes('checked verification item')))
  assert.ok(errors.some((error) => error.includes('verification command or evidence location')))
})

test('rejects a missing pull request body', () => {
  const errors = verifyPullRequestContract({ draft: false, body: null })

  assert.ok(errors.some((error) => error.includes('body is required')))
})
