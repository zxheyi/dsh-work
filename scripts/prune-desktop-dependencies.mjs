import fs from 'node:fs'
import path from 'node:path'

// Only mutate the production staging tree, never the upstream or developer install.
// Keep TS, declarations, README/license texts and package exports: Harness loads
// plugins dynamically and dependencies can carry runtime assets beside sources.
export function pruneDesktopDependencies(modules, platform = process.platform, arch = process.arch) {
  if (!['darwin-arm64', 'win32-x64'].includes(`${platform}-${arch}`)) throw new Error('unsupported dependency pruning target')
  const removed = []
  const walk = directory => {
    const before = removed.length
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      const relative = path.relative(modules, file).split(path.sep).join('/')
      if (entry.isDirectory()) { walk(file); continue }
      const pty = relative.match(/^node-pty\/prebuilds\/([^/]+)\//u)
      const reason = pty && pty[1] !== `${platform}-${arch}` ? 'foreign-pty-prebuild'
        : /^node-pty\/lib\/.*\.test\.js(?:\.map)?$/u.test(relative) || relative.startsWith('@mixmark-io/domino/test/') ? 'reviewed-test-fixture'
          : /\.(?:[cm]?js|css|d\.[cm]?ts)\.map$/u.test(entry.name) ? 'debug-map' : null
      if (reason) {
        removed.push({ file: relative, bytes: fs.statSync(file).size, reason })
        fs.unlinkSync(file)
      }
    }
    // Leave no empty foreign prebuild directories for node-pty's path lookup.
    if (directory !== modules && removed.length > before && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory)
  }
  walk(modules)
  return { platform, arch, bytesRemoved: removed.reduce((total, item) => total + item.bytes, 0), removed }
}
