import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { ORCA_DEB_SHA256, ORCA_DEB_SIZE, ORCA_DEB_URL } from './constants.mjs'
import { acquireAndExtractDeb, verifyDebHash } from './artifact-source.mjs'

async function scratch(name) {
  const dir = join(tmpdir(), `orca-deb-${name}-${randomUUID()}`)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  return dir
}

describe('artifact-source deb verification & extraction', () => {
  it('pins the official deb URL, size, and sha256', () => {
    assert.equal(ORCA_DEB_SHA256, '7758be00e6564c14e5793b6a61ffe1bb0e84749583d76013a129454835788e24')
    assert.equal(ORCA_DEB_SIZE, 209670608)
    assert.match(ORCA_DEB_URL, /^https:\/\/github\.com\/stablyai\/orca\/releases\/download\//)
  })

  it('rejects a corrupt/unrelated deb before extraction', async () => {
    const root = await scratch('corrupt')
    try {
      const fakeDeb = join(root, 'fake.deb')
      await writeFile(fakeDeb, 'corrupt deb content')
      await assert.rejects(verifyDebHash(fakeDeb), /mismatch/i)
      await assert.rejects(
        acquireAndExtractDeb({ debPath: fakeDeb, extractDir: join(root, 'extracted') }),
        /mismatch/i
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a symlinked deb and any symlink ancestor', async () => {
    const root = await scratch('symlink')
    try {
      const real = join(root, 'real.deb')
      await writeFile(real, 'content')
      const link = join(root, 'link.deb')
      await symlink(real, link)
      await assert.rejects(verifyDebHash(link), /symlink/i)

      const linkDir = join(root, 'link-dir')
      await symlink(root, linkDir)
      await assert.rejects(verifyDebHash(join(linkDir, 'real.deb')), /symlink/i)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a non-regular deb path', async () => {
    const root = await scratch('type')
    try {
      await assert.rejects(verifyDebHash(root), /regular file/i)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses to reuse or overwrite an existing extraction directory', async () => {
    const root = await scratch('existing')
    try {
      const extractDir = join(root, 'extracted')
      await mkdir(extractDir, { recursive: true, mode: 0o700 })
      await assert.rejects(
        acquireAndExtractDeb({ debPath: join(root, 'missing.deb'), extractDir }),
        /refusing to reuse or overwrite/i
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('requires a deb path when download is not permitted', async () => {
    const root = await scratch('nodownload')
    try {
      await assert.rejects(
        acquireAndExtractDeb({ extractDir: join(root, 'extracted') }),
        /debPath is required/i
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
