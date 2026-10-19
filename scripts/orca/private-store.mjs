/**
 * Private managed-root publication: 0700 root, no symlink ancestors, bounded
 * 0600 receipts, and transactional status/identity pair publication.
 */
import { randomUUID } from 'node:crypto'
import { chmod, link, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
const MAX_PRIVATE_BYTES = 64 * 1024

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

function contained(absRoot, absFile) {
  if (absFile === absRoot || !absFile.startsWith(`${absRoot}${sep}`)) {
    throw new Error(`path escapes managed root (outside): ${absFile}`)
  }
}

async function assertPrivateAncestors(absRoot, absFile) {
  const dir = dirname(absFile)
  if (dir === absRoot) return
  contained(absRoot, dir)
  let current = absRoot
  for (const part of dir.slice(absRoot.length + 1).split(sep)) {
    current = join(current, part)
    const info = await lstat(current)
    if (info.isSymbolicLink()) throw new Error(`refusing symlink ancestor: ${current}`)
    if (!info.isDirectory()) throw new Error(`private ancestor is not a directory: ${current}`)
    if (info.uid !== process.getuid()) throw new Error(`private ancestor is not owned by this user: ${current}`)
  }
}

async function readPrivateRaw(filePath, { root, maxBytes = MAX_PRIVATE_BYTES } = {}) {
  const absRoot = await ensureManagedRoot(root)
  const absFile = resolve(filePath)
  contained(absRoot, absFile)
  await assertPrivateAncestors(absRoot, absFile)
  let info
  try {
    info = await lstat(absFile)
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`private file is not a regular file: ${absFile}`)
  if ((info.mode & 0o077) !== 0) throw new Error(`private file permissions are not 0600: ${absFile}`)
  if (info.uid !== process.getuid()) throw new Error(`private file is not owned by this user: ${absFile}`)
  if (info.size > maxBytes) throw new Error(`private file exceeds ${maxBytes} bytes: ${absFile}`)
  return { absFile, raw: await readFile(absFile, 'utf8') }
}

export async function readPrivateJson(filePath, options = {}) {
  const file = await readPrivateRaw(filePath, options)
  if (!file) throw new Error(`private file is missing: ${resolve(filePath)}`)
  return JSON.parse(file.raw)
}

/** Atomic 0600 write inside a verified managed root; no temp file survives failure. */
export async function writePrivateFile(filePath, data, { root } = {}) {
  const absRoot = await ensureManagedRoot(root)
  const absFile = resolve(filePath)
  contained(absRoot, absFile)
  await ensureManagedRoot(dirname(absFile))
  const existing = await lstat(absFile).catch((err) => {
    if (err.code === 'ENOENT') return null
    throw err
  })
  if (existing && (existing.isSymbolicLink() || !existing.isFile())) {
    throw new Error(`refusing non-regular or symlink private file: ${absFile}`)
  }
  const raw = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  const tmp = `${absFile}.tmp-${process.pid}-${randomUUID()}`
  try {
    await writeFile(tmp, raw, { mode: 0o600, flag: 'wx' })
    await rename(tmp, absFile)
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {})
    throw err
  }
  return absFile
}

/**
 * Publish a receipt pair as one transaction. Both files are staged before any
 * rename; a later failure restores only entries whose bytes still equal ours,
 * so a concurrent runtime's replacement is never deleted.
 */
export async function publishPrivatePair({ root, entries, renameImpl = rename } = {}) {
  const absRoot = await ensureManagedRoot(root)
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('receipt entries are required')
  const prepared = []
  const seen = new Set()
  try {
    for (const entry of entries) {
      const absFile = resolve(entry.path)
      contained(absRoot, absFile)
      if (seen.has(absFile)) throw new Error(`duplicate receipt path: ${absFile}`)
      seen.add(absFile)
      await ensureManagedRoot(dirname(absFile))
      const previous = await readPrivateRaw(absFile, { root: absRoot })
      const raw = typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data, null, 2)
      const tmp = `${absFile}.tmp-${process.pid}-${randomUUID()}`
      await writeFile(tmp, raw, { mode: 0o600, flag: 'wx' })
      prepared.push({ absFile, raw, previous: previous?.raw ?? null, tmp, renamed: false })
    }
    for (const item of prepared) {
      await renameImpl(item.tmp, item.absFile)
      item.renamed = true
    }
    return { files: prepared.map((item) => item.absFile) }
  } catch (err) {
    for (const item of [...prepared].reverse()) {
      if (item.tmp) await rm(item.tmp, { force: true }).catch(() => {})
      if (!item.renamed) continue
      const current = await readPrivateRaw(item.absFile, { root: absRoot }).catch(() => null)
      if (!current || current.raw !== item.raw) continue
      try {
        if (item.previous === null) {
          await rm(item.absFile, { force: true })
        } else {
          await writePrivateFile(item.absFile, item.previous, { root: absRoot })
        }
      } catch {}
    }
    throw err
  } finally {
    await Promise.all(prepared.map((item) => rm(item.tmp, { force: true }).catch(() => {})))
  }
}

async function restoreQuarantine(quarantine, absFile) {
  try {
    await link(quarantine, absFile)
    await rm(quarantine, { force: true })
    return
  } catch (err) {
    if (err.code === 'EEXIST') {
      // Another runtime recreated the path while we inspected it: keep theirs.
      await rm(quarantine, { force: true })
      return
    }
  }
  const existing = await lstat(absFile).catch(() => null)
  if (existing) throw new Error(`cannot restore quarantined receipt without clobbering: ${absFile}`)
  await rename(quarantine, absFile)
}

/**
 * Remove only receipts that still parse and match this runtime's predicate.
 * Each candidate is atomically renamed aside, inspected, then either deleted
 * or restored, so a receipt replaced by another runtime is never deleted.
 */
export async function clearPrivatePairIfMatch({ root, matches = [] } = {}) {
  const absRoot = await ensureManagedRoot(root)
  const cleared = []
  const preserved = []
  for (const match of matches) {
    const absFile = resolve(match.path)
    contained(absRoot, absFile)
    const quarantine = `${absFile}.quarantine-${process.pid}-${randomUUID()}`
    try {
      await rename(absFile, quarantine)
    } catch (err) {
      if (err.code === 'ENOENT') continue
      throw err
    }
    let matchesOwn = false
    try {
      const current = await readPrivateRaw(quarantine, { root: absRoot })
      if (current) {
        let parsed
        try {
          parsed = JSON.parse(current.raw)
        } catch {
          parsed = undefined
        }
        matchesOwn = Boolean(parsed && match.predicate(parsed))
      }
    } catch (err) {
      await restoreQuarantine(quarantine, absFile).catch(() => {})
      throw err
    }
    if (matchesOwn) {
      await rm(quarantine, { force: true })
      cleared.push(absFile)
    } else {
      await restoreQuarantine(quarantine, absFile)
      preserved.push(absFile)
    }
  }
  return { cleared, preserved }
}
