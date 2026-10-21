import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { chmod, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import {
  assertContained,
  assertNoSymlinkAncestors,
  assertOwnedPrivateDir,
  assertOwnedRegularFile,
  ensurePrivateDir,
  isSafeRelativePath,
  lstatOrNull,
  resolveUnderRoot
} from './safe-paths.mjs'

async function scratch(name) {
  const dir = join(tmpdir(), `orca-safe-${name}-${randomUUID()}`)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  return dir
}

describe('safe-paths filesystem guards', () => {
  it('rejects a symlinked file and every symlink ancestor', async () => {
    const root = await scratch('symlink')
    try {
      const realDir = join(root, 'real')
      await mkdir(realDir, { mode: 0o700 })
      await writeFile(join(realDir, 'file.txt'), 'x')
      await symlink(realDir, join(root, 'link-dir'))
      await symlink(join(realDir, 'file.txt'), join(root, 'link-file'))

      await assert.rejects(assertNoSymlinkAncestors(join(root, 'link-file')), /symlink/i)
      await assert.rejects(
        assertNoSymlinkAncestors(join(root, 'link-dir', 'file.txt')),
        /symlink/i
      )
      // Missing suffix beneath a symlink ancestor is still refused.
      await assert.rejects(
        assertNoSymlinkAncestors(join(root, 'link-dir', 'missing', 'deep.txt')),
        /symlink/i
      )
      await assert.doesNotReject(assertNoSymlinkAncestors(join(realDir, 'file.txt')))
      await assert.doesNotReject(
        assertNoSymlinkAncestors(join(root, 'missing', 'deep.txt'))
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a regular file used as an ancestor', async () => {
    const root = await scratch('file-ancestor')
    try {
      const file = join(root, 'plain')
      await writeFile(file, 'x')
      await assert.rejects(assertNoSymlinkAncestors(join(file, 'child')), /directory/i)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('requires absolute paths and private owned directories', async () => {
    const root = await scratch('private')
    try {
      await assert.rejects(assertNoSymlinkAncestors('relative/path'), /absolute/i)

      const openDir = join(root, 'open')
      await mkdir(openDir, { mode: 0o755 })
      await chmod(openDir, 0o755)
      await assert.rejects(assertOwnedPrivateDir(openDir), /private/i)

      const created = await ensurePrivateDir(root, 'nested/private')
      assert.equal((await lstatOrNull(created))?.isDirectory(), true)
      await assert.doesNotReject(assertOwnedPrivateDir(created))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('checks regular file type and rejects symlinks', async () => {
    const root = await scratch('regular')
    try {
      const real = join(root, 'real.bin')
      await writeFile(real, 'payload')
      await assert.doesNotReject(assertOwnedRegularFile(real))

      const link = join(root, 'link.bin')
      await symlink(real, link)
      await assert.rejects(assertOwnedRegularFile(link), /symlink/i)
      await assert.rejects(assertOwnedRegularFile(root), /regular file/i)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps resolved paths inside the owned root', async () => {
    const root = await scratch('contain')
    try {
      assert.equal(await resolveUnderRoot(root, 'a/b.txt'), join(root, 'a', 'b.txt'))
      await assert.rejects(resolveUnderRoot(root, '../escape'), /unsafe/i)
      await assert.rejects(resolveUnderRoot(root, '/abs'), /unsafe/i)
      await assert.rejects(resolveUnderRoot(root, 'a/../../escape'), /unsafe/i)

      const outside = join(tmpdir(), `orca-outside-${randomUUID()}`)
      await mkdir(outside, { mode: 0o700 })
      try {
        await assert.rejects(assertContained(root, outside), /outside/i)
      } finally {
        await rm(outside, { recursive: true, force: true })
      }
      await assert.doesNotReject(assertContained(root, join(root, 'missing', 'file')))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('classifies manifest-relative paths conservatively', () => {
    assert.equal(isSafeRelativePath('valid/file.js'), true)
    assert.equal(isSafeRelativePath('.server-target'), true)
    for (const bad of ['', '/abs', '../x', 'a/../../b', 'a/./b', 'a//b', 'a\\b', 'a/\x00/b', 'a/\n/b']) {
      assert.equal(isSafeRelativePath(bad), false, bad)
    }
  })
})
