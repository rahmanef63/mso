/**
 * Actual install adapter for the MSO-owned Orca web runtime.
 *
 * Sequence: validate the configured split origin -> refuse a foreign unit ->
 * verify the systemd user bus -> verify the fixed loopback port -> acquire and
 * rehash the pinned release -> write a private service config and a fixed-argv
 * user unit -> start only `mso-orca.service` -> require live process identity,
 * readiness on the configured WSS endpoint, and the static web bundle before
 * writing the install receipt.
 *
 * No apt, root, loginctl, firewall, DNS, public-access or credential change is
 * performed. The operator's existing Orca state and port 6768 are never read,
 * reused or signalled.
 */

import { isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_PORT, ORCA_VERSION } from './constants.mjs'
import { ensureIsolatedDirectories } from './env.mjs'
import {
  assertPreparedRelease,
  assertPortFree,
  assertUserSystemdBus,
  defaultUserBusEnvironment,
  toWssEndpoint
} from './managed-preflight.mjs'
import {
  INSTALL_RECEIPT_FILENAME,
  MANAGED_APP_ID,
  SERVICE_CONFIG_FILENAME,
  SERVICE_NAME,
  UNIT_IDENTITY_MARKER,
  assertManagedRootFitsUnixSocket,
  installReceiptPath,
  orcaServiceUnitPath,
  resolveManagedRoot,
  serviceConfigPath
} from './managed-paths.mjs'
import { probeOrcaWebClient, readManagedOrcaStatus } from './managed-status.mjs'
import { defaultSystemctl, sleep, waitForReady, writeUnitAtomic } from './managed-unit-write.mjs'
import { writePrivateFile } from './private-store.mjs'
import { preparePinnedRelease } from './release.mjs'
import { assertConfiguredAdvertisedEndpoint, assertPersistentPort } from './supervision.mjs'
import { inspectExistingUnit, renderOrcaServiceUnit } from './systemd-unit.mjs'

const DEFAULT_CLI_SCRIPT = fileURLToPath(new URL('./cli.mjs', import.meta.url))
const CONTROL = /[\0\r\n]/

export async function installManagedOrca({
  managedRoot,
  env = process.env,
  home = env.HOME,
  port = DEFAULT_PORT,
  advertisedEndpoint,
  allowDownload = true,
  verifiedDebCache,
  dryRun = false,
  hostNode = process.execPath,
  cliScript = DEFAULT_CLI_SCRIPT,
  prepare = preparePinnedRelease,
  userBus = defaultUserBusEnvironment,
  portProbe = assertPortFree,
  systemctl = defaultSystemctl,
  readStatus = readManagedOrcaStatus,
  probeWeb = probeOrcaWebClient,
  wait = sleep,
  timeoutMs = 90_000,
  pollMs = 2_000,
  now = () => new Date().toISOString(),
  signal
} = {}) {
  const root = managedRoot
    ? resolveManagedRoot({ env: { ...env, ORCA_HOME: managedRoot }, home })
    : resolveManagedRoot({ env, home })
  const fixedPort = assertPersistentPort(port)
  const advertised = assertConfiguredAdvertisedEndpoint(advertisedEndpoint)
  const unitPath = orcaServiceUnitPath({ home })
  const existing = await inspectExistingUnit({ unitPath })

  const unit = renderOrcaServiceUnit({
    hostNode,
    cliScript,
    managedRoot: root,
    port: fixedPort,
    advertisedEndpoint: advertised
  })

  const plannedConfig = {
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

  if (dryRun) {
    return { dryRun: true, managedRoot: root, unitPath, unit, config: plannedConfig, existingUnit: existing.state }
  }

  if (CONTROL.test(env?.HOME ?? '') || (env?.HOME && !isAbsolute(env.HOME))) {
    throw new Error('HOME must be an absolute path without control characters')
  }

  assertManagedRootFitsUnixSocket(root)
  const bus = await assertUserSystemdBus({ env, probe: userBus })
  await portProbe({ port: fixedPort, host: '127.0.0.1' })
  await ensureIsolatedDirectories(root)

  const prepared = assertPreparedRelease(
    await prepare({
      installRoot: root,
      ...(verifiedDebCache ? { verifiedDebCache } : {}),
      allowDownload,
      signal
    }),
    root
  )

  const config = {
    ...plannedConfig,
    release: {
      releaseRoot: prepared.releaseRoot,
      slotDir: prepared.slotDir,
      webDir: prepared.webDir,
      nodeBinary: prepared.nodeBinary,
      receiptPath: prepared.receiptPath,
      contentId: prepared.receipt.release.contentId
    },
    installedAt: now()
  }

  // Private config first: it contains no pairing material and is the only
  // non-unit file the runtime needs to identify its release.
  await writePrivateFile(serviceConfigPath(root), config, { root })
  await writeUnitAtomic(unitPath, unit)

  await systemctl({ args: ['daemon-reload'], env, bus })
  await systemctl({ args: ['enable', '--now', SERVICE_NAME], env, bus })

  const ready = await waitForReady({
    root,
    port: fixedPort,
    advertisedEndpoint: advertised,
    timeoutMs,
    pollMs,
    readStatus,
    probeWeb,
    wait
  })

  const receipt = {
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
    readyAt: ready.readyAt ?? now()
  }
  await writePrivateFile(installReceiptPath(root), receipt, { root })

  return {
    dryRun: false,
    managedRoot: root,
    unitPath,
    unit,
    config,
    receipt,
    runtimeId: ready.runtimeId,
    boundEndpoint: ready.boundEndpoint,
    advertisedEndpoint: ready.advertisedEndpoint
  }
}

function isAbsolutePath(value) {
  return value.startsWith('/')
}

// Re-exported so existing callers/tests keep one import point.
export { assertPortFree, assertUserSystemdBus, toWssEndpoint }
export { INSTALL_RECEIPT_FILENAME, SERVICE_CONFIG_FILENAME, SERVICE_NAME }
