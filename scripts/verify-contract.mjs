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
  'docs/decisions/0001-electron-desktop-host.md',
  'docs/decisions/0002-official-dsh-cli-runtime.md',
  'docs/decisions/0003-dsh-alpha2-runtime-upgrade.md',
  'docs/decisions/0004-crash-safe-runtime-ownership.md',
  'docs/upstream-compatibility.md',
  '.github/ISSUE_TEMPLATE/config.yml',
  '.github/ISSUE_TEMPLATE/feature_request.yml',
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/pull_request_template.md',
  '.github/workflows/contract.yml',
  '.github/BRANCH_PROTECTION.md',
  '.github/branch-protection.json',
  'scripts/verify-pr-contract.mjs',
  'scripts/verify-pr-contract.test.mjs',
  '.gitignore',
  'runtime/baseline.json',
  'runtime/README.md',
  'package.json',
  'pnpm-lock.yaml',
  '.github/workflows/runtime-baseline.yml',
  'scripts/runtime-provenance.mjs',
  'scripts/prepare-product-runtime.mjs',
  'scripts/verify-product-runtime.mjs',
  'scripts/product-dependencies.test.mjs',
  'scripts/product-runtime-diagnostics.test.mjs',
  'docs/acceptance/electron-lifecycle-slice.md',
  '.github/workflows/desktop-lifecycle.yml',
  'apps/desktop/contracts.d.ts',
  'apps/desktop/index.html',
  'apps/desktop/main.mjs',
  'apps/desktop/preload.cjs',
  'apps/desktop/renderer.js',
  'apps/desktop/security.mjs',
  'apps/desktop/style.css',
  'apps/desktop/window.mjs',
  'packages/lifecycle-bundle/cordis.patch.yml',
  'packages/lifecycle-bundle/index.mjs',
  'packages/lifecycle-bundle/package.json',
  'packages/runtime-host/index.mjs',
  'packages/runtime-host/official-launcher.mjs',
  'packages/runtime-guardian/client.mjs',
  'packages/runtime-guardian/generation-store.mjs',
  'packages/runtime-guardian/process.mjs',
  'packages/runtime-guardian/protocol.mjs',
  'packages/runtime-guardian/service.mjs',
  'scripts/local-evidence.test.mjs',
  'scripts/run-host-death-test.mjs',
  'scripts/run-desktop-test.mjs',
  'scripts/verify-local.mjs',
  'tests/desktop-e2e.mjs',
  'tests/desktop-host-death-e2e.mjs',
  'tests/desktop-recovery-e2e.mjs',
  'tests/desktop-security.test.mjs',
  'tests/official-launcher.test.mjs',
  'tests/generation-store.test.mjs',
  'tests/guardian-client.test.mjs',
  'tests/owned-test-home.test.mjs',
  'tests/renderer.test.mjs',
  'tests/runtime-host.test.mjs',
  'tests/runtime-guardian.test.mjs',
  'tests/runtime-integration.test.mjs',
  'tests/guardian-integration.test.mjs',
  'tests/fixtures/delayed-startup/index.mjs',
  'tests/fixtures/delayed-startup/package.json',
  'tests/support/owned-test-home.mjs',
  'tests/support/runtime-output-guard.mjs',
]

