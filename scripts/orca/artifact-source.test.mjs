import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import {
  ORCA_DEB_SHA256,
  ORCA_DEB_URL
} from './constants.mjs'
import {
  verifyDebHash,
  acquireAndExtractDeb
} from './artifact-source.mjs'

describe('artifact-source deb verification & extraction', () => {
  it('has pinned deb URL and release sha256', () => {
    assert.equal(
      ORCA_DEB_SHA256,
      '7758be00e6564c14e5793b6a61ffe1bb0e84749583d76013a129454835788e24'
    )
    assert.match(ORCA_DEB_URL, /orca-ide_1\.4\.230_amd64\.deb$/)
  })

  it('rejects tampered or corrupt deb file before extraction', async () => {
    const testDir = join(tmpdir(), `test-deb-${randomUUID()}`)
    await mkdir(testDir, { recursive: true })
    const fakeDeb = join(testDir, 'fake.deb')
    await writeFile(fakeDeb, 'corrupt deb content')

    await assert.rejects(
      async () => {
        await verifyDebHash(fakeDeb, ORCA_DEB_SHA256)
      },
      { message: /checksum mismatch/i }
    )

    await assert.rejects(
      async () => {
        await acquireAndExtractDeb({
          debPath: fakeDeb,
          extractDir: join(testDir, 'extracted')
        })
      },
      { message: /checksum mismatch/i }
    )

    await rm(testDir, { recursive: true, force: true })
  })

  it('rejects symlinked deb path', async () => {
    const testDir = join(tmpdir(), `test-deb-symlink-${randomUUID()}`)
    await mkdir(testDir, { recursive: true })
    const targetFile = join(testDir, 'real.deb')
    await writeFile(targetFile, 'content')
    const linkFile = join(testDir, 'link.deb')
    await symlink(targetFile, linkFile)

    await assert.rejects(
      async () => {
        await acquireAndExtractDeb({
          debPath: linkFile,
          extractDir: join(testDir, 'extracted')
        })
      },
      { message: /symlink/i }
    )

    await rm(testDir, { recursive: true, force: true })
  })
})
