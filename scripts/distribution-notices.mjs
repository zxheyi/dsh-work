import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { retainNativeMaterials } from './native-distribution.mjs'
import { verifyNativeReplacement } from './native-replacement-smoke.mjs'
const root = path.resolve(import.meta.dirname, '..')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const read = file => JSON.parse(fs.readFileSync(file))

export function inventoryPackages(application) {
  const packages = []
  const visited = new Set()
  const visit = modules => {
    if (!fs.existsSync(modules)) return
    for (const entry of fs.readdirSync(modules).sort()) {
      if (entry.startsWith('.')) continue
      const candidates = entry.startsWith('@')
        ? fs.readdirSync(path.join(modules, entry)).sort().map(name => path.join(modules, entry, name))
        : [path.join(modules, entry)]
      for (const directory of candidates) {
        if (!fs.existsSync(path.join(directory, 'package.json'))) continue
        const real = fs.realpathSync(directory)
        if (!real.startsWith(`${fs.realpathSync(application)}${path.sep}`)) throw new Error('dependency escapes staged application')
        if (visited.has(real)) continue
        visited.add(real)
        const manifest = read(path.join(directory, 'package.json'))
        if (!manifest.name || !manifest.version || typeof manifest.license !== 'string') throw new Error(`license metadata missing: ${manifest.name ?? entry}`)
        const notices = fs.readdirSync(directory).filter(file => /^(licen[cs]e|copying|notice)([.-]|$)/iu.test(file)
          && fs.statSync(path.join(directory, file)).isFile()).sort()
        const repository = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url ?? null
        packages.push({ name: manifest.name, version: manifest.version, license: manifest.license,
          repository, path: path.relative(application, directory).split(path.sep).join('/'),
          notices: notices.map(file => ({ file: path.relative(application, path.join(directory, file)).split(path.sep).join('/'), sha256: sha(fs.readFileSync(path.join(directory, file))) })) })
        visit(path.join(directory, 'node_modules'))
      }
    }
  }
  visit(path.join(application, 'node_modules'))
  return packages.sort((a, b) => `${a.name}@${a.version}:${a.path}`.localeCompare(`${b.name}@${b.version}:${b.path}`, 'en'))
}

