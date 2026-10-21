/**
 * Release tree helpers: copy/verify the standalone web bundle, copy verified
 * files, and read/write the private integrity receipt.
 */

import { createHash } from 'node:crypto'
import { copyFile, chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileSha256 } from './node-runtime.mjs'
import {
  assertNoSymlinkAncestors,
  assertOwnedRegularFile,
  ensurePrivateDirTree,
  isSafeRelativePath,
  lstatOrNull
} from './safe-paths.mjs'

const MAX_RECEIPT_BYTES = 8 * 1024 * 1024

async function assertRealDir(dir, label) {
  await assertNoSymlinkAncestors(dir)
  const s = await lstatOrNull(dir)
  if (!s || !s.isDirectory() || s.isSymbolicLink()) {
    throw new Error(`${label} is not a real directory: ${dir}`)
  }
}

async function walkFiles(root, rel = '') {
  const entries = await readdir(join(root, rel), { withFileTypes: true })
  const out = []
  for (const entry of entries) {
    const next = rel ? `${rel}/${entry.name}` : entry.name
    if (!isSafeRelativePath(next)) throw new Error(`Unsafe web path: ${next}`)
    if (entry.isSymbolicLink()) throw new Error(`Refusing symlink in web bundle: ${next}`)
    if (entry.isDirectory()) out.push(...(await walkFiles(root, next)))
    else if (entry.isFile()) out.push(next)
    else throw new Error(`Refusing non-regular web entry: ${next}`)
  }
  return out
}

export async function copyWebTree({ sourceDir, destDir } = {}) {
  if (typeof sourceDir !== 'string' || !sourceDir.startsWith('/')) {
    throw new Error(`sourceDir must be absolute: ${sourceDir}`)
  }
  if (typeof destDir !== 'string' || !destDir.startsWith('/')) {
    throw new Error(`destDir must be absolute: ${destDir}`)
  }
  await assertRealDir(sourceDir, 'Web source')
  if (await lstatOrNull(destDir)) throw new Error(`Refusing to overwrite web destination: ${destDir}`)
  await ensurePrivateDirTree(dirname(destDir))
  await mkdir(destDir, { recursive: false, mode: 0o700 })

  const files = await walkFiles(sourceDir)
  const hash = createHash('sha256')
  const digestMap = {}
  let totalBytes = 0
  for (const rel of files.sort()) {
    const sourcePath = join(sourceDir, rel)
    await assertNoSymlinkAncestors(sourcePath)
    const sourceStat = await assertOwnedRegularFile(sourcePath)
    const sourceSha = await fileSha256(sourcePath)
    const destPath = join(destDir, rel)
    await assertNoSymlinkAncestors(destPath)
    await mkdir(dirname(destPath), { recursive: true, mode: 0o700 })
    await copyFile(sourcePath, destPath)
    await chmod(destPath, 0o600)
    if ((await fileSha256(destPath)) !== sourceSha) {
      throw new Error(`TOCTOU web copy corruption on ${rel}`)
    }
    if ((await lstatOrNull(sourcePath))?.size !== sourceStat.size) {
      throw new Error(`Web source changed during copy: ${rel}`)
    }
    digestMap[rel] = sourceSha
    totalBytes += sourceStat.size
    hash.update(`${rel}\0${sourceSha}\n`)
  }
  return {
    dir: destDir,
    treeSha256: hash.digest('hex'),
    fileCount: files.length,
    totalBytes,
    files: digestMap
  }
}

export async function verifyWebTree({ dir, expected } = {}) {
  try {
    await assertRealDir(dir, 'Web release')
    if (!expected || typeof expected.files !== 'object' || expected.files === null) return false
    const actual = (await walkFiles(dir)).sort()
    const wanted = Object.keys(expected.files).sort()
    if (actual.length !== wanted.length) return false
    if (actual.some((name, i) => name !== wanted[i])) return false
    const hash = createHash('sha256')
    let total = 0
    for (const rel of wanted) {
      const filePath = join(dir, rel)
      await assertNoSymlinkAncestors(filePath)
      const s = await lstatOrNull(filePath)
      if (!s || !s.isFile() || s.isSymbolicLink()) return false
      const actualSha = await fileSha256(filePath)
      if (actualSha !== expected.files[rel]) return false
      total += s.size
      hash.update(`${rel}\0${actualSha}\n`)
    }
    return hash.digest('hex') === expected.treeSha256 && total === expected.totalBytes
  } catch {
    return false
  }
}

export async function copyVerifiedFile({ sourcePath, destination, expectedSha256, mode = 0o600 } = {}) {
  await assertNoSymlinkAncestors(sourcePath)
  const s = await assertOwnedRegularFile(sourcePath)
  if ((await fileSha256(sourcePath)) !== expectedSha256) {
    throw new Error(`Source checksum mismatch: ${sourcePath}`)
  }
  if (await lstatOrNull(destination)) throw new Error(`Refusing to overwrite: ${destination}`)
  await assertNoSymlinkAncestors(destination)
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
  await copyFile(sourcePath, destination)
  await chmod(destination, mode)
  if ((await fileSha256(destination)) !== expectedSha256) {
    throw new Error(`TOCTOU copy corruption: ${destination}`)
  }
  if ((await lstatOrNull(sourcePath))?.size !== s.size) {
    throw new Error(`Source changed during copy: ${sourcePath}`)
  }
  return { path: destination, sha256: expectedSha256, size: s.size }
}

export async function writePrivateJson(filePath, value) {
  if (await lstatOrNull(filePath)) throw new Error(`Refusing to overwrite: ${filePath}`)
  await assertNoSymlinkAncestors(filePath)
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  return filePath
}

export async function readPrivateJson(filePath) {
  await assertNoSymlinkAncestors(filePath)
  const s = await assertOwnedRegularFile(filePath)
  if ((s.mode & 0o077) !== 0) throw new Error(`Receipt must be private (0600): ${filePath}`)
  if (s.size > MAX_RECEIPT_BYTES) throw new Error(`Receipt is unexpectedly large: ${filePath}`)
  return JSON.parse(await readFile(filePath, 'utf8'))
}
