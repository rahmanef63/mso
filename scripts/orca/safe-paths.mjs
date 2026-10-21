/**
 * Filesystem guards shared by acquisition/materialization.
 * Every path that will be read, written, renamed, or trusted goes through here.
 */

import { lstat, mkdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path'

const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/

export async function lstatOrNull(p) {
  try {
    return await lstat(p)
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

export function isSafeRelativePath(relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) return false
  if (isAbsolute(relPath) || relPath.includes('\\') || CONTROL_CHAR_RE.test(relPath)) return false
  const parts = relPath.split('/')
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return false
  const normalized = normalize(relPath)
  return normalized === relPath && !normalized.startsWith('..') && normalized !== '.'
}

/**
 * Reject symlinked path components, including a symlink ancestor that hides a
 * missing suffix (`link/missing/file`). Missing components are allowed as long
 * as every existing ancestor is a real directory.
 */
export async function assertNoSymlinkAncestors(targetPath) {
  if (typeof targetPath !== 'string' || !isAbsolute(targetPath)) {
    throw new Error(`Path must be absolute: ${targetPath}`)
  }
  const chain = []
  let current = normalize(targetPath)
  for (;;) {
    chain.push(current)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  for (const candidate of chain.reverse()) {
    const s = await lstatOrNull(candidate)
    if (!s) continue
    if (s.isSymbolicLink()) {
      throw new Error(`Refusing path with symlink component: ${candidate}`)
    }
    if (candidate !== chain[chain.length - 1] && !s.isDirectory()) {
      throw new Error(`Refusing path with non-directory ancestor: ${candidate}`)
    }
  }
}

export async function resolveUnderRoot(root, relPath) {
  if (!isSafeRelativePath(relPath)) throw new Error(`Unsafe relative path: ${relPath}`)
  const resolvedRoot = await realpath(root)
  const resolved = join(resolvedRoot, relPath)
  assertContainedSync(resolvedRoot, resolved)
  return resolved
}

export function assertContainedSync(root, candidate) {
  const rel = relative(root, candidate)
  if (rel === '' || rel.startsWith('..') || rel.includes(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Path ${candidate} is outside owned root ${root}`)
  }
  return candidate
}

export async function assertContained(root, candidate) {
  const resolvedRoot = await realpath(root)
  const parent = dirname(candidate)
  const resolvedParent = await realpath(parent).catch(async (err) => {
    if (err.code === 'ENOENT') return null
    throw err
  })
  if (resolvedParent === null) {
    assertContainedSync(resolvedRoot, normalize(candidate))
    return candidate
  }
  assertContainedSync(resolvedRoot, join(resolvedParent, candidate.slice(parent.length + 1)))
  return candidate
}

export async function ensurePrivateDir(parent, name) {
  if (!isSafeRelativePath(name)) throw new Error(`Unsafe directory name: ${name}`)
  await assertNoSymlinkAncestors(parent)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  await assertOwnedPrivateDir(parent)
  const dir = join(parent, name)
  const existing = await lstatOrNull(dir)
  if (!existing) {
    await mkdir(dir, { recursive: true, mode: 0o700 })
  }
  await assertOwnedPrivateDir(dir)
  return dir
}

/** Create `dir` (and parents) privately, refusing symlink ancestors first. */
export async function ensurePrivateDirTree(dir) {
  await assertNoSymlinkAncestors(dir)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await assertOwnedPrivateDir(dir)
  return dir
}

export async function assertOwnedPrivateDir(dir) {
  await assertNoSymlinkAncestors(dir)
  const s = await lstat(dir)
  if (!s.isDirectory() || s.isSymbolicLink()) {
    throw new Error(`Expected a real directory: ${dir}`)
  }
  if (typeof process.getuid === 'function' && s.uid !== process.getuid()) {
    throw new Error(`Directory is not owned by the current user: ${dir}`)
  }
  if ((s.mode & 0o077) !== 0) {
    throw new Error(`Directory must be private (0700): ${dir}`)
  }
  return s
}

export async function assertOwnedRegularFile(filePath) {
  await assertNoSymlinkAncestors(filePath)
  const s = await lstat(filePath)
  if (s.isSymbolicLink()) throw new Error(`Refusing symlink: ${filePath}`)
  if (!s.isFile()) throw new Error(`Expected a regular file: ${filePath}`)
  if (typeof process.getuid === 'function' && s.uid !== process.getuid()) {
    throw new Error(`File is not owned by the current user: ${filePath}`)
  }
  return s
}
