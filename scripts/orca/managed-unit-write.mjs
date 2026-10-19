/**
 * Filesystem and systemd writes for the managed Orca install, plus the
 * readiness wait. Kept separate from the install sequence so the atomic unit
 * write, the fixed systemctl argv and the bounded poll each stay reviewable.
 */

import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import { redactSensitiveText } from './bounded-proc.mjs'
import { SERVICE_NAME } from './managed-paths.mjs'
import { inspectExistingUnit } from './systemd-unit.mjs'

const execFileAsync = promisify(execFile)

export async function writeUnitAtomic(unitPath, text, { inspect = inspectExistingUnit } = {}) {
  await mkdir(dirname(unitPath), { recursive: true, mode: 0o700 })
  const tmp = `${unitPath}.tmp-${process.pid}-${randomUUID()}`
  try {
    await writeFile(tmp, text, { mode: 0o644, flag: 'wx' })
    // Re-run the ownership guard immediately before publishing: a foreign unit
    // that appeared while we staged must never be clobbered by the rename.
    await inspect({ unitPath })
    await rename(tmp, unitPath)
    // Explicit: the unit is generated, contains no secret, and a restrictive
    // shell umask must not make its mode environment-dependent.
    await chmod(unitPath, 0o644)
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {})
    throw err
  }
  return unitPath
}

export async function defaultSystemctl({ args, env, bus }) {
  try {
    const result = await execFileAsync('systemctl', ['--user', ...args], {
      timeout: 30_000,
      maxBuffer: 64 * 1024,
      env: bus ? { ...env, ...bus } : env
    })
    return { stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') }
  } catch (err) {
    const detail = redactSensitiveText(String(err?.stderr || err?.stdout || err?.message || 'systemctl failed'))
    throw new Error(`systemctl --user ${args.join(' ')} failed: ${detail.slice(0, 300)}`)
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Poll the identity-verified status and the static web bundle until both answer. */
export async function waitForReady({
  root,
  port,
  advertisedEndpoint,
  timeoutMs,
  pollMs,
  readStatus,
  probeWeb,
  wait
}) {
  const deadline = Date.now() + timeoutMs
  let lastReason = 'not_checked'
  for (;;) {
    const status = await readStatus({ managedRoot: root, expectedPort: port, expectedAdvertisedEndpoint: advertisedEndpoint })
    if (status.available) {
      const web = await probeWeb({ port })
      if (web.available) return status
      lastReason = web.reason
    } else {
      lastReason = status.reason
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Orca did not become ready within ${Math.round(timeoutMs / 1000)}s (${lastReason}). ` +
          `Check journalctl --user -u ${SERVICE_NAME} --no-pager.`
      )
    }
    await wait(pollMs)
  }
}
