/**
 * Orca release artifact (.deb) acquisition and verification.
 * Enforces pinned release v1.4.230 deb SHA256 before extraction.
 */

import { lstat, mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  ORCA_DEB_SHA256,
  ORCA_DEB_URL,
  ORCA_DEB_SIZE
} from './constants.mjs'
import { fileSha256 } from './node-runtime.mjs'

export async function verifyDebHash(filePath, expected = ORCA_DEB_SHA256) {
  const s = await lstat(filePath)
  if (s.isSymbolicLink()) {
    throw new Error(`Refusing symlink deb archive: ${filePath}`)
  }
  const actual = await fileSha256(filePath)
  if (actual !== expected) {
    throw new Error(`Deb archive checksum mismatch: expected ${expected}, got ${actual}`)
  }
  return actual
}

export async function downloadDebArchive({ destination, signal, timeoutMs = 120000 }) {
  const destDir = dirname(destination)
  await mkdir(destDir, { recursive: true, mode: 0o700 })
  const stagingPath = `${destination}.download-${process.pid}-${randomUUID()}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  if (signal) signal.addEventListener('abort', () => controller.abort())

  try {
    const res = await fetch(ORCA_DEB_URL, { signal: controller.signal })
    if (!res.ok) {
      throw new Error(`Failed to download Orca deb archive: HTTP ${res.status} ${res.statusText}`)
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > ORCA_DEB_SIZE * 1.5) {
      throw new Error(`Downloaded deb exceeds size bounds: ${buf.length} bytes`)
    }
    const { writeFile } = await import('node:fs/promises')
    await writeFile(stagingPath, buf, { mode: 0o600 })
    await verifyDebHash(stagingPath, ORCA_DEB_SHA256)
    await rename(stagingPath, destination)
    return destination
  } finally {
    clearTimeout(timeoutId)
    await rm(stagingPath, { force: true }).catch(() => {})
  }
}

export async function acquireAndExtractDeb({
  debPath,
  extractDir,
  signal,
  allowDownload = false,
  timeoutMs = 60000
} = {}) {
  let resolvedDeb = debPath
  if (!resolvedDeb) {
    if (!allowDownload) {
      throw new Error('debPath is required when download is not permitted')
    }
    resolvedDeb = join(dirname(extractDir), 'orca-ide_1.4.230_amd64.deb')
    await downloadDebArchive({ destination: resolvedDeb, signal })
  }

  await verifyDebHash(resolvedDeb, ORCA_DEB_SHA256)

  // Verify extractDir is not a symlink
  try {
    const s = await lstat(extractDir)
    if (s.isSymbolicLink()) {
      throw new Error(`extractDir must not be a symlink: ${extractDir}`)
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }

  const templateDir = join(extractDir, 'opt/Orca/resources/orcad-template')
  const webDir = join(extractDir, 'opt/Orca/resources/app.asar.unpacked/out/web')

  try {
    const [tStat, wStat] = await Promise.all([lstat(templateDir), lstat(webDir)])
    if (tStat.isDirectory() && wStat.isDirectory() && !tStat.isSymbolicLink() && !wStat.isSymbolicLink()) {
      return { templateDir, webDir, debSha256: ORCA_DEB_SHA256 }
    }
  } catch {}

  const stagingDir = join(dirname(extractDir), `.staging-extract-${process.pid}-${randomUUID()}`)
  await mkdir(stagingDir, { recursive: true, mode: 0o700 })

  try {
    const proc = spawn('dpkg-deb', ['-x', resolvedDeb, stagingDir], {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const stderrChunks = []
    proc.stderr.on('data', (c) => stderrChunks.push(c))

    const exitCode = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        proc.kill('SIGTERM')
        reject(new Error(`dpkg-deb extraction timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      proc.on('error', (err) => { clearTimeout(timer); reject(err) })
      proc.on('close', (code) => { clearTimeout(timer); resolve(code) })
    })

    if (exitCode !== 0) {
      const errText = Buffer.concat(stderrChunks).toString('utf8')
      throw new Error(`dpkg-deb failed with code ${exitCode}: ${errText}`)
    }

    const stagedTemplate = join(stagingDir, 'opt/Orca/resources/orcad-template')
    const stagedWeb = join(stagingDir, 'opt/Orca/resources/app.asar.unpacked/out/web')
    const [stStat, swStat] = await Promise.all([lstat(stagedTemplate), lstat(stagedWeb)])
    if (!stStat.isDirectory() || !swStat.isDirectory() || stStat.isSymbolicLink() || swStat.isSymbolicLink()) {
      throw new Error('Extracted deb is missing required template or web directories')
    }

    await mkdir(dirname(extractDir), { recursive: true, mode: 0o700 })
    await rename(stagingDir, extractDir)

    return { templateDir, webDir, debSha256: ORCA_DEB_SHA256 }
  } finally {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
  }
}
