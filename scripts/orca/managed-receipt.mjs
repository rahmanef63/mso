/**
 * Verified installed-release reader for the Orca lifecycle adapter.
 *
 * `--version` may report the pinned version only after an actual install receipt
 * exists and the immutable release root it names still rehashes clean. The
 * presence of this repository's wrapper script proves nothing.
 */

import { lstat } from 'node:fs/promises'
import { isAbsolute, relative } from 'node:path'
import { ORCA_VERSION } from './constants.mjs'
import { installReceiptPath, resolveManagedRoot } from './managed-paths.mjs'
import { readPrivateJson } from './private-store.mjs'
import { getReleaseIdentity } from './release-identity.mjs'
import { verifyInstalledRelease } from './release-receipt.mjs'

const unavailable = (reason) => ({ installed: false, reason })

function isInside(root, candidate) {
  if (typeof candidate !== 'string' || !isAbsolute(candidate)) return false
  const rel = relative(root, candidate)
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel)
}

export async function readInstalledOrcaRelease({
  managedRoot = resolveManagedRoot(),
  verify = verifyInstalledRelease,
  identity = getReleaseIdentity()
} = {}) {
  const root = managedRoot
  const receiptPath = installReceiptPath(root)
  try {
    // `readPrivateJson` reports an absent file as a plain error without a code,
    // so classify presence first: no receipt means "not installed", while a
    // present-but-rejected one is merely unreadable. Never parses error text.
    await lstat(receiptPath)
  } catch (err) {
    return unavailable(err?.code === 'ENOENT' ? 'not_installed' : 'install_receipt_unreadable')
  }
  let receipt
  try {
    receipt = await readPrivateJson(receiptPath, { root })
  } catch {
    return unavailable('install_receipt_unreadable')
  }
  if (
    !receipt ||
    receipt.schemaVersion !== 1 ||
    receipt.applicationId !== 'orca' ||
    receipt.version !== ORCA_VERSION
  ) {
    return unavailable('invalid_install_receipt')
  }
  if (!isInside(root, receipt.releaseRoot)) return unavailable('install_receipt_outside_root')

  let verified
  try {
    verified = await verify({ releaseRoot: receipt.releaseRoot, identity })
  } catch {
    return unavailable('installed_release_failed_verification')
  }
  if (verified?.version !== receipt.version || verified?.receipt?.release?.contentId !== receipt.releaseContentId) {
    return unavailable('installed_release_identity_mismatch')
  }
  return {
    installed: true,
    version: verified.version,
    releaseRoot: verified.releaseRoot,
    contentId: verified.receipt.release.contentId,
    advertisedEndpoint: receipt.advertisedEndpoint ?? null
  }
}
