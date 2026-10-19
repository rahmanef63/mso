import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { ORCAD_SLOT_FILE_COUNT, ORCAD_TARGET_FILES, PINNED_NODE, SUPPORTED_TARGET } from './constants.mjs'
import {
  getSlotArtifactFilenames,
  isSafePathSegment,
  verifyManifestSchema,
  verifyTargetMarkers
} from './materializer.mjs'
import { buildTemplate, scratch, sha256 } from './materializer-fixtures.mjs'

describe('materializer manifest contract', () => {
  it('rejects unsafe path segments', () => {
    for (const bad of ['../etc/passwd', '/abs', 'foo/../../bar', 'foo/./bar', '', 'foo\\bar', 'foo//bar', 'a/\x00/b']) {
      assert.equal(isSafePathSegment(bad), false, bad)
    }
    assert.equal(isSafePathSegment('valid/file.js'), true)
    assert.equal(isSafePathSegment('.server-target'), true)
  })

  it('rejects malformed manifest roots and digests', async () => {
    const root = await scratch('schema')
    try {
      const { manifest } = await buildTemplate(root)
      assert.throws(() => verifyManifestSchema(null), /invalid manifest/i)
      assert.throws(() => verifyManifestSchema([]), /invalid manifest/i)
      assert.throws(() => verifyManifestSchema({ schemaVersion: 2, commonSha256: {}, targets: {} }), /unsupported schema/i)
      assert.throws(() => verifyManifestSchema({ schemaVersion: 3, targets: {} }), /commonSha256/i)
      assert.throws(() => verifyManifestSchema({ schemaVersion: 3, commonSha256: [], targets: {} }), /commonSha256/i)
      assert.throws(
        () => verifyManifestSchema({ ...manifest, commonSha256: { ...manifest.commonSha256, 'out/x.js': 'nothex' } }),
        /invalid digest/i
      )
      assert.throws(
        () => verifyManifestSchema({ ...manifest, commonSha256: { ...manifest.commonSha256, 'out/../x.js': 'a'.repeat(64) } }),
        /unsafe manifest path/i
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('enforces the exact common/target file contract', async () => {
    const root = await scratch('contract')
    try {
      const { manifest } = await buildTemplate(root)
      const names = getSlotArtifactFilenames(SUPPORTED_TARGET, manifest)
      assert.equal(names.length, ORCAD_SLOT_FILE_COUNT)
      assert.equal(new Set(names).size, ORCAD_SLOT_FILE_COUNT)

      const withExtraTarget = JSON.parse(JSON.stringify(manifest))
      withExtraTarget.targets[SUPPORTED_TARGET].files['orcad-server.js'] = sha256('x')
      assert.throws(
        () => getSlotArtifactFilenames(SUPPORTED_TARGET, withExtraTarget),
        /unexpected target file/i
      )

      const missingTarget = JSON.parse(JSON.stringify(manifest))
      delete missingTarget.targets[SUPPORTED_TARGET].files[ORCAD_TARGET_FILES[0]]
      assert.throws(
        () => getSlotArtifactFilenames(SUPPORTED_TARGET, missingTarget),
        /missing target file/i
      )

      const shadowed = JSON.parse(JSON.stringify(manifest))
      shadowed.commonSha256['.server-target'] = sha256('x')
      assert.throws(
        () => getSlotArtifactFilenames(SUPPORTED_TARGET, shadowed),
        /unexpected common file/i
      )

      assert.throws(() => getSlotArtifactFilenames('darwin-arm64', manifest), /unsupported target/i)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('checks target marker identity', () => {
    assert.doesNotThrow(() =>
      verifyTargetMarkers({
        serverTarget: 'linux-x64-glibc',
        runtimeNodeSha256: PINNED_NODE.executableSha256
      })
    )
    assert.throws(
      () => verifyTargetMarkers({ serverTarget: 'linux-arm64', runtimeNodeSha256: PINNED_NODE.executableSha256 }),
      /target identity mismatch/i
    )
    assert.throws(
      () => verifyTargetMarkers({ serverTarget: 'linux-x64-glibc', runtimeNodeSha256: 'deadbeef'.repeat(8) }),
      /runtime node pin mismatch/i
    )
  })
})