const linkedMarkdownFiles = [
  'runtime/README.md',
  'docs/acceptance/electron-lifecycle-slice.md',
  'README.md',
  'README.en.md',
  'AGENTS.md',
  'CLAUDE.md',
  'docs/product-scope.md',
  'docs/workflow.md',
  'docs/workflow-v1.zh-CN.md',
  'docs/acceptance/m0.md',
  'docs/decisions/README.md',
  'docs/decisions/0001-electron-desktop-host.md',
  'docs/decisions/0002-official-dsh-cli-runtime.md',
  'docs/decisions/0003-dsh-alpha2-runtime-upgrade.md',
  'docs/decisions/0004-crash-safe-runtime-ownership.md',
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
  for (const token of [
    'Compose Harness; do not reimplement it.',
    'Keep pinned upstream source read-only and byte-clean',
    'Do not copy or rebuild Harness-owned services inside DSH Work.',
  ]) {
    requireText(errors, agents, token, 'AGENTS.md')
  }

  const claude = read(root, 'CLAUDE.md').trim()
  if (claude !== 'See [AGENTS.md](AGENTS.md).') {
    errors.push('CLAUDE.md: must remain a one-line pointer to AGENTS.md')
  }

  const productScope = read(root, 'docs/product-scope.md')
  for (const token of [
    '## Upstream-first invariant',
    'DSH Work composes Harness; it does not modify, copy, or reimplement Harness-owned source and services.',
    'A verified capability gap returns to research and an upstream extension proposal',
  ]) {
    requireText(errors, productScope, token, 'docs/product-scope.md')
  }

  const upstream = read(root, 'docs/upstream-compatibility.md')
  for (const token of [
    'read-only, byte-clean compatibility baseline',
    '## DSH Desktop reference',
    'the absence of product modifications in the pinned upstream source tree',
  ]) {
    requireText(errors, upstream, token, 'docs/upstream-compatibility.md')
  }

  const hostDecision = read(root, 'docs/decisions/0001-electron-desktop-host.md')
  for (const token of ['Status: accepted', 'Accept Electron `44.0.0` as the M0 desktop host']) {
    requireText(errors, hostDecision, token, 'docs/decisions/0001-electron-desktop-host.md')
  }

  requireText(
    errors,
    read(root, 'docs/decisions/0002-official-dsh-cli-runtime.md'),
    'Status: superseded by ADR 0003',
    'docs/decisions/0002-official-dsh-cli-runtime.md',
  )

  const runtimeDecision = read(root, 'docs/decisions/0003-dsh-alpha2-runtime-upgrade.md')
  for (const token of [
    'Status: accepted',
    '`0a53fb55bea101816fa226bb964ae2bed71c343b`',
    '`@deepseek-ai/dsh@0.1.2-alpha.2`',
    'Node.js `24.11.1`',
    'pnpm `10.34.4`',
  ]) {
    requireText(errors, runtimeDecision, token, 'docs/decisions/0003-dsh-alpha2-runtime-upgrade.md')
  }

  const ownershipDecision = read(root, 'docs/decisions/0004-crash-safe-runtime-ownership.md')
  for (const token of [
    'Status: implemented',
    'external **runtime guardian**',
    '`active.json` is claimed with exclusive creation',
    'the recorded PID is never signaled or probed as authority',
    'explicit isolated recovery',
    'does not guarantee containment of arbitrary descendants',
  ]) {
    requireText(errors, ownershipDecision, token, 'docs/decisions/0004-crash-safe-runtime-ownership.md')
  }

  const expectedNodeArtifacts = {
    'darwin-x64': {
      filename: 'node-v24.11.1-darwin-x64.tar.gz',
      sha256: '096081b6d6fcdd3f5ba0f5f1d44a47e83037ad2e78eada26671c252fe64dd111',
    },
    'darwin-arm64': {
      filename: 'node-v24.11.1-darwin-arm64.tar.gz',
      sha256: 'b05aa3a66efe680023f930bd5af3fdbbd542794da5644ca2ad711d68cbd4dc35',
    },
    'win32-x64': {
      filename: 'node-v24.11.1-win-x64.zip',
      sha256: '5355ae6d7c49eddcfde7d34ac3486820600a831bf81dc3bdca5c8db6a9bb0e76',
    },
  }
  try {
    const baseline = JSON.parse(read(root, 'runtime/baseline.json'))
    if (baseline.status !== 'accepted' || baseline.decision !== 'docs/decisions/0003-dsh-alpha2-runtime-upgrade.md' ||
        baseline.source?.repository !== 'https://github.com/deepseek-ai/deepseek-harness.git' ||
        baseline.source?.tag !== 'dsh-v0.1.2-alpha.2' || baseline.source?.commit !== '0a53fb55bea101816fa226bb964ae2bed71c343b' ||
        baseline.runtime?.package !== '@deepseek-ai/dsh' || baseline.runtime?.version !== '0.1.2-alpha.2' ||
        baseline.runtime?.integrity !== 'sha512-4TvTC5kRKlgtSU2UTBv+cID9a2Z+6+m6mpvjXWJfVzuTkflCff6s4MsQpFJTCmwFh/k7zNWe7qFXcLYMV/5VvA==' ||
        baseline.runtime?.node !== '24.11.1' || baseline.runtime?.pnpm !== '10.34.4' ||
        baseline.runtime?.tarball !== 'https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.1.2-alpha.2.tgz' ||
        JSON.stringify(baseline.runtime?.nodeArtifacts) !== JSON.stringify(expectedNodeArtifacts) ||
        baseline.electron !== '44.0.0') {
      errors.push('runtime/baseline.json: active selection does not match accepted decisions')
    }
  } catch {
    errors.push('runtime/baseline.json: invalid active baseline')
  }

  const workflow = read(root, 'docs/workflow.md')
  for (const heading of ['## Upstream-first architecture', '## State machine', '## Stage contracts', '## Verification ladder', '## Definition of Done']) {
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
  for (const token of [
    'The pinned Harness source remains read-only and byte-clean under an executable repository check.',
    'No Harness-owned Agent, session, model, tool, authorization, or plugin-lifecycle service is copied or reimplemented in DSH Work.',
    'A missing native extension is handled through a recorded upstream proposal',
  ]) {
    requireText(errors, acceptance, token, 'docs/acceptance/m0.md')
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
    '## Scope and boundary / 范围与边界',
    '## Acceptance evidence / 验收证据',
    '## Verification actually run / 实际执行的验证',
    '## Risks and rollback / 风险与回滚',
  ]) {
    requireText(errors, pullRequest, heading, '.github/pull_request_template.md')
  }
  requireText(
    errors,
    pullRequest,
    'Harness-native composition is used; pinned upstream source is unchanged and no Harness-owned service is duplicated.',
    '.github/pull_request_template.md',
  )

  const workflowYaml = read(root, '.github/workflows/contract.yml')
  for (const token of [
    'name: Contract',
    'pull_request:',
    'branches: [main]',
    'types: [opened, synchronize, reopened, edited, ready_for_review]',
    'name: contract',
    'name: pull-request-contract',
    'node --test scripts/*.test.mjs',
    'node scripts/verify-contract.mjs',
    'node scripts/verify-pr-contract.mjs "$GITHUB_EVENT_PATH"',
  ]) {
    requireText(errors, workflowYaml, token, '.github/workflows/contract.yml')
  }

  const runtimeWorkflow = read(root, '.github/workflows/runtime-baseline.yml')
  for (const token of [
    'name: Runtime baseline',
    'pull_request:',
    'branches: [main]',
    'runs-on: ${{ matrix.os }}',
    'node-version: 24.11.1',
    'pnpm@10.34.4',
    'prepare-product-runtime.mjs',
    'verify-product-runtime.mjs',
  ]) {
    requireText(errors, runtimeWorkflow, token, '.github/workflows/runtime-baseline.yml')
  }
  if (runtimeWorkflow.includes('prototypes/')) {
    errors.push('.github/workflows/runtime-baseline.yml: production workflow must not depend on research prototypes')
  }

  const lifecycleAcceptance = read(root, 'docs/acceptance/electron-lifecycle-slice.md')
  for (const heading of [
    '## User outcome',
    '## Ownership boundary',
    '## Acceptance contract',
    '## Security and diagnostics',
    '## Verification',
    '## Remaining M0 gates',
  ]) {
    requireText(errors, lifecycleAcceptance, heading, 'docs/acceptance/electron-lifecycle-slice.md')
  }

  const lifecycleBundle = read(root, 'packages/lifecycle-bundle/index.mjs')
  for (const token of [
    "import { exitOnStdinEnd } from '@deepseek-ai/dsh-cmdline'",
    'ctx.appReady.onReady',
    'ctx.effect',
    "protocol: 'dsh-work.lifecycle.v1'",
  ]) {
    requireText(errors, lifecycleBundle, token, 'packages/lifecycle-bundle/index.mjs')
  }

  const launcher = read(root, 'packages/runtime-host/official-launcher.mjs')
  for (const token of [
    'prepareProductProfile',
    "require.resolve('@deepseek-ai/dsh/package.json')",
    "'--profile', 'dsh-work'",
    'shell: false',
    'DSH_TELEMETRY_DISABLED',
  ]) {
    requireText(errors, launcher, token, 'packages/runtime-host/official-launcher.mjs')
  }

  const generationStore = read(root, 'packages/runtime-guardian/generation-store.mjs')
  for (const token of ["fs.openSync(file, 'wx'", 'dsh-work-terminal.json',
    "return { status: 'blocked', code: 'recovery-required' }", 'quarantine']) {
    requireText(errors, generationStore, token, 'packages/runtime-guardian/generation-store.mjs')
  }

  const guardianProcess = read(root, 'packages/runtime-guardian/process.mjs')
  for (const token of ["process.once('disconnect'", 'await service.dispose()',
    'createOfficialLauncher', 'prepareProductProfile']) {
    requireText(errors, guardianProcess, token, 'packages/runtime-guardian/process.mjs')
  }
  for (const forbidden of ['process.kill(', '.kill(']) {
    if (guardianProcess.includes(forbidden)) {
      errors.push(`packages/runtime-guardian/process.mjs: guardian must not contain ${JSON.stringify(forbidden)}`)
    }
  }

  const guardianProtocol = read(root, 'packages/runtime-guardian/protocol.mjs')
  for (const token of ["'dsh-work.guardian.v1'", "['start', 'stop', 'recover', 'snapshot']",
    "'recovery-required'", 'canRecover']) {
    requireText(errors, guardianProtocol, token, 'packages/runtime-guardian/protocol.mjs')
  }

  const desktopMain = read(root, 'apps/desktop/main.mjs')
  for (const token of ['createGuardianClient', 'app.requestSingleInstanceLock()', 'await host.dispose()']) {
    requireText(errors, desktopMain, token, 'apps/desktop/main.mjs')
  }

  const localVerifier = read(root, 'scripts/verify-local.mjs')
  requireText(errors, localVerifier, "'host-death'", 'scripts/verify-local.mjs')

  const desktopWorkflow = read(root, '.github/workflows/desktop-lifecycle.yml')
  for (const token of [
    'name: Desktop lifecycle',
    'branches: [main]',
    'runs-on: ${{ matrix.os }}',
    'node-version: 24.11.1',
    'pnpm@10.34.4',
    'prepare-product-runtime.mjs',
    'verify-local.mjs artifacts/runtime/context.json --desktop',
  ]) {
    requireText(errors, desktopWorkflow, token, '.github/workflows/desktop-lifecycle.yml')
  }
  for (const forbidden of ['prototypes/', 'research/m0-architecture']) {
    if (desktopWorkflow.includes(forbidden)) {
      errors.push(`.github/workflows/desktop-lifecycle.yml: production workflow must not contain ${JSON.stringify(forbidden)}`)
    }
  }

  let protection
  try {
    protection = JSON.parse(read(root, '.github/branch-protection.json'))
  } catch (error) {
    errors.push(`.github/branch-protection.json: invalid JSON: ${error.message}`)
  }
  if (protection) {
    const contexts = protection.required_status_checks?.contexts ?? []
    for (const context of ['contract', 'pull-request-contract']) {
      if (!contexts.includes(context)) {
        errors.push(`.github/branch-protection.json: missing required status check ${JSON.stringify(context)}`)
      }
    }
    if (protection.required_status_checks?.strict !== true) {
      errors.push('.github/branch-protection.json: required status checks must require an up-to-date branch')
    }
    for (const field of ['enforce_admins', 'required_conversation_resolution']) {
      if (protection[field] !== true) {
        errors.push(`.github/branch-protection.json: ${field} must be true`)
      }
    }
    for (const field of ['allow_force_pushes', 'allow_deletions']) {
      if (protection[field] !== false) {
        errors.push(`.github/branch-protection.json: ${field} must be false`)
      }
    }
    if (protection.required_pull_request_reviews?.required_approving_review_count !== 0) {
      errors.push('.github/branch-protection.json: single-maintainer baseline requires zero approving reviews')
    }
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
