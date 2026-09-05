import assert from 'node:assert/strict'
import test from 'node:test'

import {
  LatestPreviewRequest,
  matchesSessionOutputVersionSelection,
  matchesSessionOutputSelection,
  parseSafeMarkdown,
  planSafeMarkdownRender,
  sessionOutputSaveTarget,
  sessionOutputVersionSummary,
} from '../packages/work-api/surface.ts'
import {
  matchesWorkRecoveryOutput,
  parseWorkRecoveryContext,
  recoverySessionDisposition,
  recoveredDraftForSession,
  serializeWorkRecoveryContext,
  type WorkRecoveryContext,
} from '../packages/work-api/recovery-context.ts'
import { planTextDiff } from '../packages/work-api/text-diff.ts'

test('retries the original selected output version after the visible selection changes', () => {
  const selection = { sessionId: 'session-save', turn: 2, throughSeq: 9, path: 'report.md' }
  const first = sessionOutputSaveTarget(selection, {
    fileId: 'a'.repeat(32), versionId: 'b'.repeat(32), ordinal: 1,
  })
  const visibleSecond = {
    fileId: 'a'.repeat(32), versionId: 'c'.repeat(32), ordinal: 2,
  }

  assert.equal(sessionOutputSaveTarget(selection, visibleSecond, first), first)
  assert.deepEqual(first.spec.version, {
    fileId: 'a'.repeat(32), versionId: 'b'.repeat(32),
  })
  assert.equal(first.ordinal, 1)
})

test('round trips only bounded exact recovery context without file content', () => {
  const context: WorkRecoveryContext = {
    schema: 'dsh-work.recovery-context.v1',
    sessionId: 'session-1',
    draft: '未发送草稿',
    selection: {
      sessionId: 'session-1', turn: 2, throughSeq: 9, name: 'report.md', path: 'report.md',
      bytes: 9, mediaType: 'text/markdown',
    },
  }
  const encoded = serializeWorkRecoveryContext(context)
  assert.deepEqual(parseWorkRecoveryContext(encoded), context)
  assert.equal(encoded.includes('content'), false)
  assert.equal(parseWorkRecoveryContext(`${encoded.slice(0, -1)},"extra":true}`), null)
  assert.equal(serializeWorkRecoveryContext({ ...context, draft: 'x'.repeat(21 * 1024) }), '')
})

test('restores a selected output only when the original immutable coordinates still match', () => {
  const retained = {
    sessionId: 'session-1', turn: 2, throughSeq: 9, name: 'report.md', path: 'report.md',
    bytes: 9, mediaType: 'text/markdown',
  }
  assert.equal(matchesWorkRecoveryOutput(retained, retained), true)
  assert.equal(matchesWorkRecoveryOutput(retained, { ...retained, sessionId: 'session-2' }), false)
  assert.equal(matchesWorkRecoveryOutput(retained, { ...retained, bytes: 10 }), false)
})

test('never applies a retained draft to a different Session rendered first', () => {
  const retained = { sessionId: 'session-a', draft: 'A 的未发送草稿' }

  assert.equal(recoveredDraftForSession(retained, 'session-b', ''), '')
  assert.equal(recoveredDraftForSession(retained, 'session-a', ''), retained.draft)
  assert.equal(recoveredDraftForSession(retained, 'session-a', 'A 的新输入'), 'A 的新输入')
})

test('discards recovery context only after a complete Session list proves it stale', () => {
  assert.equal(recoverySessionDisposition('session-a', { phase: 'pending', byId: {} }), 'wait')
  assert.equal(recoverySessionDisposition('session-a', {
    phase: 'ready', byId: { 'session-a': {} },
  }), 'open')
  assert.equal(recoverySessionDisposition('session-a', { phase: 'ready', byId: {} }), 'discard')
})

test('binds asynchronous file actions to the exact Session output Turn', () => {
  const oldSelection = {
    sessionId: 'session-1', turn: 2, throughSeq: 9, name: 'report.md', path: 'report.md',
    bytes: 9, mediaType: 'text/markdown', open() {},
  }

  assert.equal(matchesSessionOutputSelection(oldSelection, oldSelection), true)
  assert.equal(matchesSessionOutputSelection({ ...oldSelection, turn: 3, throughSeq: 15 }, oldSelection), false)
  assert.equal(matchesSessionOutputSelection({ ...oldSelection, path: 'other.md' }, oldSelection), false)
})

