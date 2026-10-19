/**
 * Bounded, symlink-proof, owner-checked filesystem reading for Orca unit files.
 * Uses pinned-directory descriptors and cap+1 bounded reads.
 */

import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

export const UNIT_MAX_BYTES = 32 * 1024

export function ownerUidMatches(uid) {
  return typeof process.getuid !== 'function' || uid === process.getuid()
}

/** Read at most `maxBytes`; a file that reaches cap+1 is refused. */
export async function readBounded(handle, maxBytes) {
  const chunks = []
  let total = 0
  for (;;) {
    const remaining = maxBytes + 1 - total
    if (remaining <= 0) return null
    const chunk = Buffer.alloc(Math.min(remaining, 16 * 1024))
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, null)
    if (bytesRead === 0) break
    total += bytesRead
    if (total > maxBytes) return null
    chunks.push(chunk.subarray(0, bytesRead))
  }
  return Buffer.concat(chunks, total)
}

/**
 * Pinned directory descriptor, symlink-proof, bounded read for a unit file.
 */
export async function readOwnedUnitFile(
  unitPath,
  uid = typeof process.getuid === 'function' ? process.getuid() : null,
  maxBytes = UNIT_MAX_BYTES
) {
  const dir = dirname(unitPath)
  const filename = basename(unitPath)

  let canonicalDir
  try {
    canonicalDir = await realpath(dir)
  } catch (err) {
    if (err?.code === 'ENOENT') return null
    throw err
  }
  if (canonicalDir !== resolve(dir)) {
    throw new Error(`refusing a symlinked unit directory: ${dir}`)
  }

  let directory
  try {
    directory = await open(canonicalDir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  } catch (err) {
    if (err?.code === 'ENOENT') return null
    throw err
  }

  try {
    const dirStat = await directory.stat()
    if (!dirStat.isDirectory()) {
      throw new Error(`refusing non-directory unit directory: ${dir}`)
    }
    if (uid !== null && !ownerUidMatches(dirStat.uid)) {
      throw new Error(`refusing a unit directory not owned by this user: ${dir}`)
    }
    if ((dirStat.mode & 0o022) !== 0) {
      throw new Error(`refusing a group- or world-writable unit directory: ${dir}`)
    }

    let handle
    try {
      handle = await open(
        `/proc/self/fd/${directory.fd}/${filename}`,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
      )
    } catch (err) {
      if (err?.code === 'ENOENT') return null
      throw err
    }

    try {
      const before = await handle.stat()
      if (!before.isFile() || before.isSymbolicLink()) {
        throw new Error(`refusing a non-regular unit: ${unitPath}`)
      }
      if (uid !== null && !ownerUidMatches(before.uid)) {
        throw new Error(`refusing a unit not owned by this user: ${unitPath}`)
      }
      if ((before.mode & 0o022) !== 0) {
        throw new Error(`refusing a group- or world-writable unit: ${unitPath}`)
      }
      if (before.size > maxBytes) {
        throw new Error(`refusing unit exceeding maximum size of ${maxBytes} bytes: ${unitPath}`)
      }

      const buffer = await readBounded(handle, maxBytes)
      if (buffer === null) {
        throw new Error(`refusing unit exceeding maximum size of ${maxBytes} bytes: ${unitPath}`)
      }

      const after = await handle.stat()
      if (
        after.size !== buffer.length ||
        after.ino !== before.ino ||
        after.dev !== before.dev ||
        after.mtimeMs !== before.mtimeMs ||
        after.mode !== before.mode
      ) {
        throw new Error(`refusing unit modified or replaced during read: ${unitPath}`)
      }

      return buffer.toString('utf8')
    } finally {
      await handle.close()
    }
  } finally {
    await directory.close()
  }
}
