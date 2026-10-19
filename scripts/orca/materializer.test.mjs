import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  isSafePathSegment,
  verifyManifestSchema,
  verifyTargetMarkers
} from './materializer.mjs'

describe('materializer safety & validation', () => {
  it('rejects path traversal and absolute paths', () => {
    assert.equal(isSafePathSegment('../etc/passwd'), false)
    assert.equal(isSafePathSegment('/absolute/path'), false)
    assert.equal(isSafePathSegment('foo/../../bar'), false)
    assert.equal(isSafePathSegment('foo/./bar'), false)
    assert.equal(isSafePathSegment(''), false)
    assert.equal(isSafePathSegment('valid/file.js'), true)
    assert.equal(isSafePathSegment('.server-target'), true)
    assert.equal(isSafePathSegment('node_modules/node-pty/build/Release/pty.node'), true)
  })

  it('rejects invalid manifest schema', () => {
    assert.throws(
      () => {
        verifyManifestSchema({ schemaVersion: 2, commonSha256: {}, targets: {} })
      },
      { message: /unsupported schema version/i }
    )

    assert.throws(
      () => {
        verifyManifestSchema({ schemaVersion: 3, targets: {} })
      },
      { message: /invalid manifest/i }
    )

    assert.throws(
      () => {
        verifyManifestSchema({ schemaVersion: 3, commonSha256: {} })
      },
      { message: /invalid manifest/i }
    )
  })

  it('validates target markers content', () => {
    assert.doesNotThrow(() => {
      verifyTargetMarkers({
        serverTarget: 'linux-x64-glibc',
        runtimeNodeSha256: '7fde7b8afa198da66257f42ee2001d874c7355631e6d1579a5fb5ef1f246df4c'
      })
    })

    assert.throws(
      () => {
        verifyTargetMarkers({
          serverTarget: 'linux-arm64-glibc',
          runtimeNodeSha256: '7fde7b8afa198da66257f42ee2001d874c7355631e6d1579a5fb5ef1f246df4c'
        })
      },
      { message: /target identity mismatch/i }
    )

    assert.throws(
      () => {
        verifyTargetMarkers({
          serverTarget: 'linux-x64-glibc',
          runtimeNodeSha256: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
        })
      },
      { message: /runtime node pin mismatch/i }
    )
  })
})
