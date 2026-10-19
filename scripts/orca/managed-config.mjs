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

export function buildServiceConfig({ plannedConfig, prepared, installedAt }) {
  return {
    ...plannedConfig,
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
