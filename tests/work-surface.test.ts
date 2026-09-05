import assert from 'node:assert/strict'
import test from 'node:test'

import {
  LatestPreviewRequest,
  parseSafeMarkdown,
  planSafeMarkdownRender,
} from '../packages/work-api/surface.ts'

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
