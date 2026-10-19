import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { assertPreparedRelease } from './managed-preflight.mjs'
import { getReleaseContentId, getReleaseIdentity } from './release-identity.mjs'

const ROOT = '/srv/mso/orca'
const ID = getReleaseContentId()
const NODE_REL = getReleaseIdentity().node.executablePath
const RELEASE_ROOT = join(ROOT, 'releases', `1.4.230+${ID}`)

function release(overrides = {}) {
  return {
    releaseRoot: RELEASE_ROOT,
    slotDir: join(RELEASE_ROOT, 'slot'),
    webDir: join(RELEASE_ROOT, 'web'),
    receiptPath: join(RELEASE_ROOT, 'receipt.json'),
    nodeBinary: join(RELEASE_ROOT, NODE_REL),
    version: '1.4.230',
    receipt: { release: { contentId: ID } },
    ...overrides
  }
}

describe('prepared release containment', () => {
  it('accepts only the exact pinned release layout', () => {
    assert.equal(assertPreparedRelease(release(), ROOT).releaseRoot, RELEASE_ROOT)
  })

  it('rejects a release root that is not <root>/releases/<pinned id>', () => {
    for (const bad of [join(ROOT, 'releases', 'other'), join(ROOT, 'releases'), ROOT, '/srv/etc']) {
      assert.throws(() => assertPreparedRelease(release({ releaseRoot: bad }), ROOT), /immutable release root/)
    }
  })

  it('rejects any slot/node/web/receipt path outside the release root', () => {
    for (const key of ['slotDir', 'webDir', 'receiptPath', 'nodeBinary']) {
      assert.throws(() => assertPreparedRelease(release({ [key]: '/usr/bin/node' }), ROOT), /outside the immutable release root/)
    }
  })

  it('rejects a non-canonical spelling that would normalize elsewhere', () => {
    const escaped = `${RELEASE_ROOT}/../../etc/passwd`
    assert.throws(() => assertPreparedRelease(release({ nodeBinary: escaped }), ROOT), /canonical path/)
  })

  it('rejects a version or content-id mismatch', () => {
    assert.throws(() => assertPreparedRelease(release({ version: '1.0.0' }), ROOT), /version mismatch/)
    assert.throws(
      () => assertPreparedRelease(release({ receipt: { release: { contentId: 'nope' } } }), ROOT),
      /content id/
    )
  })
})
