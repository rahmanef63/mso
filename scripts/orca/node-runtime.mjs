/**
 * Node runtime fetcher, verifier, and unpacker.
 * Pin: Node 24.21.0 linux-x64-glibc with double SHA256 integrity check.
 */

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { PINNED_NODE, isSupportedTarget } from './constants.mjs'

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

export async function verifyFileSha256(filePath, expected, label = 'File') {
  const actual = await fileSha256(filePath)
  if (actual !== expected) {
    throw new Error(`${label} checksum mismatch: expected ${expected}, got ${actual}`)
  }
}

export async function fetchAndMaterializeNodeRuntime({
  target = 'linux-x64-glibc',
  runtimesDir,
  signal
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
    const s = await stat(destination)
    if (s.isFile()) {
      const hash = await fileSha256(destination)
      if (hash === PINNED_NODE.executableSha256) {
        await chmod(destination, 0o755)
        return destination
      }
    }
  } catch {
    // Needs download and extraction
  }

  const targetBinDir = dirname(destination)
  await mkdir(targetBinDir, { recursive: true })

  const stagingDir = join(runtimesDir, `.staging-node-${process.pid}-${randomUUID()}`)
  await mkdir(stagingDir, { recursive: true })

  const archivePath = join(stagingDir, 'node-runtime.tar.gz')

  try {
    // Download tarball via fetch
    const response = await fetch(PINNED_NODE.archiveUrl, { signal })
    if (!response.ok) {
      throw new Error(`Failed to download Node runtime: HTTP ${response.status} ${response.statusText}`)
    }
    const arrayBuf = await response.arrayBuffer()
    const archiveBuf = Buffer.from(arrayBuf)

    verifyArchiveBuffer(archiveBuf, PINNED_NODE.archiveSha256)

    // Extract tar.gz executable member
    const extractProcess = spawn('tar', [
      '-xzf',
      '-',
      '-C',
      stagingDir,
      '--strip-components=2',
      PINNED_NODE.tarMember
    ], { stdio: ['pipe', 'pipe', 'pipe'] })

    await new Promise((resolve, reject) => {
      extractProcess.on('error', reject)
      extractProcess.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`tar extraction failed with code ${code}`))
      })
      extractProcess.stdin.end(archiveBuf)
    })

    const extractedBinary = join(stagingDir, 'node')
    await verifyFileSha256(extractedBinary, PINNED_NODE.executableSha256, 'Extracted Node executable')
    await chmod(extractedBinary, 0o755)

    // Atomic move into destination
    await rename(extractedBinary, destination)
    await chmod(destination, 0o755)

    return destination
  } finally {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
  }
}
