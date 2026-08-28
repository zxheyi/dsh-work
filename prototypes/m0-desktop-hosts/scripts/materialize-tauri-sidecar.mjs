import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const explicitTarget = process.argv[2]
const defaultTarget = process.platform === 'darwin' && process.arch === 'arm64'
  ? 'aarch64-apple-darwin'
  : process.platform === 'win32' && process.arch === 'x64'
    ? 'x86_64-pc-windows-msvc'
    : null
const target = explicitTarget ?? defaultTarget

if (!target) {
  throw new Error(`unsupported prototype host ${process.platform}/${process.arch}; pass a Rust target triple`)
}

const source = process.env.DSH_WORK_NODE || process.execPath
const extension = target.includes('windows') ? '.exe' : ''
const destination = path.join(root, 'tauri', 'src-tauri', 'binaries', `node-${target}${extension}`)
const icon = path.join(root, 'tauri', 'src-tauri', 'icons', 'icon.png')

fs.mkdirSync(path.dirname(destination), { recursive: true })
fs.copyFileSync(source, destination)
if (!target.includes('windows')) fs.chmodSync(destination, 0o755)
fs.mkdirSync(path.dirname(icon), { recursive: true })
fs.writeFileSync(icon, Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8WQAAAABJRU5ErkJggg==',
  'base64',
))

console.log(JSON.stringify({ source, destination, icon, target }))
