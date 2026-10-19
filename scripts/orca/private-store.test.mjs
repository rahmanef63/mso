import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearPrivatePairIfMatch,
  ensureManagedRoot,
  publishPrivatePair,
  readPrivateJson,
  writePrivateFile
} from './private-store.mjs'

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'orca-private-'))
  await ensureManagedRoot(root)
  return root
}

describe('private managed receipts', () => {
  it('rejects symlink, loose-permission, and oversized receipt files', async () => {
    const root = await makeRoot()
    const outside = await mkdtemp(join(tmpdir(), 'orca-private-outside-'))
    try {
      const real = join(root, 'real.json')
      await writePrivateFile(real, { ok: true }, { root })
      const link = join(root, 'link.json')
      await symlink(real, link)
      await assert.rejects(() => readPrivateJson(link, { root }), /not a regular file/i)

      await mkdir(join(root, 'nested'), { mode: 0o700 })
      await symlink(join(root, 'nested'), join(root, 'alias'))
      await assert.rejects(
        () => readPrivateJson(join(root, 'alias', 'x.json'), { root }),
        /symlink ancestor/i
      )

      await chmod(real, 0o644)
      await assert.rejects(() => readPrivateJson(real, { root }), /permissions are not 0600/i)
      await chmod(real, 0o600)

      const big = join(root, 'big.json')
      await writePrivateFile(big, 'x'.repeat(64 * 1024 + 1), { root })
      await assert.rejects(() => readPrivateJson(big, { root }), /exceeds/i)

      await assert.rejects(
        () => readPrivateJson(join(outside, 'x.json'), { root }),
        /escapes managed root/i
      )
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('publishes a receipt pair as one transaction and restores the previous pair on failure', async () => {
    const root = await makeRoot()
    const status = join(root, 'private-status.json')
    const identity = join(root, 'runtime-identity.json')
    try {
      const oldStatus = JSON.stringify({ runtimeId: 'old', health: { pid: 1 } })
      const oldIdentity = JSON.stringify({ runtimeId: 'old', serverStartTicks: '1' })
      await writePrivateFile(status, oldStatus, { root })
      await writePrivateFile(identity, oldIdentity, { root })

      let renames = 0
      const failingRename = async (from, to) => {
        renames += 1
        if (renames === 2) throw new Error('injected second rename failure')
        await rename(from, to)
      }
      await assert.rejects(
        () =>
          publishPrivatePair({
            root,
            entries: [
              { path: status, data: { runtimeId: 'new', health: { pid: 2 } } },
              { path: identity, data: { runtimeId: 'new', serverStartTicks: '2' } }
            ],
            renameImpl: failingRename
          }),
        /injected second rename failure/i
      )
      assert.equal(await readFile(status, 'utf8'), oldStatus)
      assert.equal(await readFile(identity, 'utf8'), oldIdentity)
      const leftovers = (await readdir(root)).filter((name) => name.includes('.tmp-'))
      assert.deepEqual(leftovers, [])

      await publishPrivatePair({
        root,
        entries: [
          { path: status, data: { runtimeId: 'new', health: { pid: 2 } } },
          { path: identity, data: { runtimeId: 'new', serverStartTicks: '2' } }
        ]
      })
      assert.equal((await readPrivateJson(status, { root })).runtimeId, 'new')
      assert.equal((await readPrivateJson(identity, { root })).serverStartTicks, '2')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('clears only receipts that still match the caller runtime', async () => {
    const root = await makeRoot()
    const own = join(root, 'own.json')
    const other = join(root, 'other.json')
    try {
      await writePrivateFile(own, { runtimeId: 'mine', serverStartTicks: '10' }, { root })
      await writePrivateFile(other, { runtimeId: 'theirs', serverStartTicks: '20' }, { root })
      const result = await clearPrivatePairIfMatch({
        root,
        matches: [
          { path: own, predicate: (value) => value.runtimeId === 'mine' },
          { path: other, predicate: (value) => value.runtimeId === 'mine' }
        ]
      })
      assert.deepEqual(result.cleared, [own])
      assert.deepEqual(result.preserved, [other])
      await assert.rejects(lstat(own))
      assert.equal((await readPrivateJson(other, { root })).runtimeId, 'theirs')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
