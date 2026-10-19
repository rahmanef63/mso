import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import {
  SUPPORTED_TARGET,
  PINNED_NODE,
  ORCAD_VERSION,
  ORCA_VERSION,
  isSupportedTarget
} from './constants.mjs'
import {
  verifyExecutableBuffer,
  verifyArchiveBuffer,
  fetchAndMaterializeNodeRuntime
} from './node-runtime.mjs'

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
      { message: /checksum mismatch/i }
    )
  })

  it('throws on tampered archive buffer sha256', () => {
    const fakeArchive = Buffer.from('tampered-archive')
    assert.throws(
      () => {
        verifyArchiveBuffer(fakeArchive, PINNED_NODE.archiveSha256)
      },
      { message: /checksum mismatch/i }
    )
  })

  it('rejects symlink destination in runtimesDir', async () => {
    const testDir = join(tmpdir(), `test-runtime-${randomUUID()}`)
    const binDir = join(testDir, `node-${PINNED_NODE.executableSha256}`, 'bin')
    await mkdir(binDir, { recursive: true })
    const targetFile = join(testDir, 'real-bin')
    await writeFile(targetFile, 'content')
    const symlinkBin = join(binDir, 'node')
    await symlink(targetFile, symlinkBin)

    await assert.rejects(
      async () => {
        await fetchAndMaterializeNodeRuntime({
          target: 'linux-x64-glibc',
          runtimesDir: testDir,
          allowDownload: false
        })
      },
      { message: /symlink/i }
    )

    await rm(testDir, { recursive: true, force: true })
  })
})
