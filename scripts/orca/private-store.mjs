/**
 * Private managed-root publication: 0700 root, no symlink ancestors, atomic
 * 0600 receipts. Receipts must never escape the caller's managed root.
 */

import { randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'

/** Create/validate a private managed root: 0700, owned, no symlinked ancestors. */
export async function ensureManagedRoot(root) {
  const abs = resolve(root)
  if (!isAbsolute(abs)) throw new Error(`managed root must be absolute: ${root}`)
  const parts = abs.split(sep).filter(Boolean)
  let current = sep
  for (const part of parts) {
    current = join(current, part)
    let info
    try {
      info = await lstat(current)
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
      await mkdir(current, { mode: 0o700 })
      info = await lstat(current)
    }
    if (info.isSymbolicLink()) throw new Error(`managed root has symlink ancestor: ${current}`)
    if (!info.isDirectory()) throw new Error(`managed root ancestor is not a directory: ${current}`)
    // Only the managed root itself must be user-owned; system ancestors need not be.
    if (current === abs && info.uid !== process.getuid()) {
      throw new Error(`managed root is not owned by this user: ${current}`)
    }
  }
  const final = await lstat(abs)
  if ((final.mode & 0o077) !== 0) await chmod(abs, 0o700)
  const tightened = await lstat(abs)
  if ((tightened.mode & 0o077) !== 0) throw new Error(`managed root permissions are not 0700: ${abs}`)
  return abs
}

/** Atomic 0600 write inside a verified managed root; no temp file survives failure. */
export async function writePrivateFile(filePath, data, { root } = {}) {
  const absRoot = await ensureManagedRoot(root)
  const absFile = resolve(filePath)
  if (absFile !== absRoot && !absFile.startsWith(`${absRoot}${sep}`)) {
    throw new Error(`refusing to write outside managed root: ${absFile}`)
  }
  await ensureManagedRoot(dirname(absFile))
  try {
    const existing = await lstat(absFile)
    if (existing.isSymbolicLink()) throw new Error(`refusing to write through symlink: ${absFile}`)
    if (!existing.isFile()) throw new Error(`refusing to replace non-file: ${absFile}`)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
  const tmp = `${absFile}.tmp-${process.pid}-${randomUUID()}`
  try {
    await writeFile(tmp, typeof data === 'string' ? data : JSON.stringify(data, null, 2), {
      mode: 0o600,
      flag: 'wx'
    })
    await rename(tmp, absFile)
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {})
    throw err
  }
  return absFile
}

export async function readPrivateJson(filePath, { root } = {}) {
  const absRoot = await ensureManagedRoot(root)
  const absFile = resolve(filePath)
  if (!absFile.startsWith(`${absRoot}${sep}`)) throw new Error(`refusing to read outside managed root: ${absFile}`)
  const info = await lstat(absFile)
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`private file is not a regular file: ${absFile}`)
  if ((info.mode & 0o077) !== 0) throw new Error(`private file permissions are not 0600: ${absFile}`)
  if (info.uid !== process.getuid()) throw new Error(`private file is not owned by this user: ${absFile}`)
  return JSON.parse(await readFile(absFile, 'utf8'))
}
