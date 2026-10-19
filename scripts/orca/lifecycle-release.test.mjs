import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { lstat, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareRelease } from './lifecycle-release.mjs'
import { getReleaseContentId, getReleaseIdentity } from './release-identity.mjs'

const ID = getReleaseContentId()
const NODE_REL = getReleaseIdentity().node.executablePath

function shape(root, overrides = {}) {
  const releaseRoot = join(root, 'releases', `1.4.230+${ID}`)
  return {
    releaseRoot,
    slotDir: join(releaseRoot, 'slot'),
    nodeBinary: join(releaseRoot, NODE_REL),
    webDir: join(releaseRoot, 'web'),
    receiptPath: join(releaseRoot, 'receipt.json'),
    version: '1.4.230',
    receipt: { release: { contentId: ID } },
    ...overrides
  }
}

async function base() {
  const baseDir = await mkdtemp(join(tmpdir(), 'oi-'))
  return { baseDir, root: join(baseDir, 'root'), cleanup: () => rm(baseDir, { recursive: true, force: true }) }
}

describe('prepareRelease shares the exact install-adapter release guard', () => {
  it('accepts a canonical pinned release and rejects a lexical `root/../foreign` releaseRoot', async () => {
    const d = await base()
    try {
      const release = shape(d.root)
      const prepared = await prepareRelease({ managedRoot: d.root, prepare: async () => release })
      assert.equal(prepared.releaseRoot, release.releaseRoot)

      // The old local guard accepted this spelling; the shared guard does not.
      await assert.rejects(
        () =>
          prepareRelease({
            managedRoot: d.root,
            prepare: async () => shape(d.root, { releaseRoot: `${d.root}/../foreign` })
          }),
        /immutable release root|not a canonical path/
      )
    } finally {
      await d.cleanup()
    }
  })

  it('fails closed on a dirty managed root and never creates it', async () => {
    const d = await base()
    try {
      for (const dirty of ['relative/root', `${d.root}/`, `${d.root}/../evil`]) {
        await assert.rejects(
          () => prepareRelease({ managedRoot: dirty, prepare: async () => shape(d.root) }),
          /managedRoot must be an absolute path|ORCA_HOME/
        )
      }
      await assert.rejects(() => lstat(d.root), { code: 'ENOENT' })
    } finally {
      await d.cleanup()
    }
  })

  it('refuses an over-deep root BEFORE creating anything', async () => {
    const d = await base()
    try {
      const deep = join(d.baseDir, 'x'.repeat(120))
      await assert.rejects(
        () => prepareRelease({ managedRoot: deep, prepare: async () => shape(deep) }),
        /too deep/
      )
      await assert.rejects(() => lstat(deep), { code: 'ENOENT' })
    } finally {
      await d.cleanup()
    }
  })
})
