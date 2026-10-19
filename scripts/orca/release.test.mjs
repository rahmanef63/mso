import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { ORCA_VERSION, SUPPORTED_TARGET } from './constants.mjs'
import { getReleaseContentId, getReleaseIdentity } from './release-identity.mjs'
import { buildReceipt, verifyInstalledRelease } from './release-receipt.mjs'
import { copyVerifiedFile, copyWebTree, readPrivateJson, verifyWebTree, writePrivateJson } from './release-tree.mjs'
import { readAsarEntry } from './asar-license.mjs'
import { preparePinnedRelease } from './release.mjs'

const sha256 = (text) => createHash('sha256').update(text).digest('hex')

async function scratch(name) {
  const dir = join(tmpdir(), `orca-rel-${name}-${randomUUID()}`)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  return dir
}

async function writeFileAt(root, rel, content) {
  const filePath = join(root, rel)
  await mkdir(join(filePath, '..'), { recursive: true })
  await writeFile(filePath, content)
  return filePath
}

function fakeAsar(entryName, data) {
  const headerJson = Buffer.from(JSON.stringify({ files: { [entryName]: { size: data.length, offset: '0' } } }))
  const headerSize = headerJson.length + 8
  const preamble = Buffer.alloc(16)
  preamble.writeUInt32LE(4, 0)
  preamble.writeUInt32LE(headerSize, 4)
  preamble.writeUInt32LE(headerJson.length, 12)
  return Buffer.concat([preamble, headerJson, data])
}

describe('release identity & receipt', () => {
  it('derives a stable 16-hex content id from pins only', () => {
    const id = getReleaseContentId()
    assert.match(id, /^[a-f0-9]{16}$/)
    assert.equal(id, getReleaseContentId())
    const identity = getReleaseIdentity()
    assert.equal(identity.contentId, id)
    assert.equal(identity.version, ORCA_VERSION)
    assert.equal(identity.target, SUPPORTED_TARGET)
    assert.equal(identity.sourceCommit.length, 40)
    assert.equal(identity.licenses.length, 2)
    assert.equal(Object.isFrozen(identity), true)
  })

  it('builds a receipt consistent with the identity', () => {
    const identity = getReleaseIdentity()
    const files = { 'a.js': 'a'.repeat(64) }
    const slot = { treeSha256: sha256(`a.js\0${'a'.repeat(64)}\n`), fullVersion: `${ORCA_VERSION}+abc`, files }
    const web = { treeSha256: 'b'.repeat(64), fileCount: 1, totalBytes: 3, files: { 'index.html': 'c'.repeat(64) } }
    const receipt = buildReceipt({ identity, slot, web })
    assert.equal(receipt.schemaVersion, 1)
    assert.equal(receipt.release.contentId, identity.contentId)
    assert.equal(receipt.slot.fileCount, 1)
    assert.equal(receipt.web.fileCount, 1)
    assert.equal(typeof receipt.createdAt, 'string')
  })

  it('refuses a release root that is missing its receipt or has extra entries', async () => {
    const root = await scratch('receipt')
    try {
      const releaseRoot = join(root, 'release')
      await mkdir(releaseRoot, { recursive: true, mode: 0o700 })
      await assert.rejects(
        verifyInstalledRelease({ releaseRoot, identity: getReleaseIdentity() }),
        /layout is not exact/i
      )
      for (const name of ['licenses', 'node', 'slot', 'web']) {
        await mkdir(join(releaseRoot, name), { recursive: true, mode: 0o700 })
      }
      await mkdir(join(releaseRoot, 'receipt.json'), { recursive: true, mode: 0o700 })
      await assert.rejects(
        verifyInstalledRelease({ releaseRoot, identity: getReleaseIdentity() }),
        /regular file/i
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

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

      await writeFile(join(web.dir, 'index.html'), 'tampered')
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
      await writeFile(join(source, 'real.js'), 'x')
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
      await writeFile(source, 'payload')
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
      await writeFile(join(releaseRoot, 'receipt.json'), 'junk')
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
      await writeFile(real, 'not-the-deb')
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
