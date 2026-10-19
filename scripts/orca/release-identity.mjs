/**
 * Pure release identity derived only from pinned release facts.
 *
 * The content id can be computed before downloading/extracting anything, which
 * lets `preparePinnedRelease` locate and fully re-verify an existing release
 * without touching the network or the filesystem source cache.
 */

import { createHash } from 'node:crypto'
import {
  ORCA_DEB_ARCHITECTURE,
  ORCA_DEB_PACKAGE,
  ORCA_DEB_SHA256,
  ORCA_DEB_SIZE,
  ORCA_DEB_URL,
  ORCA_LICENSE_SHA256,
  ORCA_LICENSE_SIZE,
  ORCA_SOURCE_COMMIT,
  ORCA_THIRD_PARTY_NOTICES_SHA256,
  ORCA_THIRD_PARTY_NOTICES_SIZE,
  ORCA_VERSION,
  ORCAD_VERSION,
  PINNED_NODE,
  SUPPORTED_TARGET
} from './constants.mjs'

export const RELEASE_CONTENT_ID_LENGTH = 16
export const RELEASE_RUNTIME_DIRNAME = 'runtimes'
export const RELEASE_RUNTIME_DIR_PREFIX = 'node-'

/** Upstream slot-relative runtime: `<slot>/../runtimes/node-<exeSha>/bin/node`. */
export function nodeRuntimeRelativePath(executableSha256) {
  return `${RELEASE_RUNTIME_DIRNAME}/${RELEASE_RUNTIME_DIR_PREFIX}${executableSha256}/bin/node`
}

export function getReleaseContentId() {
  return createHash('sha256')
    .update(
      [
        'mso-orca-release-v3',
        'runtimes/node-<executableSha256>/bin/node',
        'slot-version:sha256-raw-bytes-orcadArtifactFilenames-order',
        ORCA_VERSION,
        ORCAD_VERSION,
        ORCA_SOURCE_COMMIT,
        ORCA_DEB_URL,
        ORCA_DEB_SHA256,
        String(ORCA_DEB_SIZE),
        PINNED_NODE.version,
        PINNED_NODE.archiveUrl,
        PINNED_NODE.archiveSha256,
        PINNED_NODE.executableSha256,
        ORCA_LICENSE_SHA256,
        ORCA_THIRD_PARTY_NOTICES_SHA256
      ].join('\n')
    )
    .digest('hex')
    .slice(0, RELEASE_CONTENT_ID_LENGTH)
}

export function getReleaseIdentity() {
  return Object.freeze({
    schemaVersion: 3,
    version: ORCA_VERSION,
    orcadVersion: ORCAD_VERSION,
    target: SUPPORTED_TARGET,
    sourceCommit: ORCA_SOURCE_COMMIT,
    contentId: getReleaseContentId(),
    runtimeLayout: {
      dirname: RELEASE_RUNTIME_DIRNAME,
      dirPrefix: RELEASE_RUNTIME_DIR_PREFIX,
      slotRelativePath: `../${RELEASE_RUNTIME_DIRNAME}`
    },
    deb: {
      url: ORCA_DEB_URL,
      sha256: ORCA_DEB_SHA256,
      size: ORCA_DEB_SIZE,
      package: ORCA_DEB_PACKAGE,
      architecture: ORCA_DEB_ARCHITECTURE
    },
    node: {
      version: PINNED_NODE.version,
      archiveUrl: PINNED_NODE.archiveUrl,
      archiveSha256: PINNED_NODE.archiveSha256,
      archiveSize: PINNED_NODE.archiveSize,
      executableSha256: PINNED_NODE.executableSha256,
      executablePath: nodeRuntimeRelativePath(PINNED_NODE.executableSha256)
    },
    licenses: [
      { path: 'licenses/LICENSE', sha256: ORCA_LICENSE_SHA256, size: ORCA_LICENSE_SIZE },
      {
        path: 'licenses/THIRD_PARTY_NOTICES.md',
        sha256: ORCA_THIRD_PARTY_NOTICES_SHA256,
        size: ORCA_THIRD_PARTY_NOTICES_SIZE
      }
    ]
  })
}
