/**
 * MSO's release-preparation wrapper.
 *
 * There is exactly one acquisition path: the reviewed `preparePinnedRelease`
 * API in release.mjs, which verifies the pinned .deb digest, extracts a
 * data-only slot, pins Node, and publishes an immutable release. This wrapper
 * adds only managed-root isolation and the SAME release-shape guard the install
 * adapter uses; it deliberately has no `--template`/`--web` bypass, so
 * production cannot be pointed at unreviewed upstream bytes.
 */

import { isAbsolute } from 'node:path'
import { ensureIsolatedDirectories } from './env.mjs'
import { assertPreparedRelease } from './managed-preflight.mjs'
import { assertManagedRootFitsUnixSocket, resolveManagedRoot } from './managed-paths.mjs'
import { preparePinnedRelease } from './release.mjs'

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
  // Fail closed and IDENTICAL to the install adapter (managed-install.mjs):
  // refuse a non-canonical, traversal, home, filesystem-root, or operator
  // `.orca`/`.orca-remote` ORCA_HOME spelling, and refuse a root too deep for the
  // runtime's Unix socket. Both checks run BEFORE ensureIsolatedDirectories, so a
  // misconfigured root creates nothing.
  const root = resolveManagedRoot({ env: { ORCA_HOME: managedRoot } })
  assertManagedRootFitsUnixSocket(root)
  await ensureIsolatedDirectories(root)
  const verified = verifiedDebCache ?? debPath
  const prepared = await prepare({
    installRoot: root,
    ...(verified ? { verifiedDebCache: verified } : {}),
    allowDownload: allowDownload === true,
    signal
  })
  // One guard, not two: this is the exact `assertPreparedRelease` the install
  // adapter calls, so the CLI and the adapter cannot diverge on what a valid
  // pinned release is (the previous local copy accepted a lexical
  // `root/../foreign` releaseRoot that the shared guard rejects).
  return assertPreparedRelease(prepared, root)
}
