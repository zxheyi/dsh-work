import fs from 'node:fs'
import path from 'node:path'

export interface DesktopNodePathOptions {
  readonly isPackaged: boolean
  readonly resourcesPath: string
  readonly platform: NodeJS.Platform
  readonly environment: NodeJS.ProcessEnv
}

function packagedNodePath(resourcesPath: string, platform: NodeJS.Platform): string {
  if (!path.isAbsolute(resourcesPath)) throw new Error('packaged runtime unavailable')
  return path.join(resourcesPath, 'runtime/node', platform === 'win32' ? 'node.exe' : 'bin/node')
}

function isOwnedRegularFile(file: string): boolean {
  try {
    const value = fs.lstatSync(file)
    return value.isFile() && !value.isSymbolicLink()
  } catch {
    return false
  }
}

/** Resolve the only Node executable the desktop may use for its managed guardian. */
export function resolveDesktopNodePath(options: DesktopNodePathOptions): string {
  if (options.isPackaged) {
    const node = packagedNodePath(options.resourcesPath, options.platform)
    if (!isOwnedRegularFile(node)) throw new Error('packaged runtime unavailable')
    return node
  }
  const node = options.environment.DSH_WORK_NODE ?? ''
  if (!path.isAbsolute(node)) throw new Error('development runtime unavailable')
  return node
}
