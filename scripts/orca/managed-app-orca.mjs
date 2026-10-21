#!/usr/bin/env node
/**
 * Reviewed lifecycle adapter for the MSO-owned Orca web runtime.
 *
 * Fixed grammar only: `--version`, `status [--json]`, `check [--json]`,
 * `install [--dry-run]`, `update`, `uninstall`. No arbitrary request value ever
 * becomes part of the service argv. Update/uninstall/rollback deliberately fail
 * closed rather than pretend to be implemented.
 */

import { ORCA_VERSION } from './constants.mjs'
import { redactSensitiveText } from './bounded-proc.mjs'
import { installManagedOrca, toWssEndpoint } from './managed-install.mjs'
import { resolveManagedRoot, SERVICE_NAME } from './managed-paths.mjs'
import { readInstalledOrcaRelease } from './managed-receipt.mjs'
import { readManagedOrcaStatus } from './managed-status.mjs'

const USAGE = `usage: managed-app-orca <command>

Commands:
  --version             Print ${ORCA_VERSION} only when a verified managed release is installed.
  status [--json]       Safe local status; never includes pairing material.
  check [--json]        Update probe; Orca updates are not implemented yet.
  install [--dry-run]   Install the pinned Orca web runtime and ${SERVICE_NAME}.
  update --yes          Not implemented; fails closed.
  uninstall --yes       Not implemented; fails closed.
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
  const payload = {
    currentVersion: release.version,
    latestVersion: ORCA_VERSION,
    hasUpdate: false,
    updateSupported: false
  }
  printLine(rest.includes('--json') ? JSON.stringify(payload) : `current ${release.version}; updates not implemented`)
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
  const result = await installManagedOrca({ advertisedEndpoint: advertised, dryRun })
  const root = resolveManagedRoot()
  if (dryRun) {
    printLine(`==> dry run: would install Orca ${ORCA_VERSION} into ${root}`)
    printLine(`==> dry run: would write ${result.unitPath} and start ${SERVICE_NAME}`)
    return
  }
  printLine(`==> Orca ${ORCA_VERSION} ready on ${result.boundEndpoint} (advertised ${result.advertisedEndpoint})`)
  printLine(`==> managed by ${SERVICE_NAME}; root ${root}`)
}

async function main(argv) {
  const command = argv[2] ?? ''
  const rest = argv.slice(3)
  switch (command) {
    case '--version':
      return commandVersion()
    case 'status':
      return commandStatus(rest)
    case 'check':
      return commandCheck(rest)
    case 'install':
      return commandInstall(rest)
    case 'update':
      fail('orca update is not implemented; no change was made', 1)
      return
    case 'uninstall':
      return rest[0] === '--help'
        ? void printLine(USAGE.trimEnd())
        : fail('orca uninstall is not implemented; no change was made', 1)
    default:
      fail(USAGE.trimEnd(), 2)
  }
}

if (process.argv[1] && process.argv[1].endsWith('managed-app-orca.mjs')) {
  main(process.argv).catch((err) => {
    process.stderr.write(`${redactSensitiveText(err?.message ?? 'orca adapter failed')}\n`)
    process.exitCode = 1
  })
}

export { main }
