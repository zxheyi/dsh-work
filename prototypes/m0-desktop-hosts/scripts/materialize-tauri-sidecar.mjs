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
const windowsIcon = path.join(root, 'tauri', 'src-tauri', 'icons', 'icon.ico')
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8WQAAAABJRU5ErkJggg==',
  'base64',
)

fs.mkdirSync(path.dirname(destination), { recursive: true })
fs.copyFileSync(source, destination)
if (!target.includes('windows')) fs.chmodSync(destination, 0o755)
fs.mkdirSync(path.dirname(icon), { recursive: true })
fs.writeFileSync(icon, png)

const icoHeader = Buffer.alloc(22)
icoHeader.writeUInt16LE(0, 0)
icoHeader.writeUInt16LE(1, 2)
icoHeader.writeUInt16LE(1, 4)
icoHeader.writeUInt8(1, 6)
icoHeader.writeUInt8(1, 7)
icoHeader.writeUInt16LE(1, 10)
icoHeader.writeUInt16LE(32, 12)
icoHeader.writeUInt32LE(png.length, 14)
icoHeader.writeUInt32LE(icoHeader.length, 18)
fs.writeFileSync(windowsIcon, Buffer.concat([icoHeader, png]))

console.log(JSON.stringify({ source, destination, icon, windowsIcon, target }))
