import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const requiredFiles = [
  'README.md',
  'README.en.md',
  'AGENTS.md',
  'CLAUDE.md',
  'docs/product-scope.md',
  'docs/workflow.md',
  'docs/workflow-v1.zh-CN.md',
  'docs/acceptance/m0.md',
  'docs/decisions/README.md',
  'docs/decisions/TEMPLATE.md',
  'docs/upstream-compatibility.md',
  '.github/ISSUE_TEMPLATE/config.yml',
  '.github/ISSUE_TEMPLATE/feature_request.yml',
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/pull_request_template.md',
  '.github/workflows/contract.yml',
  '.github/BRANCH_PROTECTION.md',
]

const linkedMarkdownFiles = [
  'README.md',
  'README.en.md',
  'AGENTS.md',
  'CLAUDE.md',
  'docs/product-scope.md',
  'docs/workflow.md',
  'docs/workflow-v1.zh-CN.md',
  'docs/acceptance/m0.md',
  'docs/decisions/README.md',
  'docs/upstream-compatibility.md',
  '.github/BRANCH_PROTECTION.md',
]

function read(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function requireText(errors, content, token, relativePath) {
  if (!content.includes(token)) {
    errors.push(`${relativePath}: missing required contract text ${JSON.stringify(token)}`)
  }
}

export function verifyMarkdownLinks(root, relativePath, content) {
  const errors = []
  const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g

  for (const match of content.matchAll(linkPattern)) {
    const target = match[1].trim().replace(/^<|>$/g, '')
    if (
      target === '' ||
      target.startsWith('#') ||
      target.startsWith('http://') ||
      target.startsWith('https://') ||
      target.startsWith('mailto:')
    ) {
      continue
    }

    const fileTarget = target.split('#', 1)[0]
    const resolved = path.resolve(root, path.dirname(relativePath), fileTarget)
    if (!fs.existsSync(resolved)) {
      errors.push(`${relativePath}: broken relative link ${JSON.stringify(target)}`)
    }
  }

  return errors
}

export function verifyContract(root) {
  const errors = []

  for (const relativePath of requiredFiles) {
    if (!fs.existsSync(path.join(root, relativePath))) {
      errors.push(`missing required file: ${relativePath}`)
    }
  }

  if (errors.some((error) => error.startsWith('missing required file:'))) {
    return errors
  }

  const agents = read(root, 'AGENTS.md')
  const agentLines = agents.trimEnd().split(/\r?\n/).length
  if (agentLines > 80) {
    errors.push(`AGENTS.md: expected at most 80 lines, found ${agentLines}`)
  }
  for (const heading of ['## Context', '## Change loop', '## Boundaries', '## Discipline', '## Verification']) {
    requireText(errors, agents, heading, 'AGENTS.md')
  }

  const claude = read(root, 'CLAUDE.md').trim()
  if (claude !== 'See [AGENTS.md](AGENTS.md).') {
    errors.push('CLAUDE.md: must remain a one-line pointer to AGENTS.md')
  }

  const workflow = read(root, 'docs/workflow.md')
  for (const heading of ['## State machine', '## Stage contracts', '## Verification ladder', '## Definition of Done']) {
    requireText(errors, workflow, heading, 'docs/workflow.md')
  }

  const workflowV1Zh = read(root, 'docs/workflow-v1.zh-CN.md')
  for (const heading of ['## 状态机', '## 阶段契约', '## 验证阶梯', '## 完成定义', '## v1 落地验收']) {
    requireText(errors, workflowV1Zh, heading, 'docs/workflow-v1.zh-CN.md')
  }
  requireText(errors, workflowV1Zh, '文档状态：冻结留存', 'docs/workflow-v1.zh-CN.md')

  const acceptance = read(root, 'docs/acceptance/m0.md')
  for (const heading of [
    '## User outcome',
    '## Architecture acceptance',
    '## Runtime acceptance',
    '## Failure acceptance',
    '## Security and privacy acceptance',
    '## Verification acceptance',
  ]) {
    requireText(errors, acceptance, heading, 'docs/acceptance/m0.md')
  }

  const decision = read(root, 'docs/decisions/TEMPLATE.md')
  for (const heading of [
    '## Problem',
    '## Evidence',
    '## Decision',
    '## Acceptance and verification',
    '## Alternatives considered',
    '## Consequences',
    '## Rollback or supersession',
  ]) {
    requireText(errors, decision, heading, 'docs/decisions/TEMPLATE.md')
  }

  const feature = read(root, '.github/ISSUE_TEMPLATE/feature_request.yml')
  for (const token of ['id: problem', 'id: outcome', 'id: scope', 'id: acceptance', 'id: risk']) {
    requireText(errors, feature, token, '.github/ISSUE_TEMPLATE/feature_request.yml')
  }

  const bug = read(root, '.github/ISSUE_TEMPLATE/bug_report.yml')
  for (const token of [
    'id: work_version',
    'id: harness_version',
    'id: clean_comparison',
    'id: reproduction',
    'id: expected',
    'id: diagnostics',
    'id: privacy',
  ]) {
    requireText(errors, bug, token, '.github/ISSUE_TEMPLATE/bug_report.yml')
  }

  const pullRequest = read(root, '.github/pull_request_template.md')
  for (const heading of [
    '## User outcome / 用户结果',
    '## Acceptance evidence / 验收证据',
    '## Verification actually run / 实际执行的验证',
    '## Risks and rollback / 风险与回滚',
  ]) {
    requireText(errors, pullRequest, heading, '.github/pull_request_template.md')
  }

  const workflowYaml = read(root, '.github/workflows/contract.yml')
  for (const token of [
    'name: Contract',
    'pull_request:',
    'branches: [main]',
    'name: contract',
    'node --test scripts/verify-contract.test.mjs',
    'node scripts/verify-contract.mjs',
  ]) {
    requireText(errors, workflowYaml, token, '.github/workflows/contract.yml')
  }

  for (const relativePath of linkedMarkdownFiles) {
    errors.push(...verifyMarkdownLinks(root, relativePath, read(root, relativePath)))
  }

  return errors
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const errors = verifyContract(root)
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`- ${error}`)
    }
    process.exitCode = 1
    return
  }

  console.log(`Repository contract verified: ${requiredFiles.length} required files and all local links are valid.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main()
}
