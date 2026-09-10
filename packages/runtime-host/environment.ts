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

/** Forward only proxy configuration; the native Harness owns validation and routing. */
export function proxyEnvironment(environment: Readonly<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
  const selected: NodeJS.ProcessEnv = {}
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
    'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']) {
    // Empty values participate in the upstream casing/fallback policy too.
    if (environment[key] !== undefined) selected[key] = environment[key]
  }
  return selected
}
