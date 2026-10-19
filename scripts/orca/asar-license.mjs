/**
 * Read a single bounded entry from an Electron `app.asar` archive.
 *
 * Only a fixed relative entry name is accepted. Header/file offsets, sizes, and
 * archive bounds are validated before allocation; the extracted bytes are
 * verified against the pinned SHA-256 and written with a private mode.
 */

import { createHash } from 'node:crypto'
import { open, writeFile } from 'node:fs/promises'
import { assertNoSymlinkAncestors, assertOwnedRegularFile, isSafeRelativePath } from './safe-paths.mjs'

const MAX_HEADER_BYTES = 16 * 1024 * 1024
const MAX_ENTRY_BYTES = 4 * 1024 * 1024

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

export async function readAsarEntry({
  asarPath,
  entryName,
  expectedSha256,
  maxBytes = MAX_ENTRY_BYTES
} = {}) {
  if (!isSafeRelativePath(entryName)) throw new Error(`Unsafe asar entry name: ${entryName}`)
  const archiveStat = await assertOwnedRegularFile(asarPath)
  const handle = await open(asarPath, 'r')
  try {
    const head = Buffer.alloc(16)
    await handle.read(head, 0, head.length, 0)
    if (head.readUInt32LE(0) !== 4) throw new Error('Unsupported asar header')
    const headerSize = head.readUInt32LE(4)
    const headerJsonSize = head.readUInt32LE(12)
    if (headerJsonSize <= 0 || headerJsonSize > MAX_HEADER_BYTES) {
      throw new Error(`Invalid asar header size: ${headerJsonSize}`)
    }
    if (16 + headerJsonSize > archiveStat.size) throw new Error('Asar header exceeds archive bounds')
    const headerBytes = Buffer.alloc(headerJsonSize)
    await handle.read(headerBytes, 0, headerBytes.length, 16)
    const header = JSON.parse(headerBytes.toString('utf8'))
    let node = header
    for (const segment of entryName.split('/')) {
      node = node?.files?.[segment]
      if (!node) throw new Error(`Asar entry not found: ${entryName}`)
    }
    const size = node.size
    const offset = Number(node.offset)
    if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes) {
      throw new Error(`Invalid asar entry size for ${entryName}: ${size}`)
    }
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new Error(`Invalid asar entry offset for ${entryName}: ${node.offset}`)
    }
    const dataStart = 8 + headerSize
    const start = dataStart + offset
    const end = start + size
    if (end > archiveStat.size) throw new Error(`Asar entry exceeds archive bounds: ${entryName}`)
    const data = Buffer.alloc(size)
    await handle.read(data, 0, size, start)
    const actual = sha256(data)
    if (node.integrity?.hash && node.integrity.hash !== actual) {
      throw new Error(`Asar entry integrity mismatch: ${entryName}`)
    }
    if (expectedSha256 !== undefined && actual !== expectedSha256) {
      throw new Error(`Asar entry checksum mismatch: expected ${expectedSha256}, got ${actual}`)
    }
    return { data, sha256: actual, size }
  } finally {
    await handle.close()
  }
}

export async function extractAsarEntry({
  asarPath,
  entryName,
  destination,
  expectedSha256
} = {}) {
  await assertNoSymlinkAncestors(destination)
  const entry = await readAsarEntry({ asarPath, entryName, expectedSha256 })
  await writeFile(destination, entry.data, { mode: 0o600, flag: 'wx' })
  return { path: destination, sha256: entry.sha256, size: entry.size }
}
