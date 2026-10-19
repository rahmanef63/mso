import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  SUPPORTED_TARGET,
  PINNED_NODE,
  ORCAD_VERSION,
  ORCA_VERSION,
  isSupportedTarget
} from './constants.mjs'
import { verifyExecutableBuffer, verifyArchiveBuffer } from './node-runtime.mjs'

describe('node-runtime pin & verification', () => {
  it('pins Node 24.21.0 linux-x64-glibc', () => {
    assert.equal(SUPPORTED_TARGET, 'linux-x64-glibc')
    assert.equal(PINNED_NODE.version, '24.21.0')
    assert.equal(
      PINNED_NODE.archiveSha256,
      '6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff'
    )
    assert.equal(
      PINNED_NODE.executableSha256,
      '7fde7b8afa198da66257f42ee2001d874c7355631e6d1579a5fb5ef1f246df4c'
    )
    assert.equal(ORCAD_VERSION, '0.1.0')
    assert.equal(ORCA_VERSION, '1.4.230')
  })

  it('rejects unsupported target architectures', () => {
    assert.equal(isSupportedTarget('linux-x64-glibc'), true)
    assert.equal(isSupportedTarget('darwin-arm64'), false)
    assert.equal(isSupportedTarget('linux-arm64-glibc'), false)
    assert.equal(isSupportedTarget('win32-x64'), false)
    assert.equal(isSupportedTarget('linux-x64-musl'), false)
  })

  it('verifies correct executable buffer sha256', () => {
    const fakeExecutable = Buffer.from('mock-node-binary')
    const actualHash = '16624a14bcc82ed24a406bb3af9f53ad29b48d24c67d7202870540237e419587'
    assert.doesNotThrow(() => {
      verifyExecutableBuffer(fakeExecutable, actualHash)
    })
  })

  it('throws on tampered executable buffer sha256', () => {
    const fakeExecutable = Buffer.from('tampered-binary')
    assert.throws(
      () => {
        verifyExecutableBuffer(fakeExecutable, PINNED_NODE.executableSha256)
      },
      {
        message: /checksum mismatch/i
      }
    )
  })

  it('throws on tampered archive buffer sha256', () => {
    const fakeArchive = Buffer.from('tampered-archive')
    assert.throws(
      () => {
        verifyArchiveBuffer(fakeArchive, PINNED_NODE.archiveSha256)
      },
      {
        message: /checksum mismatch/i
      }
    )
  })
})
