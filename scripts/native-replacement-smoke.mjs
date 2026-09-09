import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
const root = path.resolve(import.meta.dirname, '..')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')

export function verifyNativeReplacement(application) {
  if (!['darwin', 'win32'].includes(process.platform)) throw new Error('native replacement smoke requires macOS or Windows')
  const image = path.join(application, 'node_modules/@img')
  const addonName = `sharp-${process.platform}-${process.arch}`
  const libraryName = process.platform === 'darwin' ? `sharp-libvips-darwin-${process.arch}` : addonName
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-native-replace-'))
  try {
    for (const name of new Set([addonName, libraryName])) {
      fs.cpSync(path.join(image, name), path.join(temporary, name), { recursive: true })
    }
    const libraryRoot = path.join(temporary, libraryName, 'lib')
    const libraries = fs.readdirSync(libraryRoot).filter(name => name.endsWith(process.platform === 'darwin' ? '.dylib' : '.dll'))
    if (!libraries.length) throw new Error('no replaceable shared library found')
    const addonRoot = path.join(temporary, addonName, 'lib')
    const addon = fs.readdirSync(addonRoot).find(name => name.endsWith('.node'))
    if (!addon) throw new Error('native addon missing')
    const load = () => JSON.parse(execFileSync(process.execPath, ['-e',
      'const a=require(process.argv[1]);console.log(JSON.stringify({version:a.libvipsVersion(),formats:Object.keys(a.format())}))',
      path.join(addonRoot, addon)], { encoding: 'utf8', timeout: 30_000 }))
    const original = load()
    const replacements = libraries.map(file => {
      const target = path.join(libraryRoot, file)
      const before = sha(fs.readFileSync(target))
      // Change bytes without changing the exported ABI, then load in a fresh process.
      if (process.platform === 'darwin') {
        execFileSync('/usr/bin/install_name_tool', ['-id', '@rpath/libvips-cpp.user00.dylib', target], { stdio: 'pipe' })
        execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', target], { stdio: 'pipe' })
      } else fs.appendFileSync(target, '\nDSH Work library replacement smoke\n')
      const after = sha(fs.readFileSync(target))
      if (before === after) throw new Error('replacement did not change library bytes')
      return { file, before, after }
    })
    const replaced = load()
    if (JSON.stringify(original) !== JSON.stringify(replaced)) throw new Error('replacement changed addon availability')
    return { platform: process.platform, arch: process.arch, replacements, result: replaced }
  } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(verifyNativeReplacement(path.join(root, 'artifacts/package/application')), null, 2))
}
