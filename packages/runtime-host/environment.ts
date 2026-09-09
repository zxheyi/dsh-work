import path from 'node:path'

/** Admit native system helpers without importing arbitrary caller PATH entries. */
export function runtimeSearchPath(
  node: string,
  platform: NodeJS.Platform,
  environment: Readonly<NodeJS.ProcessEnv>,
): string {
  const paths = platform === 'win32' ? path.win32 : path.posix
  const directories = [paths.dirname(node)]
  if (platform === 'darwin') directories.push('/usr/bin', '/bin')
  if (platform === 'win32') {
    // Windows can be installed outside C:\Windows. Match environment key
    // semantics without depending on the caller's capitalization.
    const normalized = Object.fromEntries(Object.entries(environment)
      .map(([key, value]) => [key.toUpperCase(), value]))
    const systemRoot = normalized.SYSTEMROOT || normalized.WINDIR
    if (systemRoot && paths.isAbsolute(systemRoot) && paths.parse(systemRoot).root.length > 1
      && !systemRoot.includes(paths.delimiter) && !systemRoot.includes('\0')) {
      directories.push(paths.join(systemRoot, 'System32'))
    }
  }
  return directories.join(paths.delimiter)
}
