import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import {
  isSafePathSegment,
  verifyManifestSchema,
  verifyTargetMarkers,
  verifySlotIntegrity
} from './materializer.mjs'

describe('materializer safety & validation', () => {
  it('rejects path traversal, backslashes, empty segments, and control characters', () => {
    assert.equal(isSafePathSegment('../etc/passwd'), false)
    assert.equal(isSafePathSegment('/absolute/path'), false)
    assert.equal(isSafePathSegment('foo/../../bar'), false)
    assert.equal(isSafePathSegment('foo/./bar'), false)
    assert.equal(isSafePathSegment(''), false)
    assert.equal(isSafePathSegment('foo\\bar'), false)
    assert.equal(isSafePathSegment('foo//bar'), false)
    assert.equal(isSafePathSegment('foo/\x00/bar'), false)
    assert.equal(isSafePathSegment('foo/\n/bar'), false)
    assert.equal(isSafePathSegment('valid/file.js'), true)
    assert.equal(isSafePathSegment('.server-target'), true)
    assert.equal(isSafePathSegment('node_modules/node-pty/build/Release/pty.node'), true)
  })

  it('rejects invalid manifest schema including arrays and empty manifests', () => {
    assert.throws(
      () => {
        verifyManifestSchema(null)
      },
      { message: /invalid manifest/i }
    )

    assert.throws(
      () => {
        verifyManifestSchema([])
      },
      { message: /invalid manifest/i }
    )

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
        verifyManifestSchema({ schemaVersion: 3, commonSha256: [] })
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

  it('detects tampered files in cached slot even if .version matches', async () => {
    const testDir = join(tmpdir(), `test-slot-${randomUUID()}`)
    await mkdir(testDir, { recursive: true })
    const versionFile = join(testDir, '.version')
    await writeFile(versionFile, '0.1.0+mockhash\n')
    const serverFile = join(testDir, 'orcad-server.js')
    await writeFile(serverFile, 'tampered-code')

    const fileMap = new Map([
      ['orcad-server.js', { sha: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' }]
    ])

    const isValid = await verifySlotIntegrity(testDir, fileMap)
    assert.equal(isValid, false)

    await rm(testDir, { recursive: true, force: true })
  })

  it('rejects symlinks in slot files', async () => {
    const testDir = join(tmpdir(), `test-slot-symlink-${randomUUID()}`)
    await mkdir(testDir, { recursive: true })
    const targetFile = join(testDir, 'real.js')
    await writeFile(targetFile, 'content')
    const linkFile = join(testDir, 'orcad-server.js')
    await symlink(targetFile, linkFile)

    const fileMap = new Map([
      ['orcad-server.js', { sha: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' }]
    ])

    const isValid = await verifySlotIntegrity(testDir, fileMap)
    assert.equal(isValid, false)

    await rm(testDir, { recursive: true, force: true })
  })
})
