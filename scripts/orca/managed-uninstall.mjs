/**
 * Safe, owned-only uninstall for the MSO-managed Orca web runtime.
 *
 * Only ever touches MSO's owned `mso-orca.service` user unit and files under
 * `resolveManagedRoot()` (`~/.local/share/mso/orca`). Never reads, signals, or
 * removes a foreign unit, the operator's personal `~/.orca`, port 6768, or MSO
 * backup snapshots under `~/.mso/backups/orca`.
 */

import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  SERVICE_NAME,
  installReceiptPath,
  orcaServiceUnitPath,
  resolveManagedRoot,
  serviceConfigPath
} from './managed-paths.mjs'
import { assertUserSystemdBus, defaultUserBusEnvironment } from './managed-preflight.mjs'
import { partialInstallPath } from './managed-rollback.mjs'
import { defaultSystemctl } from './managed-unit-write.mjs'
import { inspectExistingUnit } from './systemd-unit.mjs'

export async function uninstallManagedOrca({
  managedRoot,
  env = process.env,
  home = env.HOME,
  dryRun = false,
  userBus = defaultUserBusEnvironment,
  systemctl = defaultSystemctl,
  onProgress = () => {}
} = {}) {
  const root = managedRoot
    ? resolveManagedRoot({ env: { ...env, ORCA_HOME: managedRoot }, home })
    : resolveManagedRoot({ env, home })
  const unitPath = orcaServiceUnitPath({ home })
  const existing = await inspectExistingUnit({ unitPath })

  if (existing.state === 'foreign') {
    throw new Error(`refusing to uninstall foreign systemd unit at ${unitPath}`)
  }

  const ownedTargets = [
    installReceiptPath(root),
    serviceConfigPath(root),
    partialInstallPath(root),
    join(root, 'releases')
  ]

  if (dryRun) {
    return {
      dryRun: true,
      managedRoot: root,
      unitPath,
      unitState: existing.state,
      removedTargets: ownedTargets
    }
  }

  if (existing.state === 'managed') {
    const bus = await assertUserSystemdBus({ env, probe: userBus })
    onProgress(`stopping and disabling ${SERVICE_NAME}`)
    await systemctl({ args: ['disable', '--now', SERVICE_NAME], env, bus, allowFailure: true })
    await rm(unitPath, { force: true })
    await systemctl({ args: ['daemon-reload'], env, bus, allowFailure: true })
  }

  onProgress(`removing managed Orca runtime files under ${root}`)
  for (const target of ownedTargets) {
    await rm(target, { recursive: true, force: true })
  }

  return {
    dryRun: false,
    managedRoot: root,
    unitPath,
    unitState: existing.state,
    removedTargets: ownedTargets
  }
}
