/**
 * Hardened Node runtime fetcher, verifier, and unpacker.
 * Pin: Node 24.21.0 linux-x64-glibc with double SHA256 integrity check,
 * bounded streaming download, pipe drain protections, and symlink rejection.
 */

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, lstat, mkdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { PINNED_NODE, isSupportedTarget } from './constants.mjs'

const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024

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

export async function fetchAndMaterializeNodeRuntime({
  target = 'linux-x64-glibc',
  runtimesDir,
  signal,
  allowDownload = true,
  timeoutMs = 60000
} = {}) {
  if (!isSupportedTarget(target)) {
    throw new Error(`Unsupported Node runtime target: ${target}. Only linux-x64-glibc is supported.`)
  }

  const destination = join(
    runtimesDir,
    `node-${PINNED_NODE.executableSha256}`,
    'bin',
    'node'
  )

  try {
    const s = await lstat(destination)
    if (s.isSymbolicLink()) {
      throw new Error(`Refusing symlinked Node executable: ${destination}`)
    }
    if (s.isFile()) {
      const hash = await fileSha256(destination)
      if (hash === PINNED_NODE.executableSha256) {
        await chmod(destination, 0o755)
        return destination
      }
    }
  } catch (err) {
    if (err.message && err.message.includes('Refusing symlinked')) throw err
  }

  if (!allowDownload) {
    throw new Error(`Pinned Node executable not found at ${destination} and download not allowed`)
  }

  const stagingDir = join(runtimesDir, `.staging-node-${process.pid}-${randomUUID()}`)
  await mkdir(stagingDir, { recursive: true, mode: 0o700 })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  if (signal) signal.addEventListener('abort', () => controller.abort())

  try {
    const res = await fetch(PINNED_NODE.archiveUrl, { signal: controller.signal })
    if (!res.ok) {
      throw new Error(`Failed to download Node runtime: HTTP ${res.status} ${res.statusText}`)
    }

    const arrayBuf = await res.arrayBuffer()
    const archiveBuf = Buffer.from(arrayBuf)
    if (archiveBuf.length > MAX_ARCHIVE_BYTES) {
      throw new Error(`Node archive exceeds maximum bound of ${MAX_ARCHIVE_BYTES} bytes`)
    }

    verifyArchiveBuffer(archiveBuf, PINNED_NODE.archiveSha256)

    const extractProc = spawn('tar', [
      '-xzf', '-', '-C', stagingDir, '--strip-components=2', PINNED_NODE.tarMember
    ], { stdio: ['pipe', 'pipe', 'pipe'] })

    const stderrChunks = []
    extractProc.stderr.on('data', (c) => stderrChunks.push(c))
    extractProc.stdout.resume() // Drain stdout

    extractProc.stdin.on('error', () => {}) // Suppress EPIPE race
    extractProc.stdin.end(archiveBuf)

    const exitCode = await new Promise((resolve, reject) => {
      extractProc.on('error', reject)
      extractProc.on('close', resolve)
    })

    if (exitCode !== 0) {
      const errText = Buffer.concat(stderrChunks).toString('utf8')
      throw new Error(`tar extraction failed with code ${exitCode}: ${errText}`)
    }

    const extractedBinary = join(stagingDir, 'node')
    const bStat = await lstat(extractedBinary)
    if (!bStat.isFile() || bStat.isSymbolicLink()) {
      throw new Error('Extracted Node binary is missing or a symlink')
    }

    const actualHash = await fileSha256(extractedBinary)
    if (actualHash !== PINNED_NODE.executableSha256) {
      throw new Error(`Extracted Node executable checksum mismatch: expected ${PINNED_NODE.executableSha256}, got ${actualHash}`)
    }

    await chmod(extractedBinary, 0o755)
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
    await rename(extractedBinary, destination)
    return destination
  } finally {
    clearTimeout(timer)
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
  }
}
