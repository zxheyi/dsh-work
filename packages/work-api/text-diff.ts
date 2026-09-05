export type TextDiffLineKind = 'equal' | 'removed' | 'added'

export interface TextDiffBlock {
  readonly kind: TextDiffLineKind
  readonly lines: readonly string[]
}

export type TextDiffPlan =
  | { readonly mode: 'unchanged' }
  | { readonly mode: 'bounded'; readonly fromLines: number; readonly toLines: number }
  | { readonly mode: 'diff'; readonly blocks: readonly TextDiffBlock[] }

const MAX_DIFF_CHARACTERS = 512 * 1024
const MAX_DIFF_LINES = 2_000
const MAX_DIFF_CELLS = 250_000

function boundedLineCount(content: string): number | null {
  let lines = 1
  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) !== 10) continue
    lines++
    if (lines > MAX_DIFF_LINES) return null
  }
  return lines
}

function pushLine(blocks: TextDiffBlock[], kind: TextDiffLineKind, line: string): void {
  const current = blocks.at(-1)
  if (current?.kind === kind) {
    blocks[blocks.length - 1] = Object.freeze({ kind, lines: Object.freeze([...current.lines, line]) })
    return
  }
  blocks.push(Object.freeze({ kind, lines: Object.freeze([line]) }))
}

export function planTextDiff(from: string, to: string): TextDiffPlan {
  if (from === to) return Object.freeze({ mode: 'unchanged' })
  const fromLineCount = boundedLineCount(from)
  const toLineCount = boundedLineCount(to)
  if (from.length > MAX_DIFF_CHARACTERS
    || to.length > MAX_DIFF_CHARACTERS
    || fromLineCount === null
    || toLineCount === null
    || (fromLineCount + 1) * (toLineCount + 1) > MAX_DIFF_CELLS) {
    return Object.freeze({
      mode: 'bounded',
      fromLines: fromLineCount ?? MAX_DIFF_LINES + 1,
      toLines: toLineCount ?? MAX_DIFF_LINES + 1,
    })
  }
  const fromLines = from.split('\n')
  const toLines = to.split('\n')
  const columns = toLines.length + 1
  const matrix = new Uint32Array((fromLines.length + 1) * columns)
  for (let left = fromLines.length - 1; left >= 0; left--) {
    for (let right = toLines.length - 1; right >= 0; right--) {
      const index = left * columns + right
      matrix[index] = fromLines[left] === toLines[right]
        ? matrix[(left + 1) * columns + right + 1]! + 1
        : Math.max(matrix[(left + 1) * columns + right]!, matrix[index + 1]!)
    }
  }
  const blocks: TextDiffBlock[] = []
  let left = 0
  let right = 0
  while (left < fromLines.length || right < toLines.length) {
    if (left < fromLines.length && right < toLines.length && fromLines[left] === toLines[right]) {
      pushLine(blocks, 'equal', fromLines[left]!)
      left++
      right++
      continue
    }
    if (right < toLines.length
      && (left >= fromLines.length
        || matrix[left * columns + right + 1]! > matrix[(left + 1) * columns + right]!)) {
      pushLine(blocks, 'added', toLines[right]!)
      right++
      continue
    }
    pushLine(blocks, 'removed', fromLines[left]!)
    left++
  }
  return Object.freeze({ mode: 'diff', blocks: Object.freeze(blocks) })
}
