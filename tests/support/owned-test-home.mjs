import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function removeOwnedTestHome(home) {
  const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(home))
  if (!relative.startsWith('dsh-work-') || path.dirname(relative) !== '.') {
    throw new Error('only a direct dsh-work test home may be removed')
  }
  let root
  try { root = fs.lstatSync(home) } catch (error) {
    if (error?.code === 'ENOENT') return 0
    throw error
  }
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('test home must be an owned directory')
  let detached = 0
  const detachLinks = directory => {
    for (const name of fs.readdirSync(directory)) {
      const entry = path.join(directory, name)
      const stat = fs.lstatSync(entry)
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(entry)
        detached++
      } else if (stat.isDirectory()) detachLinks(entry)
    }
  }
  detachLinks(home)
  // Windows can retain a just-exited process directory handle briefly. Node's
  // bounded EPERM/EBUSY retry applies only when maxRetries is explicit.
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  return detached
}
