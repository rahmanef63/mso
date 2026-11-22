#!/usr/bin/env node
/**
 * Reviewed AppDeck lifecycle adapter for the MSO-owned Orca web runtime.
 *
 * Fixed grammar only: `--version`, `status [--json]`, `check [--json]`,
 * `install [--dry-run]`, `update --yes`, `uninstall --yes [--dry-run]`.
 * No arbitrary request value ever becomes part of the service argv.
 */

import { ORCA_VERSION } from './constants.mjs'
import { redactSensitiveText } from './bounded-proc.mjs'
import { installManagedOrca, toWssEndpoint } from './managed-install.mjs'
import {
  SERVICE_NAME,
  orcaServiceUnitPath,
  resolveManagedRoot,
  serviceConfigPath
} from './managed-paths.mjs'
import { assertUserSystemdBus, defaultUserBusEnvironment } from './managed-preflight.mjs'
import { readInstalledOrcaRelease } from './managed-receipt.mjs'
import { readManagedOrcaStatus } from './managed-status.mjs'
import { uninstallManagedOrca } from './managed-uninstall.mjs'
import { defaultSystemctl } from './managed-unit-write.mjs'
import { readPrivateJson } from './private-store.mjs'
import { getReleaseContentId } from './release-identity.mjs'
import { inspectExistingUnit } from './systemd-unit.mjs'

const USAGE = `usage: managed-app-orca <command>

Commands:
  --version                  Print ${ORCA_VERSION} only when a verified managed release is installed.
  status [--json]            Safe local status; never includes pairing material.
  check [--json]             Compare installed Orca release against pinned ${ORCA_VERSION}.
  install [--dry-run]        Install the pinned Orca web runtime and ${SERVICE_NAME}.
  update --yes               Reconcile the owned Orca runtime to pinned ${ORCA_VERSION}.
  uninstall --yes [--dry-run] Remove ${SERVICE_NAME} and managed runtime files (keeps MSO backups).
`

function fail(message, code) {
  process.stderr.write(`${redactSensitiveText(String(message))}\n`)
  process.exitCode = code
}

function printLine(text) {
  process.stdout.write(`${text}\n`)
}

async function commandVersion() {
  const release = await readInstalledOrcaRelease()
  if (!release.installed) {
    fail(`orca is not installed (${release.reason})`, 1)
    return
  }
  printLine(release.version)
}

async function commandStatus(rest) {
  const status = await readManagedOrcaStatus()
  if (rest.includes('--json')) {
    printLine(JSON.stringify(status))
    return
  }
  if (!status.available) {
    printLine(`not ready: ${status.reason}`)
    return
  }
  printLine(`${status.version} ready on ${status.boundEndpoint} (advertised ${status.advertisedEndpoint})`)
}

async function commandCheck(rest) {
  const release = await readInstalledOrcaRelease()
  if (!release.installed) {
    fail(`orca is not installed (${release.reason})`, 1)
    return
  }
  const hasUpdate = release.version !== ORCA_VERSION || release.releaseContentId !== getReleaseContentId()
  const detail = hasUpdate
    ? `Pinned Orca ${ORCA_VERSION} is available (installed: ${release.version}).`
    : `Installed Orca ${release.version} matches pinned release ${ORCA_VERSION}.`
  const payload = {
    currentVersion: release.version,
    latestVersion: ORCA_VERSION,
    hasUpdate,
    updateSupported: true,
    detail
  }
  printLine(rest.includes('--json') ? JSON.stringify(payload) : detail)
}

async function resolveUpdateAdvertisedEndpoint(root) {
  const saved = await readPrivateJson(serviceConfigPath(root), { root }).catch(() => null)
  if (typeof saved?.advertisedEndpoint === 'string' && saved.advertisedEndpoint) {
    return saved.advertisedEndpoint
  }
  return toWssEndpoint(process.env.MSO_INSTALL_APP_ORIGIN)
}