test('parses headings, paragraphs, lists and code without creating active HTML or resources', () => {
  const source = [
    '# Report',
    '',
    'A safe paragraph.',
    '',
    '- First',
    '- Second',
    '',
    '<script>globalThis.compromised = true</script>',
    '![tracker](https://example.invalid/tracker.png)',
    '',
    '```html',
    '<img src="https://example.invalid/code.png">',
    '```',
  ].join('\n')

  assert.deepEqual(parseSafeMarkdown(source), [
    { kind: 'heading', level: 1, text: 'Report' },
    { kind: 'paragraph', text: 'A safe paragraph.' },
    { kind: 'list', ordered: false, items: ['First', 'Second'] },
    {
      kind: 'paragraph',
      text: '<script>globalThis.compromised = true</script> ![tracker](https://example.invalid/tracker.png)',
    },
    { kind: 'code', text: '<img src="https://example.invalid/code.png">' },
  ])
})

test('falls back to one plain-text node for structurally dense Markdown', () => {
  const source = Array.from({ length: 2_001 }, (_, index) => `# Item ${String(index)}`).join('\n')

  assert.deepEqual(planSafeMarkdownRender(source), { mode: 'plain', content: source })
})

test('derives a bounded version summary only from the stored content', () => {
  assert.equal(sessionOutputVersionSummary('\n# Verified title\nBody'), 'Verified title')
  assert.equal(sessionOutputVersionSummary('> quoted source'), 'quoted source')
  assert.equal(sessionOutputVersionSummary('   \n'), '该版本没有可显示的文字摘要')
  assert.equal(sessionOutputVersionSummary(`# ${'a'.repeat(120)}`).length, 101)
  assert.equal(sessionOutputVersionSummary(`${'\n'.repeat(50_000)}# Late title`), 'Late title')
})

test('renders historical content only when its full identity matches the selected version', () => {
  const selected = { fileId: 'a'.repeat(32), versionId: 'b'.repeat(32) }
  assert.equal(matchesSessionOutputVersionSelection(selected, selected), true)
  assert.equal(matchesSessionOutputVersionSelection(selected, {
    fileId: selected.fileId,
    versionId: 'c'.repeat(32),
  }), false)
  assert.equal(matchesSessionOutputVersionSelection(null, selected), false)
})

test('commits only the latest preview read when an older request finishes last', async () => {
  const request = new LatestPreviewRequest()
  const commits: string[] = []
  let resolveOld!: (value: string) => void
  const old = request.run(
    () => new Promise<string>(resolve => { resolveOld = resolve }),
    value => commits.push(value),
    () => commits.push('old-error'),
  )
  const current = request.run(
    async () => 'current.md',
    value => commits.push(value),
    () => commits.push('current-error'),
  )

  await current
  resolveOld('old.md')
  await old

  assert.deepEqual(commits, ['current.md'])
})

test('invalidating a preview request suppresses its late failure', async () => {
  const request = new LatestPreviewRequest()
  const commits: string[] = []
  let rejectRead!: (reason: Error) => void
  const pending = request.run(
    () => new Promise<string>((_resolve, reject) => { rejectRead = reject }),
    value => commits.push(value),
    () => commits.push('error'),
  )

  request.invalidate()
  rejectRead(new Error('late failure'))
  await pending

  assert.deepEqual(commits, [])
})

test('switching versions invalidates a late revision success before it can update the composer', async () => {
  const request = new LatestPreviewRequest()
  const commits: string[] = []
  let resolveRevision!: (value: string) => void
  const pending = request.run(
    () => new Promise<string>(resolve => { resolveRevision = resolve }),
    value => commits.push(value),
    () => commits.push('error'),
  )

  request.invalidate()
  resolveRevision('v1-reference')
  await pending

  assert.deepEqual(commits, [])
})

test('compares Markdown lines in the requested old-to-new direction', () => {
  const plan = planTextDiff('# Report\nold line\nkept', '# Report\nnew line\nkept\nadded')
  assert.deepEqual(plan, {
    mode: 'diff',
    blocks: [
      { kind: 'equal', lines: ['# Report'] },
      { kind: 'removed', lines: ['old line'] },
      { kind: 'added', lines: ['new line'] },
      { kind: 'equal', lines: ['kept'] },
      { kind: 'added', lines: ['added'] },
    ],
  })
})

test('reports identical content and bounds large or dense comparisons', () => {
  assert.deepEqual(planTextDiff('same\n', 'same\n'), { mode: 'unchanged' })
  assert.deepEqual(planTextDiff('<script>safe text only</script>', '<b>still text</b>'), {
    mode: 'diff',
    blocks: [
      { kind: 'removed', lines: ['<script>safe text only</script>'] },
      { kind: 'added', lines: ['<b>still text</b>'] },
    ],
  })
  assert.equal(planTextDiff('a\n'.repeat(2_001), 'b\n').mode, 'bounded')
  assert.equal(planTextDiff('a'.repeat(512 * 1024 + 1), 'b').mode, 'bounded')
})