export function generateDistributionNotices(application, resources) {
  const packages = inventoryPackages(application)
  const destination = path.join(resources, 'third-party')
  fs.rmSync(destination, { recursive: true, force: true })
  fs.mkdirSync(path.join(destination, 'texts'), { recursive: true })
  const sources = read(path.join(root, 'third-party/license-sources.json'))
  for (const source of sources) {
    if (sha(fs.readFileSync(path.join(root, source.file))) !== source.sha256) throw new Error(`supplemental license digest mismatch: ${source.id}`)
  }
  const supplemental = id => {
    const source = sources.find(item => item.id === id)
    if (!source) throw new Error(`supplemental license missing: ${id}`)
    return { source: source.url, bytes: fs.readFileSync(path.join(root, source.file)) }
  }
  const retain = (bytes, source) => {
    const digest = sha(bytes)
    const file = `texts/${digest}.txt`
    fs.writeFileSync(path.join(destination, file), bytes)
    return { file, sha256: digest, source }
  }
  const blockers = []
  for (const item of packages) {
    item.notices = item.notices.map(notice => retain(fs.readFileSync(path.join(application, notice.file)), notice.file))
    if (item.notices.length === 0) {
      let extra
      if (item.name === '@xterm/headless' && item.version === '6.0.0') extra = supplemental('xterm')
      else if (['@earendil-works/pi-ai', '@earendil-works/pi-telemetry'].includes(item.name) && item.version === '0.85.1') extra = supplemental('pi')
      else if (item.name === 'standardwebhooks' && item.version === '1.1.1') extra = supplemental('standardwebhooks')
      else if (item.name.startsWith('@aws-sdk/') && item.repository?.includes('aws/aws-sdk-js-v3')) {
        const file = 'node_modules/@aws-sdk/types/LICENSE'
        extra = { source: `same SDK repository license shipped in ${file}`, bytes: fs.readFileSync(path.join(application, file)) }
      } else if (item.name.startsWith('@koromix/koffi-') && item.version === '3.2.1') {
        const counterpart = read(path.join(application, 'node_modules/koffi/package.json'))
        if (counterpart.version !== item.version) throw new Error('Koffi license source version mismatch')
        const file = 'node_modules/koffi/LICENSE.txt'
        extra = { source: `same-version parent package ${file}`, bytes: fs.readFileSync(path.join(application, file)) }
      } else if (item.name === 'data-uri-to-buffer' && item.version === '4.0.1') {
        const file = `${item.path}/README.md`
        const text = fs.readFileSync(path.join(application, file), 'utf8')
        const start = text.indexOf('(The MIT License)')
        if (start < 0 || !text.includes('Permission is hereby granted')) throw new Error('embedded MIT license unavailable')
        extra = { source: file, bytes: Buffer.from(text.slice(start)) }
      }
      if (extra) item.notices.push(retain(extra.bytes, extra.source))
    }
    if (item.name.startsWith('@img/sharp-libvips-') || item.name.startsWith('@img/sharp-win32-')) {
      if (item.name.startsWith('@img/sharp-libvips-')) {
        const extra = supplemental('libvips-notices')
        item.notices.push(retain(extra.bytes, extra.source))
      }
      const versions = path.join(application, item.path, 'versions.json')
      item.nativeComponents = fs.existsSync(versions) ? read(versions) : {}
      item.notices.push(retain(fs.readFileSync(path.join(application, item.path, 'README.md')), `${item.path}/README.md`))
      for (const reason of retainNativeMaterials(item, application, destination)) {
        blockers.push({ package: `${item.name}@${item.version}`, reason })
      }
    }
    if (item.notices.length === 0) blockers.push({ package: `${item.name}@${item.version}`, reason: 'No shipped or verified supplemental license text.' })
  }
  const manifest = read(path.join(root, 'package.json'))
  const inventory = { schema: 'dsh-work.distribution-notices.v1', projectLicense: manifest.license,
    platform: process.platform, arch: process.arch,
    lockfileSHA256: sha(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))), packages, blockers }
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(resources, 'LICENSE.dsh-work.txt'))
  fs.writeFileSync(path.join(destination, 'inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`)
  const lines = ['# Third-party distribution notices', '', `Platform: ${process.platform} ${process.arch}. Production packages: ${packages.length}.`, '',
    'DSH Work uses MIT. Dependencies retain their own licenses. Node notices are in ../runtime/node/LICENSE; Electron and Chromium notices are copied alongside this inventory.', '',
    '| Package | License | Notice files |', '| --- | --- | --- |',
    ...packages.map(item => `| ${item.name}@${item.version} | ${item.license} | ${item.notices.map(notice => `[text](${notice.file})`).join(', ') || 'MISSING'} |`),
    '', '## Native sources and replacement', '', 'When present, [native/REBUILDING.md](native/REBUILDING.md) describes the supplied source archives, notices, build recipes and library replacement. The inventory binds them to actual native binary digests.', '', '## Pending distribution materials', '', ...blockers.map(item => `- ${item.package}: ${item.reason}`)]
  fs.writeFileSync(path.join(destination, 'THIRD-PARTY-NOTICES.md'), `${lines.join('\n')}\n`)
  return inventory
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const inventory = generateDistributionNotices(path.join(root, 'artifacts/package/application'), path.join(root, 'artifacts/package/resources'))
  console.log(`Inventoried ${inventory.packages.length} production packages; ${inventory.blockers.length} distribution-material blockers.`)
  if (process.argv.includes('--release')) {
    if (inventory.blockers.length) {
      for (const blocker of inventory.blockers.slice(0, 5)) console.error(`${blocker.package}: ${blocker.reason}`)
      throw new Error('distribution material gate is not complete; run pnpm notices:prepare-native and inspect artifacts/package/resources/third-party/inventory.json')
    }
    const replacement = verifyNativeReplacement(path.join(root, 'artifacts/package/application'))
    fs.writeFileSync(path.join(root, 'artifacts/package/resources/third-party/native-replacement-smoke.json'), `${JSON.stringify(replacement, null, 2)}\n`)
    console.log('Native addon accepts modified ABI-compatible library bytes.')
  }
}
