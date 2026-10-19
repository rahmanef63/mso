import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { ORCA_VERSION, SUPPORTED_TARGET } from './constants.mjs'
import { getReleaseContentId, getReleaseIdentity, nodeRuntimeRelativePath } from './release-identity.mjs'
import { buildReceipt, verifyInstalledRelease } from './release-receipt.mjs'
import { scratch, sha256 } from './release-fixtures.mjs'

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
    assert.equal(
      identity.node.executablePath,
      `runtimes/node-${identity.node.executableSha256}/bin/node`
    )
    assert.equal(identity.runtimeLayout.slotRelativePath, '../runtimes')
    assert.equal(Object.isFrozen(identity), true)
  })

  it('names the sibling runtime path the upstream .runtime-node contract expects', () => {
    const sha = 'a'.repeat(64)
    assert.equal(nodeRuntimeRelativePath(sha), `runtimes/node-${sha}/bin/node`)
    // Intentional layout/identity bumps: earlier packaged-release content ids must not be reused.
    assert.notEqual(getReleaseContentId(), 'db813ed170845dbe')
    assert.notEqual(getReleaseContentId(), '1cc972057c04eea1')
  })

  it('builds a receipt consistent with the identity', () => {
    const identity = getReleaseIdentity()
    const files = { 'a.js': 'a'.repeat(64) }
    const slot = {
      treeSha256: sha256(`a.js\0${'a'.repeat(64)}\n`),
      artifactSha256: 'd'.repeat(64),
      fullVersion: `${ORCA_VERSION}+${'d'.repeat(12)}`,
      files
    }
    const web = { treeSha256: 'b'.repeat(64), fileCount: 1, totalBytes: 3, files: { 'index.html': 'c'.repeat(64) } }
    const receipt = buildReceipt({ identity, slot, web })
    assert.equal(receipt.schemaVersion, 3)
    assert.equal(receipt.release.contentId, identity.contentId)
    assert.equal(receipt.node.executablePath, identity.node.executablePath)
    assert.equal(receipt.slot.artifactSha256, slot.artifactSha256)
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
      for (const name of ['licenses', 'runtimes', 'slot', 'web']) {
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
