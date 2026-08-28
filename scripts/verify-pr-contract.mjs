import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const sections = {
  outcome: '## User outcome / 用户结果',
  issue: '## Related Issue / 关联 Issue',
  scope: '## Scope and boundary / 范围与边界',
  acceptance: '## Acceptance evidence / 验收证据',
  verification: '## Verification actually run / 实际执行的验证',
  risks: '## Risks and rollback / 风险与回滚',
}

function contentUnderHeading(body, heading) {
  const start = body.indexOf(heading)
  if (start === -1) {
    return null
  }

  const contentStart = start + heading.length
  const remainder = body.slice(contentStart)
  const nextHeading = remainder.search(/^##\s+/m)
  return (nextHeading === -1 ? remainder : remainder.slice(0, nextHeading)).trim()
}

function withoutComments(content) {
  return content.replace(/<!--[\s\S]*?-->/g, '').trim()
}

function hasMeaningfulText(content) {
  if (content === null) {
    return false
  }

  return withoutComments(content)
    .replace(/^```[^\n]*$/gm, '')
    .replace(/^~~~[^\n]*$/gm, '')
    .trim().length > 0
}

function hasVerificationEvidence(content) {
  const uncommented = withoutComments(content)
  const fencedBlocks = [...uncommented.matchAll(/(?:```|~~~)[^\n]*\n([\s\S]*?)(?:```|~~~)/g)]
  const hasCommandBlock = fencedBlocks.some((match) => match[1].trim().length > 0)
  const hasEvidenceLink = /https:\/\/\S+/i.test(uncommented)
  return hasCommandBlock || hasEvidenceLink
}

export function verifyPullRequestContract(pullRequest) {
  const errors = []

  if (pullRequest?.draft === true) {
    return errors
  }

  const body = pullRequest?.body
  if (typeof body !== 'string' || body.trim() === '') {
    return ['pull request body is required before marking the pull request ready']
  }

  const content = Object.fromEntries(
    Object.entries(sections).map(([key, heading]) => [key, contentUnderHeading(body, heading)]),
  )

  for (const [key, heading] of Object.entries(sections)) {
    if (content[key] === null) {
      errors.push(`missing required section: ${heading}`)
    }
  }

  if (!hasMeaningfulText(content.outcome)) {
    errors.push('User outcome section must describe an observable result')
  }

  const issueReference = withoutComments(content.issue ?? '')
  if (!/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:[\w.-]+\/[\w.-]+)?#\d+\b/i.test(issueReference)) {
    errors.push('Related Issue section must contain a closing Issue reference such as "Closes #123"')
  }

  const scope = withoutComments(content.scope ?? '')
  if (!/^- \[[xX]\]\s+Harness-native composition is used;/m.test(scope)) {
    errors.push('Scope and boundary section must confirm Harness-native composition and an unchanged upstream source')
  }

  if (!hasMeaningfulText(content.acceptance)) {
    errors.push('Acceptance evidence section must map criteria to checkable evidence')
  }

  const verification = withoutComments(content.verification ?? '')
  if (!/^- \[[xX]\]\s+\S+/m.test(verification)) {
    errors.push('Verification section must contain at least one checked verification item')
  }
  if (!hasVerificationEvidence(verification)) {
    errors.push('Verification section must include a non-empty verification command or evidence location')
  }

  if (!hasMeaningfulText(content.risks)) {
    errors.push('Risks and rollback section must describe the rollback or justify N/A')
  }

  return errors
}

function main() {
  const eventPath = process.argv[2] ?? process.env.GITHUB_EVENT_PATH
  if (!eventPath) {
    console.error('Usage: node scripts/verify-pr-contract.mjs <github-event.json>')
    process.exitCode = 2
    return
  }

  let event
  try {
    event = JSON.parse(fs.readFileSync(path.resolve(eventPath), 'utf8'))
  } catch (error) {
    console.error(`Unable to read GitHub event: ${error.message}`)
    process.exitCode = 2
    return
  }

  const errors = verifyPullRequestContract(event.pull_request)
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`- ${error}`)
    }
    process.exitCode = 1
    return
  }

  if (event.pull_request?.draft) {
    console.log('Pull request contract deferred while the pull request is draft.')
  } else {
    console.log('Pull request contract verified.')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main()
}
