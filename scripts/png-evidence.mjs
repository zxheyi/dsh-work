import { inflateSync } from 'node:zlib'

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex')
const CRC_TABLE = new Uint32Array(256)

for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  CRC_TABLE[index] = value >>> 0
}

function crc32(data) {
  let value = 0xffffffff
  for (const byte of data) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

export function inspectPng(data, label = 'PNG') {
  const invalid = reason => { throw new Error(`${label}: ${reason}`) }
  if (!Buffer.isBuffer(data) || data.length < 45 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    invalid('invalid signature or truncated file')
  }

  let offset = 8
  let width = 0
  let height = 0
  let channels = 0
  let sawHeader = false
  let sawEnd = false
  const imageParts = []

  while (offset < data.length) {
    if (offset + 12 > data.length) invalid('truncated chunk header')
    const length = data.readUInt32BE(offset)
    const type = data.subarray(offset + 4, offset + 8).toString('ascii')
    const payloadStart = offset + 8
    const payloadEnd = payloadStart + length
    const chunkEnd = payloadEnd + 4
    if (chunkEnd > data.length) invalid(`truncated ${type || 'unknown'} chunk`)
    const storedCrc = data.readUInt32BE(payloadEnd)
    const actualCrc = crc32(data.subarray(offset + 4, payloadEnd))
    if (storedCrc !== actualCrc) invalid(`${type} checksum mismatch`)

    if (!sawHeader && type !== 'IHDR') invalid('IHDR must be the first chunk')
    if (type === 'IHDR') {
      if (sawHeader || length !== 13) invalid('invalid IHDR')
      sawHeader = true
      width = data.readUInt32BE(payloadStart)
      height = data.readUInt32BE(payloadStart + 4)
      const bitDepth = data[payloadStart + 8]
      const colorType = data[payloadStart + 9]
      const compression = data[payloadStart + 10]
      const filter = data[payloadStart + 11]
      const interlace = data[payloadStart + 12]
      if (width < 1 || height < 1 || width > 10_000 || height > 10_000) invalid('invalid dimensions')
      if (bitDepth !== 8 || ![2, 6].includes(colorType)) invalid('only 8-bit RGB/RGBA evidence is supported')
      if (compression !== 0 || filter !== 0 || interlace !== 0) invalid('unsupported PNG encoding')
      channels = colorType === 2 ? 3 : 4
    } else if (type === 'IDAT') {
      if (!sawHeader || sawEnd) invalid('IDAT has invalid position')
      imageParts.push(data.subarray(payloadStart, payloadEnd))
    } else if (type === 'IEND') {
      if (length !== 0 || sawEnd) invalid('invalid IEND')
      sawEnd = true
      if (chunkEnd !== data.length) invalid('bytes found after IEND')
    }
    offset = chunkEnd
  }

  if (!sawHeader || !sawEnd || imageParts.length < 1) invalid('missing required chunks')
  const rowLength = 1 + width * channels
  const decodedLength = rowLength * height
  if (!Number.isSafeInteger(decodedLength) || decodedLength > 200_000_000) invalid('decoded image is too large')
  let pixels
  try {
    pixels = inflateSync(Buffer.concat(imageParts), { maxOutputLength: decodedLength })
  } catch (error) {
    invalid(`IDAT cannot be decoded: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (pixels.length !== decodedLength) invalid('decoded pixel length does not match IHDR')
  for (let row = 0; row < height; row += 1) {
    if (pixels[row * rowLength] > 4) invalid(`invalid scanline filter at row ${row}`)
  }
  return { width, height }
}
