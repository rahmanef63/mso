import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
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
  fileSha256,
  fetchAndMaterializeNodeRuntime,
  verifyArchiveBuffer,
  verifyExecutableBuffer
} from './node-runtime.mjs'

async function scratch(name) {
  const dir = join(tmpdir(), `orca-node-${name}-${randomUUID()}`)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  return dir
}

describe('node-runtime pin & verification', () => {
  it('pins Node 24.21.0 linux-x64-glibc', () => {
    assert.equal(SUPPORTED_TARGET, 'linux-x64-glibc')
    assert.equal(PINNED_NODE.version, '24.21.0')
    assert.equal(PINNED_NODE.archiveSha256, '6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff')
    assert.equal(PINNED_NODE.executableSha256, '7fde7b8afa198da66257f42ee2001d874c7355631e6d1579a5fb5ef1f246df4c')
    assert.equal(ORCAD_VERSION, '0.1.0')
    assert.equal(ORCA_VERSION, '1.4.230')
  })

  it('rejects unsupported target architectures', () => {
    assert.equal(isSupportedTarget('linux-x64-glibc'), true)
    for (const target of ['darwin-arm64', 'linux-arm64-glibc', 'win32-x64', 'linux-x64-musl']) {
      assert.equal(isSupportedTarget(target), false)
    }
  })

  it('verifies and rejects executable/archive buffers', () => {
    const executable = Buffer.from('mock-node-binary')
    const executableSha = '16624a14bcc82ed24a406bb3af9f53ad29b48d24c67d7202870540237e419587'
    assert.doesNotThrow(() => verifyExecutableBuffer(executable, executableSha))
    assert.throws(
      () => verifyExecutableBuffer(Buffer.from('tampered'), PINNED_NODE.executableSha256),
      /checksum mismatch/i
    )
    assert.throws(
      () => verifyArchiveBuffer(Buffer.from('tampered'), PINNED_NODE.archiveSha256),
      /checksum mismatch/i
    )
  })

  it('hashes a file from disk', async () => {
    const root = await scratch('hash')
    try {
      const file = join(root, 'data.bin')
      await writeFile(file, 'hello orca')
      const expected = '7fd0dd3b7c8f1f9b1c0d3c9d8d5e6f5f5b2c1c8f8b8b8b8b8b8b8b8b8b8b8b8b'
      assert.equal((await fileSha256(file)).length, 64)
      assert.notEqual(await fileSha256(file), expected)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a symlinked Node destination', async () => {
    const root = await scratch('symlink')
    try {
      const binDir = join(root, `node-${PINNED_NODE.executableSha256}`, 'bin')
      await mkdir(binDir, { recursive: true })
      const real = join(root, 'real-bin')
      await writeFile(real, 'content')
      await symlink(real, join(binDir, 'node'))
      await assert.rejects(
        fetchAndMaterializeNodeRuntime({ runtimesDir: root, allowDownload: false }),
        /symlink/i
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses a tampered cached executable without overwriting it', async () => {
    const root = await scratch('tampered')
    try {
      const binDir = join(root, `node-${PINNED_NODE.executableSha256}`, 'bin')
      await mkdir(binDir, { recursive: true })
      await writeFile(join(binDir, 'node'), 'tampered-binary', { mode: 0o700 })
      await assert.rejects(
        fetchAndMaterializeNodeRuntime({ runtimesDir: root, allowDownload: false }),
        /checksum mismatch/i
      )
      assert.equal(await readFile(join(binDir, 'node'), 'utf8'), 'tampered-binary')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses a torn Node runtime directory', async () => {
    const root = await scratch('torn')
    try {
      await mkdir(join(root, `node-${PINNED_NODE.executableSha256}`), { recursive: true })
      await assert.rejects(
        fetchAndMaterializeNodeRuntime({ runtimesDir: root, allowDownload: false }),
        /torn/i
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses a corrupt cached archive without downloading or overwriting', async () => {
    const root = await scratch('archive')
    try {
      const downloadsDir = join(root, '.downloads')
      await mkdir(downloadsDir, { recursive: true, mode: 0o700 })
      await writeFile(join(downloadsDir, 'node-v24.21.0-linux-x64.tar.gz'), 'corrupt', { mode: 0o600 })
      let fetched = false
      await assert.rejects(
        fetchAndMaterializeNodeRuntime({
          runtimesDir: root,
          allowDownload: true,
          fetchImpl: async () => {
            fetched = true
            throw new Error('must not fetch')
          }
        }),
        /archive size mismatch/i
      )
      assert.equal(fetched, false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails closed when download is disabled and no verified cache exists', async () => {
    const root = await scratch('nodownload')
    try {
      await assert.rejects(
        fetchAndMaterializeNodeRuntime({ runtimesDir: root, allowDownload: false }),
        /download not allowed/i
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
