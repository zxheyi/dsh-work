import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'dist')
const compiler = path.join(root, 'node_modules/typescript/bin/tsc')

if (!fs.existsSync(compiler)) throw new Error('TypeScript compiler unavailable; run pnpm install')
fs.rmSync(output, { recursive: true, force: true })
execFileSync(process.execPath, [compiler, '-p', path.join(root, 'tsconfig.build.json')], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
})

const assets = [
  'packages/lifecycle-bundle/package.json',
  'packages/lifecycle-bundle/cordis.patch.yml',
  'apps/desktop/index.html',
  'apps/desktop/style.css',
]
for (const relativePath of assets) {
  const target = path.join(output, relativePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(path.join(root, relativePath), target)
}