async function commandInstall(rest) {
  const unknown = rest.filter((arg) => arg !== '--dry-run')
  if (unknown.length) {
    fail(`unsupported install option: ${unknown[0]}`, 2)
    return
  }
  const bind = process.env.MSO_INSTALL_GATEWAY_BIND || 'loopback'
  if (bind !== 'loopback') {
    fail(`Orca install supports loopback only; refusing bind mode '${bind}'`, 2)
    return
  }
  let advertised
  try {
    advertised = toWssEndpoint(process.env.MSO_INSTALL_APP_ORIGIN)
  } catch (err) {
    fail(err.message, 2)
    return
  }
  const dryRun = rest.includes('--dry-run')
  const result = await installManagedOrca({
    advertisedEndpoint: advertised,
    dryRun,
    onProgress: dryRun ? () => {} : (message) => printLine(`==> ${message}`)
  })
  const root = resolveManagedRoot()
  if (dryRun) {
    printLine(`==> dry run: would install Orca ${ORCA_VERSION} into ${root}`)
    printLine(`==> dry run: would write ${result.unitPath} and start ${SERVICE_NAME}`)
    return
  }
  printLine(`[appdeck] step=ready Orca ${ORCA_VERSION} ready on ${result.boundEndpoint}`)
  printLine(`==> Orca ${ORCA_VERSION} ready on ${result.boundEndpoint} (advertised ${result.advertisedEndpoint})`)
  printLine(`==> managed by ${SERVICE_NAME}; root ${root}`)
}

async function commandUpdate(rest) {
  if (rest[0] !== '--yes' || rest.length > 1) {
    fail('update requires --yes', 2)
    return
  }
  const root = resolveManagedRoot()
  let advertised
  try {
    advertised = await resolveUpdateAdvertisedEndpoint(root)
  } catch (err) {
    fail(err.message, 2)
    return
  }
  const unitPath = orcaServiceUnitPath()
  const existing = await inspectExistingUnit({ unitPath })
  if (existing.state === 'managed') {
    const bus = await assertUserSystemdBus({ env: process.env, probe: defaultUserBusEnvironment })
    printLine(`[appdeck] step=quiesce Stopping ${SERVICE_NAME} before applying pinned Orca ${ORCA_VERSION}`)
    await defaultSystemctl({ args: ['stop', SERVICE_NAME], env: process.env, bus, allowFailure: true })
  }
  printLine(`[appdeck] step=apply Reconciling Orca to pinned release ${ORCA_VERSION}`)
  const result = await installManagedOrca({
    advertisedEndpoint: advertised,
    onProgress: (message) => printLine(`==> ${message}`)
  })
  printLine(`[appdeck] step=ready Orca ${ORCA_VERSION} updated and ready on ${result.boundEndpoint}`)
}

async function commandUninstall(rest) {
  if (rest[0] === '--help') {
    printLine('usage: managed-app-orca uninstall --yes [--dry-run]')
    return
  }
  if (rest[0] !== '--yes' || rest.length > 2 || (rest[1] && rest[1] !== '--dry-run')) {
    fail('uninstall requires --yes [--dry-run]', 2)
    return
  }
  const dryRun = rest[1] === '--dry-run'
  const outcome = await uninstallManagedOrca({
    dryRun,
    onProgress: (message) => printLine(`==> ${message}`)
  })
  if (dryRun) {
    printLine(`would remove unit: ${outcome.unitPath} (${outcome.unitState})`)
    printLine(`would remove managed runtime files under: ${outcome.managedRoot}`)
    printLine('kept: MSO backup snapshots in ~/.mso/backups/orca')
    return
  }
  printLine(`[appdeck] step=ready Removed ${SERVICE_NAME} and managed runtime under ${outcome.managedRoot}`)
}

async function main(argv) {
  const command = argv[2] ?? ''
  const rest = argv.slice(3)
  switch (command) {
    case '--version': return commandVersion()
    case 'status': return commandStatus(rest)
    case 'check': return commandCheck(rest)
    case 'install': return commandInstall(rest)
    case 'update': return commandUpdate(rest)
    case 'uninstall': return commandUninstall(rest)
    default: fail(USAGE.trimEnd(), 2)
  }
}

if (process.argv[1] && process.argv[1].endsWith('managed-app-orca.mjs')) {
  main(process.argv).catch((err) => {
    process.stderr.write(`${redactSensitiveText(err?.message ?? 'orca adapter failed')}\n`)
    process.exitCode = 1
  })
}

export { main }
