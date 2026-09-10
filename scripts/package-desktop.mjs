import fs from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { generateDistributionNotices } from './distribution-notices.mjs'
import { prepareNativeMaterials } from './native-distribution.mjs'
import { verifyNativeReplacement } from './native-replacement-smoke.mjs'
import { stageProductRuntime } from './stage-product-runtime.mjs'

const root = path.resolve(import.meta.dirname, '..')
export function signingOptions(signed, platform, environment) {
  if (!signed) return {}
  if (platform !== 'darwin') throw new Error('signed packaging currently requires macOS')
  const identity = environment.DSH_WORK_SIGN_IDENTITY
  if (!identity?.startsWith('Developer ID Application:')) throw new Error('Developer ID Application identity required')
  const keychainProfile = environment.DSH_WORK_NOTARY_PROFILE
  if (!keychainProfile) throw new Error('notarization keychain profile required')
  return { osxSign: { identity, hardenedRuntime: true }, osxNotarize: { keychainProfile } }
}

export async function packageDesktop({ signed = false } = {}) {
  const signing = signingOptions(signed, process.platform, process.env)
  if (!['darwin', 'win32'].includes(process.platform)) throw new Error('native macOS or Windows packaging required')
  const { packager } = await import('@electron/packager')
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json')))
  const baseline = JSON.parse(fs.readFileSync(path.join(root, 'runtime/baseline.json')))
  const context = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/runtime/context.json')))
  const output = path.join(root, 'artifacts/package')
  const stage = path.join(output, 'application')
  fs.mkdirSync(output, { recursive: true })
  fs.rmSync(path.join(output, 'receipt.json'), { force: true })
  fs.rmSync(stage, { recursive: true, force: true })
  fs.mkdirSync(stage)
  // Keep the locked manifest unchanged during installation; add desktop metadata afterwards.
  for (const name of ['package.json', 'pnpm-lock.yaml']) fs.copyFileSync(path.join(root, name), path.join(stage, name))
  const pnpm = process.env.npm_execpath
  if (!pnpm || !fs.existsSync(pnpm)) throw new Error('run packaging through pnpm package:desktop')
  execFileSync(process.execPath, [pnpm, 'install', '--prod', '--frozen-lockfile', '--ignore-scripts', '--config.node-linker=hoisted'], {
    cwd: stage, stdio: 'inherit', env: { ...process.env, CI: 'true' },
  })
  fs.cpSync(path.join(root, 'dist'), path.join(stage, 'dist'), { recursive: true })
  fs.mkdirSync(path.join(stage, 'runtime'))
  fs.copyFileSync(path.join(root, 'runtime/baseline.json'), path.join(stage, 'runtime/baseline.json'))
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({
    name: manifest.name, version: manifest.version, private: true, type: 'module',
    main: 'dist/apps/desktop/main.js', author: manifest.author, license: manifest.license, dependencies: manifest.dependencies,
  }, null, 2))
  fs.rmSync(path.join(stage, 'pnpm-lock.yaml'))
  const resources = path.join(output, 'resources')
  stageProductRuntime(context, resources)
  // The official rc.1 hook restores node-pty's prebuilt helper executable bit.
  // Packaging disables general dependency scripts, so run only this reviewed hook.
  execFileSync(context.node, [path.join(stage, 'node_modules/@deepseek-ai/dsh-subprocess-local/scripts/ensure-spawn-helper.mjs')], {
    cwd: stage, stdio: 'inherit',
  })
  await prepareNativeMaterials()
  const inventory = generateDistributionNotices(stage, resources)
  const replacement = verifyNativeReplacement(stage)
  fs.writeFileSync(path.join(resources, 'third-party/native-replacement-smoke.json'), `${JSON.stringify(replacement, null, 2)}\n`)
  if (signed && inventory.blockers.length) throw new Error('distribution material gate is not complete')
  const packages = await packager({
    dir: stage, out: path.join(output, 'bundles'), name: 'DSH Work',
    executableName: 'DSH Work', appBundleId: 'io.github.zxheyi.dsh-work',
    appVersion: manifest.version, electronVersion: baseline.electron,
    platform: process.platform, arch: process.arch,
    icon: path.join(root, 'assets/brand', process.platform === 'darwin' ? 'app-icon.icns' : 'app-icon.ico'),
    // The standalone Node guardian and Harness loader require ordinary filesystem paths.
    asar: false, prune: false, derefSymlinks: false, overwrite: true,
    extraResource: ['runtime', 'third-party', 'LICENSE.dsh-work.txt'].map(name => path.join(resources, name)),
    afterCopyExtraResources: [({ buildPath, platform }) => {
      const target = path.join(buildPath, platform === 'darwin' ? 'DSH Work.app/Contents/Resources' : 'resources', 'third-party')
      for (const file of ['LICENSE', 'LICENSES.chromium.html']) fs.copyFileSync(path.join(buildPath, file), path.join(target, `electron-${file}`))
    }], ...signing,
  })
  if (signed) {
    const app = path.join(packages[0], 'DSH Work.app')
    execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
    execFileSync('xcrun', ['stapler', 'validate', app], { stdio: 'inherit' })
    execFileSync('spctl', ['--assess', '--type', 'execute', app], { stdio: 'inherit' })
  }
  const receipt = {
    schema: 'dsh-work.desktop-package.v1', revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    platform: process.platform, arch: process.arch, version: manifest.version,
    lockfileSHA256: createHash('sha256').update(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))).digest('hex'),
    distribution: signed ? 'developer-id-notarized' : 'unsigned-internal-test',
    bundle: path.relative(root, packages[0]),
  }
  fs.writeFileSync(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2))
  console.log(`Packaged ${receipt.distribution}: ${receipt.bundle}`)
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await packageDesktop({ signed: process.argv.includes('--signed') })
}
