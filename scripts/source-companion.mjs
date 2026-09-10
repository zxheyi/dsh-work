import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const requireEvidence = (condition, message) => { if (!condition) throw new Error(message) }
const schema = 'dsh-work.source-companion.v1'
const rootName = 'DSH-Work-native-sources'
export const sourceArchiveName = (version, platform, arch) => {
  requireEvidence(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/u.test(version), 'invalid source version')
  requireEvidence(['darwin-arm64', 'win32-x64'].includes(`${platform}-${arch}`), 'unsupported source platform')
  return `DSH-Work-${version}-${platform}-${arch}-sources.tar.gz`
}

export function stageSourceCompanion({ resources, output, version, platform, arch }) {
  const file = sourceArchiveName(version, platform, arch)
  const thirdParty = path.join(resources, 'third-party')
  const native = path.join(thirdParty, 'native')
  const lockPath = path.join(native, 'materials.json')
  const materialLockSHA256 = sha(lockPath)
  fs.mkdirSync(output, { recursive: true })
  const temporary = fs.mkdtempSync(path.join(output, '.source-stage-'))
  const archive = path.join(output, file)
  try {
    fs.cpSync(native, path.join(temporary, rootName, 'native'), { recursive: true })
    fs.writeFileSync(path.join(temporary, rootName, 'README.md'), '# DSH Work native source materials\n\nMatching application: ' + version + ' ' + platform + ' ' + arch + '.\n\nSee native/REBUILDING.md for original archives, build prerequisites and library replacement. Retain this asset alongside the application download.\n')
    execFileSync('tar', ['-czf', archive, '-C', temporary, rootName], { stdio: 'inherit', env: { ...process.env, COPYFILE_DISABLE: '1' } })
    const descriptor = { schema, version, platform, arch, file, bytes: fs.statSync(archive).size, sha256: sha(archive), materialLockSHA256 }
    fs.writeFileSync(path.join(thirdParty, 'source-companion.json'), `${JSON.stringify(descriptor, null, 2)}\n`)
    // Original license, attribution, build and relinking texts remain installed.
    // Remove only source archives actually supplied by this platform's material set.
    const lock = JSON.parse(fs.readFileSync(lockPath))
    for (const material of lock.materials.filter(item => item.kind === 'source')) {
      requireEvidence(path.basename(material.file) === material.file, 'source material must be a flat filename')
      fs.rmSync(path.join(native, material.file), { force: true })
    }
    fs.writeFileSync(path.join(thirdParty, 'SOURCE-DOWNLOAD.md'), `# Matching native sources\n\nDownload **${file}** from the same download entry as this application.\n\nSHA256: \`${descriptor.sha256}\`\n\nExtract it and read DSH-Work-native-sources/native/REBUILDING.md. Notices and replacement instructions remain in this application. Sources are not needed at application startup. Distribute the application and its source asset together; the paired receipt and checksums identify both files.\n`)
    const notices = path.join(thirdParty, 'THIRD-PARTY-NOTICES.md')
    if (fs.existsSync(notices)) fs.appendFileSync(notices, '\n## Companion source download\n\nOriginal source archives are supplied separately. See [SOURCE-DOWNLOAD.md](SOURCE-DOWNLOAD.md) for the exact filename and SHA256.\n')
    return descriptor
  } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
}

// The archive gate validates the actual companion bytes, not a URL/source offer.
// The app embeds this identity before signing and the relocated launch smoke.
export function withSourceCompanion(thirdParty, archive, verify) {
  const descriptor = JSON.parse(fs.readFileSync(path.join(thirdParty, 'source-companion.json')))
  requireEvidence(descriptor.schema === schema && path.basename(archive) === sourceArchiveName(descriptor.version, descriptor.platform, descriptor.arch)
    && descriptor.file === path.basename(archive), 'source archive identity mismatch')
  requireEvidence(fs.lstatSync(archive).isFile() && fs.statSync(archive).size === descriptor.bytes && sha(archive) === descriptor.sha256, 'source archive digest mismatch')
  requireEvidence(sha(path.join(thirdParty, 'native/materials.json')) === descriptor.materialLockSHA256, 'source material lock mismatch')
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-source-verify-'))
  try {
    execFileSync('tar', ['-xf', archive, '-C', temporary], { stdio: 'pipe' })
    const native = path.join(temporary, rootName, 'native')
    requireEvidence(sha(path.join(native, 'materials.json')) === descriptor.materialLockSHA256, 'extracted source material lock mismatch')
    return verify(native, descriptor)
  } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
}
