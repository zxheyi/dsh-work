import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import type { RuntimeChild } from './index.ts'

interface RuntimeBaseline {
  readonly runtime: {
    readonly version: string
    readonly node: string
  }
}

interface LauncherPaths {
  readonly node: string
  readonly home: string
}

interface LauncherDependencies {
  readonly spawnProcess?: typeof spawn
  readonly probe?: typeof execFileSync
}

function findProductRoot(entry: string): string {
  let directory = path.dirname(entry)
  while (true) {
    const manifestPath = path.join(directory, 'package.json')
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { name?: string }
      if (manifest.name === 'dsh-work') return directory
    }
    const parent = path.dirname(directory)
    if (parent === directory) throw new Error('dsh-work product root unavailable')
    directory = parent
  }
}

const root = findProductRoot(fileURLToPath(import.meta.url))
const require = createRequire(path.join(root, 'package.json'))
const baseline = JSON.parse(fs.readFileSync(path.join(root, 'runtime/baseline.json'), 'utf8')) as RuntimeBaseline

function ensureOwnedDirectory(directory: string): void {
  try {
    const value = fs.lstatSync(directory)
    if (!value.isDirectory() || value.isSymbolicLink()) throw new Error('owned Profile path must be a directory')
  } catch (error: unknown) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
    fs.mkdirSync(directory, { mode: 0o700 })
  }
}

export function prepareProductProfile(home: string): void {
  if (!path.isAbsolute(home)) throw new Error('absolute owned home required')
  if (!fs.existsSync(home)) fs.mkdirSync(home, { recursive: true, mode: 0o700 })
  const profile = path.join(home, 'profiles/dsh-work')
  for (const directory of [home, path.dirname(profile), profile, path.join(profile, 'node_modules'),
    path.join(profile, 'node_modules/@dsh-work'), path.join(profile, 'node_modules/@deepseek-ai')]) {
    ensureOwnedDirectory(directory)
  }
  const bundle = path.join(profile, 'node_modules/@dsh-work/lifecycle')
  fs.rmSync(bundle, { recursive: true, force: true })
  fs.cpSync(path.join(root, 'packages/lifecycle-bundle'), bundle, { recursive: true })
  const cmdline = path.dirname(require.resolve('@deepseek-ai/dsh-cmdline/package.json'))
  const link = path.join(profile, 'node_modules/@deepseek-ai/dsh-cmdline')
  fs.rmSync(link, { recursive: true, force: true })
  fs.symlinkSync(cmdline, link, 'junction')
  fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({
    private: true,
    type: 'module',
    dsh: {
      profile: {
        bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@dsh-work/lifecycle'],
        patchReload: 'startup',
      },
    },
  }))
  fs.writeFileSync(path.join(profile, 'cordis.patch.yml'), JSON.stringify([
    { id: 'web-runtime', config: { openBrowser: false, printUrl: false, surfaceContext: true, trustedHosts: [] } },
  ]))
}

// Compatibility alias for focused callers while persistent generation
// ownership lands. It retains the stricter absolute-path requirement.
export const prepareDevelopmentProfile = prepareProductProfile

export function createOfficialLauncher(
  { node, home }: LauncherPaths,
  { spawnProcess = spawn, probe = execFileSync }: LauncherDependencies = {},
): () => RuntimeChild {
  return () => {
    if (!path.isAbsolute(node || '') || !path.isAbsolute(home || '')) {
      throw new Error('explicit runtime paths required')
    }
    const installed = path.dirname(require.resolve('@deepseek-ai/dsh/package.json'))
    const manifest = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8')) as { version?: string }
    if (manifest.version !== baseline.runtime.version) throw new Error('runtime version mismatch')
    const env: NodeJS.ProcessEnv = {
      HOME: home,
      USERPROFILE: home,
      APPDATA: home,
      LOCALAPPDATA: home,
      DSH_HOME: home,
      PATH: path.dirname(node),
      DSH_TELEMETRY_DISABLED: '1',
      NO_COLOR: '1',
    }
    for (const key of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']) {
      if (process.env[key]) env[key] = process.env[key]
    }
    const version = probe(node, ['--version'], {
      env,
      timeout: 5000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (version.trim() !== `v${baseline.runtime.node}`) throw new Error('Node version mismatch')
    return spawnProcess(node, [path.join(installed, 'lib/bin.js'), '--profile', 'dsh-work',
      '--no-open', '--host', '127.0.0.1', '--port', '0'], {
      cwd: home,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    }) as RuntimeChild
  }
}
