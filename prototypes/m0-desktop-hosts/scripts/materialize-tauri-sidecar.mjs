import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

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

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii')
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  name.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length)
  return chunk
}

const pngHeader = Buffer.alloc(13)
pngHeader.writeUInt32BE(1, 0)
pngHeader.writeUInt32BE(1, 4)
pngHeader.writeUInt8(8, 8)
pngHeader.writeUInt8(6, 9)
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  pngChunk('IHDR', pngHeader),
  pngChunk('IDAT', zlib.deflateSync(Buffer.from([0x00, 0x20, 0x50, 0x80, 0xff]))),
  pngChunk('IEND', Buffer.alloc(0)),
])

fs.mkdirSync(path.dirname(destination), { recursive: true })
fs.copyFileSync(source, destination)
if (!target.includes('windows')) fs.chmodSync(destination, 0o755)
fs.mkdirSync(path.dirname(icon), { recursive: true })
fs.writeFileSync(icon, png)

const dib = Buffer.alloc(48)
dib.writeUInt32LE(40, 0)
dib.writeInt32LE(1, 4)
dib.writeInt32LE(2, 8)
dib.writeUInt16LE(1, 12)
dib.writeUInt16LE(32, 14)
dib.writeUInt32LE(4, 20)
Buffer.from([0x80, 0x50, 0x20, 0xff]).copy(dib, 40)

const icoHeader = Buffer.alloc(22)
icoHeader.writeUInt16LE(0, 0)
icoHeader.writeUInt16LE(1, 2)
icoHeader.writeUInt16LE(1, 4)
icoHeader.writeUInt8(1, 6)
icoHeader.writeUInt8(1, 7)
icoHeader.writeUInt16LE(1, 10)
icoHeader.writeUInt16LE(32, 12)
icoHeader.writeUInt32LE(dib.length, 14)
icoHeader.writeUInt32LE(icoHeader.length, 18)
fs.writeFileSync(windowsIcon, Buffer.concat([icoHeader, dib]))

console.log(JSON.stringify({ source, destination, icon, windowsIcon, target }))
