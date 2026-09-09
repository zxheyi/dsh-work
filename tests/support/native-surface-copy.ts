const includesAny = (text: string, values: readonly string[]): boolean =>
  values.some(value => text.includes(value))

export function inspectNativeSurfaceCopy(text: string): {
  readonly brand: boolean
  readonly newSession: boolean
  readonly workspace: boolean
  readonly settings: boolean
} {
  return {
    brand: text.split(/\r?\n/u).some(line => line.trim() === 'DeepSeek Harness'),
    newSession: includesAny(text, ['新会话', 'New Session']),
    workspace: includesAny(text, ['工作区', 'Workspaces']),
    settings: includesAny(text, ['设置', 'Settings']),
  }
}
