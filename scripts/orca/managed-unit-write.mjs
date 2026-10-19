/**
 * Filesystem and systemd writes for the managed Orca install, plus the
 * readiness wait. Kept separate from the install sequence so the atomic unit
 * write, the fixed systemctl argv and the bounded poll each stay reviewable.
 */

import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmod, link, mkdir, rename, rm, writeFile } from 'node:fs/promises'
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
    // that appeared while we staged must never be clobbered. `inspect` throws on
    // a foreign/non-regular/other-owner unit and returns 'absent' when nothing
    // is there yet.
    const existing = await inspect({ unitPath })
    if (existing.state === 'managed') {
      // Same-owner replacement of a unit we generated. `rename` is atomic; the
      // last-instant window between `inspect` and `rename` is inherent at equal
      // privilege (same-UID installers can always race), so it is documented
      // here rather than hidden.
      await rename(tmp, unitPath)
    } else {
      // Absent: publish exclusively. `link` fails with EEXIST instead of
      // overwriting a foreign unit created in the last instant, so the race
      // cannot silently replace someone else's unit. The temp inode is unlinked.
      try {
        await link(tmp, unitPath)
      } catch (err) {
        if (err?.code === 'EEXIST') {
          throw new Error(`refusing to overwrite a unit that appeared during install: ${unitPath}`)
        }
        throw err
      }
      await rm(tmp, { force: true })
    }
    // Explicit: the unit is generated, contains no secret, and a restrictive
    // shell umask must not make its mode environment-dependent.
    await chmod(unitPath, 0o644)
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {})
    throw err
  }
  return unitPath
}

export async function defaultSystemctl({ args, env, bus, allowFailure = false }) {
  try {
    const result = await execFileAsync('systemctl', ['--user', ...args], {
      timeout: 30_000,
      maxBuffer: 64 * 1024,
      env: bus ? { ...env, ...bus } : env
    })
    return { code: 0, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') }
  } catch (err) {
    const detail = redactSensitiveText(String(err?.stderr || err?.stdout || err?.message || 'systemctl failed'))
    // Rollback calls are best-effort: report the failure instead of throwing so
    // the caller can record it and still restore the rest of the prior state.
    if (allowFailure) return { code: 1, stdout: '', stderr: detail.slice(0, 300) }
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
