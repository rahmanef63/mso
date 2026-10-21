import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ORCA_VERSION } from './constants.mjs'
import { getReleaseContentId } from './release-identity.mjs'
import { preparePinnedRelease } from './release.mjs'
import { copyVerifiedFile, copyWebTree, readPrivateJson, verifyWebTree, writePrivateJson } from './release-tree.mjs'
import { readAsarEntry } from './asar-license.mjs'
import { fakeAsar, scratch, sha256, writeFileAt } from './release-fixtures.mjs'

describe('release tree helpers', () => {
  it('copies and verifies the web bundle, then detects tampering', async () => {
    const root = await scratch('web')
    try {
      const source = join(root, 'source')
      await writeFileAt(source, 'index.html', 'root')
      await writeFileAt(source, 'assets/app.js', 'app')
      const web = await copyWebTree({ sourceDir: source, destDir: join(root, 'web') })
      assert.equal(web.fileCount, 2)
      assert.equal(web.totalBytes, 'root'.length + 'app'.length)
      assert.equal(await verifyWebTree({ dir: web.dir, expected: web }), true)

      await writeFile(join(web.dir, 'index.html'), 'tampered', { mode: 0o600 })
      assert.equal(await verifyWebTree({ dir: web.dir, expected: web }), false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects symlinks in a web source tree', async () => {
    const root = await scratch('websymlink')
    try {
      const source = join(root, 'source')
      await mkdir(source, { recursive: true, mode: 0o700 })
      await writeFile(join(source, 'real.js'), 'x', { mode: 0o600 })
      await symlink(join(source, 'real.js'), join(source, 'link.js'))
      await assert.rejects(
        copyWebTree({ sourceDir: source, destDir: join(root, 'web') }),
        /symlink/i
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('copies only a verified file and refuses overwrite/mismatch', async () => {
    const root = await scratch('copy')
    try {
      const source = join(root, 'source.bin')
      await writeFile(source, 'payload', { mode: 0o600 })
      const digest = sha256('payload')
      const dest = join(root, 'dest.bin')
      const copied = await copyVerifiedFile({ sourcePath: source, destination: dest, expectedSha256: digest })
      assert.equal(copied.sha256, digest)
      assert.equal(await readFile(dest, 'utf8'), 'payload')
      await assert.rejects(
        copyVerifiedFile({ sourcePath: source, destination: dest, expectedSha256: digest }),
        /overwrite/i
      )
      await assert.rejects(
        copyVerifiedFile({
          sourcePath: source,
          destination: join(root, 'other.bin'),
          expectedSha256: '0'.repeat(64)
        }),
        /checksum mismatch/i
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('writes private JSON with 0600 and reads it back', async () => {
    const root = await scratch('json')
    try {
      const filePath = join(root, 'receipt.json')
      await writePrivateJson(filePath, { ok: true })
      const { stat } = await import('node:fs/promises')
      assert.equal((await stat(filePath)).mode & 0o777, 0o600)
      assert.deepEqual(await readPrivateJson(filePath), { ok: true })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('asar entry extraction', () => {
  it('extracts a bounded, checksum-verified entry', async () => {
    const root = await scratch('asar')
    try {
      const asarPath = join(root, 'app.asar')
      const data = Buffer.from('MIT license text')
      await writeFile(asarPath, fakeAsar('LICENSE', data), { mode: 0o600 })
      const entry = await readAsarEntry({
        asarPath,
        entryName: 'LICENSE',
        expectedSha256: sha256('MIT license text')
      })
      assert.equal(entry.data.toString('utf8'), 'MIT license text')
      await assert.rejects(readAsarEntry({ asarPath, entryName: 'LICENSE', expectedSha256: '0'.repeat(64) }), /checksum mismatch/i)
      await assert.rejects(readAsarEntry({ asarPath, entryName: 'missing' }), /not found/i)
      await assert.rejects(readAsarEntry({ asarPath, entryName: '../escape' }), /unsafe/i)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('preparePinnedRelease guards', () => {
  it('requires an absolute install root', async () => {
    await assert.rejects(preparePinnedRelease({ installRoot: 'relative/root' }), /absolute/i)
  })

  it('refuses to replace an existing non-matching release', async () => {
    const root = await scratch('existing')
    try {
      const installRoot = join(root, 'install')
      const releaseRoot = join(installRoot, 'releases', `${ORCA_VERSION}+${getReleaseContentId()}`)
      await mkdir(releaseRoot, { recursive: true, mode: 0o700 })
      await writeFile(join(releaseRoot, 'receipt.json'), 'junk', { mode: 0o600 })
      await assert.rejects(
        preparePinnedRelease({ installRoot, allowDownload: false }),
        /refusing to replace existing release/i
      )
      assert.equal(await readFile(join(releaseRoot, 'receipt.json'), 'utf8'), 'junk')
      const releases = await readdir(join(installRoot, 'releases'))
      assert.deepEqual(releases, [`${ORCA_VERSION}+${getReleaseContentId()}`])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a symlinked deb cache and a corrupt deb cache', async () => {
    const root = await scratch('deb')
    try {
      const installRoot = join(root, 'install')
      const real = join(root, 'real.deb')
      await writeFile(real, 'not-the-deb', { mode: 0o600 })
      const link = join(root, 'link.deb')
      await symlink(real, link)
      await assert.rejects(
        preparePinnedRelease({ installRoot, verifiedDebCache: link, allowDownload: false }),
        /symlink/i
      )
      await assert.rejects(
        preparePinnedRelease({ installRoot, verifiedDebCache: real, allowDownload: false }),
        /mismatch/i
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails closed when no cache exists and download is disabled', async () => {
    const root = await scratch('closed')
    try {
      await assert.rejects(
        preparePinnedRelease({ installRoot: join(root, 'install'), allowDownload: false }),
        /download is disabled/i
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
