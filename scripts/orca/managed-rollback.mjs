/**
 * Bounded rollback for the FIRST Orca install.
 *
 * A first install that fails AFTER the unit was written and started must not
 * leave a half-installed, restarting `mso-orca.service` that a rerun then
 * silently adopts. This module stops ONLY the exact unit MSO created, restores
 * the prior owned service config / unit / install receipt (or removes what this
 * attempt created), and — when any rollback step itself fails — records an
 * explicit `partial-install.json` marker so the next attempt refuses to rerun
 * instead of guessing.
 *
 * It never signals a foreign unit and never reads or writes the operator's own
 * Orca state, port 6768, or any scope other than this user's `mso-orca.service`.
 */

import { lstat, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  MANAGED_APP_ID,
  SERVICE_NAME,
  installReceiptPath,
  serviceConfigPath
} from './managed-paths.mjs'
import { readPrivateJson, writePrivateFile } from './private-store.mjs'
import { inspectExistingUnit } from './systemd-unit.mjs'
import { writeUnitAtomic } from './managed-unit-write.mjs'

const PARTIAL_MARKER = 'partial-install.json'

export function partialInstallPath(root) {
  return join(root, PARTIAL_MARKER)
}

/** Present + readable, present + unreadable, or absent. Never creates the root. */
async function capturePrivate(path, root) {
  try {
    if (!(await lstat(path)).isFile()) return { exists: true, readable: false, data: null }
  } catch (err) {
    if (err.code === 'ENOENT') return { exists: false, readable: true, data: null }
    return { exists: true, readable: false, data: null }
  }
  try {
    return { exists: true, readable: true, data: await readPrivateJson(path, { root }) }
  } catch {
    return { exists: true, readable: false, data: null }
  }
}

export async function capturePriorManagedState({ root, unitState, unitText }) {
  return {
    unitState,
    unitText: unitText ?? null,
    config: await capturePrivate(serviceConfigPath(root), root),
    receipt: await capturePrivate(installReceiptPath(root), root)
  }
}

/** Restore a prior private file, or remove the one this attempt created. */
async function restorePrivate(path, entry, root) {
  if (!entry.exists) {
    await rm(path, { force: true })
    return
  }
  if (!entry.readable || entry.data === null) throw new Error(`prior ${path} is unreadable, cannot restore`)
  await writePrivateFile(path, entry.data, { root })
}

/**
 * Best-effort, bounded. Returns `{ complete, failures }`: `complete === false`
 * means a rollback step failed (or the owned unit was not safely stopped) and the
 * caller must record a partial-install marker rather than pretend it was clean.
 *
 * `created` says which files THIS attempt actually wrote. `unitText` is the exact
 * unit text this attempt wrote, so a revalidation can confirm the on-disk unit is
 * still ours before we stop or remove it.
 */
export async function rollbackFirstInstall({ root, unitPath, prior, created, unitText, systemctl, env, bus }) {
  const failures = []
  const attempt = async (label, fn) => {
    try {
      await fn()
    } catch (err) {
      failures.push(`${label}: ${err?.message ?? String(err)}`.slice(0, 300))
    }
  }
  // A systemctl call is a FAILURE when it RETURNS a nonzero code, not only when
  // it throws: the production `defaultSystemctl` reports `{code}` instead of
  // throwing with `allowFailure: true`. Ignoring the code silently "succeeded" a
  // refused stop.
  const control = async (label, args) => {
    try {
      const result = await systemctl({ args, env, bus, allowFailure: true })
      if (result?.code) {
        failures.push(`${label} failed (exit ${result.code}): ${String(result.stderr ?? '').slice(0, 200)}`)
        return false
      }
      return true
    } catch (err) {
      failures.push(`${label}: ${err?.message ?? String(err)}`.slice(0, 300))
      return false
    }
  }
  const restore = async () => {
    if (created.config) {
      await attempt('restore managed service config', () => restorePrivate(serviceConfigPath(root), prior.config, root))
    }
    if (created.receipt) {
      await attempt('restore install receipt', () => restorePrivate(installReceiptPath(root), prior.receipt, root))
    }
  }

  if (!created.unit) {
    // The unit was never written; only the config and/or receipt could exist.
    await restore()
    return { complete: failures.length === 0, failures }
  }

  // Revalidate that the on-disk unit is still the exact one this attempt wrote.
  let ownUnit = false
  try {
    const current = await inspectExistingUnit({ unitPath })
    ownUnit = current.state === 'managed' && (unitText === undefined || current.text === unitText)
  } catch {
    ownUnit = false
  }
  if (!ownUnit) {
    // A foreign unit replaced ours: keep it, restore/remove only what we wrote.
    await restore()
    failures.push('the on-disk unit is no longer the MSO-owned unit this attempt wrote; left untouched')
    return { complete: false, failures }
  }

  if (prior.unitState === 'absent') {
    if (!(await control('stop created unit', ['disable', '--now', SERVICE_NAME]))) {
      // The owned unit may still be running. Keep the unit AND its config as
      // evidence and let the partial marker force an explicit clean-up: removing
      // a unit while its server may still be running is worse than a marked
      // leftover.
      return { complete: false, failures }
    }
    await restore()
    await attempt('remove created unit', () => rm(unitPath, { force: true }))
    await control('reload after remove', ['daemon-reload'])
    return { complete: failures.length === 0, failures }
  }

  // prior.unitState === 'managed': we replaced an already-owned unit.
  await restore()
  await attempt('restore unit', () => writeUnitAtomic(unitPath, prior.unitText))
  await control('reload restored unit', ['daemon-reload'])
  return { complete: failures.length === 0, failures }
}

export async function writePartialInstall(root, { reason, failures, now }) {
  await writePrivateFile(
    partialInstallPath(root),
    {
      schemaVersion: 1,
      applicationId: MANAGED_APP_ID,
      reason: String(reason ?? 'install failed').slice(0, 300),
      failures,
      failedAt: now()
    },
    { root }
  )
}

/** An unreadable marker still counts as present: refuse rather than guess. */
export async function readPartialInstall(root) {
  const path = partialInstallPath(root)
  const info = await lstat(path).catch((err) => {
    if (err.code === 'ENOENT') return null
    throw err
  })
  if (!info) return null
  const data = await readPrivateJson(path, { root }).catch(() => null)
  return data ?? { reason: 'partial-install marker is unreadable' }
}

/** Throw a clear, named refusal when a prior attempt left a partial state. */
export async function assertNoPartialInstall(root) {
  const partial = await readPartialInstall(root)
  if (!partial) return
  throw new Error(
    `a previous Orca install left a partial state (${partial.reason}); inspect and remove ` +
      `${partialInstallPath(root)} before rerunning`
  )
}
