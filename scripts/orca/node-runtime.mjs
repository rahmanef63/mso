/**
 * Pinned Node runtime acquisition.
 *
 * Pin: Node v24.21.0 linux-x64-glibc. The archive digest is verified while
 * streaming to a private file; the single `bin/node` member is extracted to a
 * fresh staging file, re-hashed against the executable pin, and only then
 * published. A cached executable is reused only after re-hashing every byte;
 * a torn or mismatched cache is refused, never overwritten. There is no host
 * Node fallback.
 */

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, mkdir, open, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { PINNED_NODE, isSupportedTarget } from './constants.mjs'
import { downloadToFile } from './download.mjs'
import { runBoundedProcess } from './bounded-process.mjs'
import {
  assertNoSymlinkAncestors,
  assertOwnedRegularFile,
  ensurePrivateDirTree,
  lstatOrNull
} from './safe-paths.mjs'

const MAX_EXECUTABLE_BYTES = 256 * 1024 * 1024

export function verifyBufferSha256(buffer, expected, label = 'Buffer') {
  const hash = createHash('sha256').update(buffer).digest('hex')
  if (hash !== expected) {
    throw new Error(`${label} checksum mismatch: expected ${expected}, got ${hash}`)
  }
}

export function verifyExecutableBuffer(buffer, expected) {
  verifyBufferSha256(buffer, expected, 'Executable')
}

export function verifyArchiveBuffer(buffer, expected) {
  verifyBufferSha256(buffer, expected, 'Archive')
}

export async function fileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

async function verifyCachedNode(destination) {
  const s = await assertOwnedRegularFile(destination)
  const actual = await fileSha256(destination)
  if (actual !== PINNED_NODE.executableSha256) {
    throw new Error(
      `Cached Node checksum mismatch (${actual}); refusing to overwrite ${destination}`
    )
  }
  if ((s.mode & 0o100) === 0) await chmod(destination, 0o700)
  return destination
}

async function downloadArchive({ downloadsDir, signal, timeoutMs, fetchImpl }) {
  const archivePath = join(downloadsDir, 'node-v24.21.0-linux-x64.tar.gz')
  const existing = await lstatOrNull(archivePath)
  if (existing) {
    const s = await assertOwnedRegularFile(archivePath)
    if (s.size !== PINNED_NODE.archiveSize) {
      throw new Error(`Cached Node archive size mismatch; refusing to overwrite ${archivePath}`)
    }
    const actual = await fileSha256(archivePath)
    if (actual !== PINNED_NODE.archiveSha256) {
      throw new Error(`Cached Node archive checksum mismatch; refusing to overwrite ${archivePath}`)
    }
    return archivePath
  }
  const result = await downloadToFile({
    url: PINNED_NODE.archiveUrl,
    expectedUrl: PINNED_NODE.archiveUrl,
    destination: archivePath,
    expectedSha256: PINNED_NODE.archiveSha256,
    expectedSize: PINNED_NODE.archiveSize,
    maxBytes: PINNED_NODE.archiveSize,
    signal,
    timeoutMs,
    fetchImpl
  })
  return result.path
}

async function extractNodeBinary({ archivePath, destination, signal, timeoutMs }) {
  const handle = await open(destination, 'wx', 0o600)
  try {
    const res = await runBoundedProcess({
      command: 'tar',
      args: ['-xzf', archivePath, '-O', PINNED_NODE.tarMember],
      timeoutMs,
      signal,
      stdoutFd: handle.fd,
      maxStderrBytes: 65536
    })
    if (res.code !== 0) throw new Error(`tar extraction failed with code ${res.code}: ${res.stderr}`)
    await handle.sync()
  } finally {
    await handle.close()
  }
  const s = await assertOwnedRegularFile(destination)
  if (s.size === 0) throw new Error('Extracted Node executable is empty')
  if (s.size > MAX_EXECUTABLE_BYTES) throw new Error('Extracted Node executable exceeds the size cap')
  const actual = await fileSha256(destination)
  if (actual !== PINNED_NODE.executableSha256) {
    throw new Error(
      `Extracted Node executable checksum mismatch: expected ${PINNED_NODE.executableSha256}, got ${actual}`
    )
  }
  await chmod(destination, 0o700)
}

export async function fetchAndMaterializeNodeRuntime({
  target = 'linux-x64-glibc',
  runtimesDir,
  signal,
  allowDownload = true,
  timeoutMs = 300000,
  fetchImpl
} = {}) {
  if (!isSupportedTarget(target)) {
    throw new Error(`Unsupported Node runtime target: ${target}. Only linux-x64-glibc is supported.`)
  }
  if (typeof runtimesDir !== 'string' || !runtimesDir.startsWith('/')) {
    throw new Error(`runtimesDir must be absolute: ${runtimesDir}`)
  }
  await ensurePrivateDirTree(runtimesDir)
  const runtimeRoot = join(runtimesDir, `node-${PINNED_NODE.executableSha256}`)
  const destination = join(runtimeRoot, 'bin', 'node')

  if (await lstatOrNull(runtimeRoot)) {
    await assertNoSymlinkAncestors(destination)
    if (!(await lstatOrNull(destination))) {
      throw new Error(`Torn Node runtime cache at ${runtimeRoot}; refusing to trust it`)
    }
    return verifyCachedNode(destination)
  }
  if (!allowDownload) {
    throw new Error(`Pinned Node executable not found at ${destination} and download not allowed`)
  }

  const downloadsDir = await ensurePrivateDirTree(join(runtimesDir, '.downloads'))
  const archivePath = await downloadArchive({ downloadsDir, signal, timeoutMs, fetchImpl })
  const stagingDir = join(runtimesDir, `.staging-node-${process.pid}-${randomUUID()}`)
  await assertNoSymlinkAncestors(stagingDir)
  await mkdir(stagingDir, { recursive: false, mode: 0o700 })
  try {
    const stagingBin = join(stagingDir, 'bin')
    await mkdir(stagingBin, { recursive: false, mode: 0o700 })
    await extractNodeBinary({
      archivePath,
      destination: join(stagingBin, 'node'),
      signal,
      timeoutMs
    })
    if (await lstatOrNull(runtimeRoot)) {
      throw new Error(`Node runtime appeared concurrently at ${runtimeRoot}; refusing to overwrite`)
    }
    await rename(stagingDir, runtimeRoot)
    return join(runtimeRoot, 'bin', 'node')
  } finally {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
  }
}
