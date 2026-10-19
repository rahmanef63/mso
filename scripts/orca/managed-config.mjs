/**
 * Shape builders for the MSO-owned Orca service config and install receipt.
 *
 * Extracted from managed-install.mjs so the install SEQUENCE stays reviewable and
 * the file stays within the repository's 220-line architecture limit. These are
 * pure object builders: no filesystem, no systemd, no secrets.
 */

import { ORCA_VERSION } from './constants.mjs'
import {
  MANAGED_APP_ID,
  UNIT_IDENTITY_MARKER,
  serviceConfigPath
} from './managed-paths.mjs'

export function buildPlannedConfig({ root, unitPath, fixedPort, advertised }) {
  return {
    schemaVersion: 1,
    applicationId: MANAGED_APP_ID,
    version: ORCA_VERSION,
    unitIdentity: UNIT_IDENTITY_MARKER,
    boundEndpoint: `ws://127.0.0.1:${fixedPort}`,
    advertisedEndpoint: advertised,
    port: fixedPort,
    managedRoot: root,
    unitPath
  }
}

export function buildServiceConfig({ plannedConfig, prepared, installedAt, hostNode, cliScript }) {
  if (typeof hostNode !== 'string' || hostNode.length === 0) {
    throw new Error('managed service config requires the exact launcher hostNode')
  }
  if (typeof cliScript !== 'string' || cliScript.length === 0) {
    throw new Error('managed service config requires the canonical cliScript')
  }
  return {
    ...plannedConfig,
    // The consumer must be able to reproduce the exact ExecStart. Persist the
    // launcher host node (NOT release.nodeBinary, the pinned child runtime) and
    // the canonical CLI the installer actually rendered.
    hostNode,
    cliScript,
    release: {
      releaseRoot: prepared.releaseRoot,
      slotDir: prepared.slotDir,
      webDir: prepared.webDir,
      nodeBinary: prepared.nodeBinary,
      receiptPath: prepared.receiptPath,
      contentId: prepared.receipt.release.contentId
    },
    installedAt
  }
}

export function buildInstallReceipt({ root, config, unitPath, advertised, ready, readyAt }) {
  return {
    schemaVersion: 1,
    applicationId: MANAGED_APP_ID,
    version: ORCA_VERSION,
    runtimeId: ready.runtimeId,
    releaseRoot: config.release.releaseRoot,
    releaseContentId: config.release.contentId,
    boundEndpoint: config.boundEndpoint,
    advertisedEndpoint: advertised,
    unitPath,
    serviceConfig: serviceConfigPath(root),
    installedAt: config.installedAt,
    readyAt
  }
}
