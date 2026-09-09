import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

// Stable across relocation: hash relative paths, file bytes, literal symlink targets
// and POSIX executable bits, while excluding timestamps and absolute root paths.
export async function bundleSHA256(directory, { platform = process.platform } = {}) {
  const hash = createHash('sha256')
  const record = value => hash.update(`${JSON.stringify(value)}\n`)
  const visit = async relative => {
    const absolute = path.join(directory, relative)
    const info = fs.lstatSync(absolute)
    if (info.isSymbolicLink()) record(['symlink', relative, fs.readlinkSync(absolute)])
    else if (info.isDirectory()) {
      record(['directory', relative])
      for (const name of fs.readdirSync(absolute).sort()) await visit(relative ? `${relative}/${name}` : name)
    } else if (info.isFile()) {
      const content = createHash('sha256')
      for await (const chunk of fs.createReadStream(absolute)) content.update(chunk)
      record(['file', relative, platform === 'win32' ? null : info.mode & 0o111, content.digest('hex')])
    } else throw new Error(`unsupported bundle file type: ${relative}`)
  }
  await visit('')
  return hash.digest('hex')
}
