/**
 * MSO's release-preparation wrapper.
 *
 * There is exactly one acquisition path: the reviewed `preparePinnedRelease`
 * API in release.mjs, which verifies the pinned .deb digest, extracts a
 * data-only slot, pins Node, and publishes an immutable release. This wrapper
 * adds only managed-root isolation and a defensive shape check; it deliberately
 * has no `--template`/`--web` bypass, so production cannot be pointed at
 * unreviewed upstream bytes.
 */

import { isAbsolute, relative } from 'node:path'
import { ORCA_VERSION } from './constants.mjs'
import { ensureIsolatedDirectories } from './env.mjs'
import { getReleaseContentId } from './release-identity.mjs'
import { preparePinnedRelease } from './release.mjs'

function insideOrEqual(root, candidate) {
  if (typeof candidate !== 'string' || !isAbsolute(candidate)) return false
  return candidate === root || candidate.startsWith(`${root}/`)
}

function inside(root, candidate) {
  if (typeof candidate !== 'string' || !isAbsolute(candidate)) return false
  const rel = relative(root, candidate)
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel)
}

function assertPreparedRelease(prepared, managedRoot) {
  if (!prepared || typeof prepared !== 'object') throw new Error('preparePinnedRelease returned no release')
  for (const key of ['releaseRoot', 'slotDir', 'nodeBinary', 'webDir', 'receiptPath']) {
    if (typeof prepared[key] !== 'string' || !isAbsolute(prepared[key])) {
      throw new Error(`prepared release ${key} must be an absolute path`)
    }
  }
  if (!insideOrEqual(managedRoot, prepared.releaseRoot)) {
    throw new Error('prepared release is outside the managed root')
  }
  for (const key of ['slotDir', 'nodeBinary', 'webDir', 'receiptPath']) {
    if (!inside(prepared.releaseRoot, prepared[key])) {
      throw new Error(`prepared release ${key} is outside the immutable release root`)
    }
  }
  if (prepared.version !== ORCA_VERSION) {
    throw new Error(`prepared release version mismatch: expected ${ORCA_VERSION}, got ${prepared.version}`)
  }
  if (prepared.receipt?.release?.contentId !== getReleaseContentId()) {
    throw new Error('prepared release receipt content id does not match the pinned release')
  }
  return {
    releaseRoot: prepared.releaseRoot,
    slotDir: prepared.slotDir,
    nodeBinary: prepared.nodeBinary,
    webDir: prepared.webDir,
    receiptPath: prepared.receiptPath,
    receipt: prepared.receipt,
    version: prepared.version
  }
}

/**
 * @param allowDownload explicit opt-in. Default false: an already-installed
 *   release is reused after a full rehash and a missing one fails clearly
 *   instead of silently reaching the network.
 */
export async function prepareRelease({
  managedRoot,
  verifiedDebCache,
  debPath,
  allowDownload = false,
  signal,
  prepare = preparePinnedRelease
} = {}) {
  if (typeof managedRoot !== 'string' || !isAbsolute(managedRoot)) {
    throw new Error('managedRoot must be an absolute path')
  }
  await ensureIsolatedDirectories(managedRoot)
  const verified = verifiedDebCache ?? debPath
  const prepared = await prepare({
    installRoot: managedRoot,
    ...(verified ? { verifiedDebCache: verified } : {}),
    allowDownload: allowDownload === true,
    signal
  })
  return assertPreparedRelease(prepared, managedRoot)
}
