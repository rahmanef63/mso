/**
 * Deterministic systemd user-unit rendering for the MSO-owned Orca runtime.
 *
 * The unit is generated only from validated, code-owned values. It never
 * contains a pairing token, a request value, or free-form environment, and it
 * always names this repository's CLI entry point rather than a mutable path.
 *
 * `KillMode=process` owns only the main dispatcher process. The Orca CLI's
 * terminal daemon is a separate, verified MSO-owned process whose lifetime this
 * unit does not guarantee; stopping or restarting the unit must not be
 * presented as preserving terminal sessions. Orphaned daemons are not claimed
 * to be safe, and this file promises no persistence.
 */

import { lstat, readFile } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import { DEFAULT_PORT } from './constants.mjs'
import { SERVICE_NAME, UNIT_IDENTITY_MARKER } from './managed-paths.mjs'
import { assertConfiguredAdvertisedEndpoint, assertPersistentPort } from './supervision.mjs'
import { renderUnitText, systemdQuote } from './unit-render.mjs'

export { systemdQuote }

const CONTROL = /[\0\r\n]/

function assertCleanString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`)
  if (CONTROL.test(value)) throw new Error(`${label} must not contain control characters`)
  return value
}

function assertAbsoluteClean(value, label) {
  assertCleanString(value, label)
  if (!isAbsolute(value)) throw new Error(`${label} must be an absolute path, got: ${value}`)
  return value
}

/**
 * Render the one fixed user unit. All values are validated here; the exact
 * bytes come from the pure shared renderer used by the ownership proof too.
 */
export function renderOrcaServiceUnit({
  hostNode,
  cliScript,
  managedRoot,
  port = DEFAULT_PORT,
  advertisedEndpoint,
  identityMarker = UNIT_IDENTITY_MARKER,
  serviceName = SERVICE_NAME
} = {}) {
  const node = assertAbsoluteClean(hostNode, 'host node binary')
  const cli = assertAbsoluteClean(cliScript, 'Orca CLI script')
  const root = assertAbsoluteClean(managedRoot, 'managed root')
  const fixedPort = assertPersistentPort(port)
  const advertised = assertConfiguredAdvertisedEndpoint(advertisedEndpoint)
  const marker = assertCleanString(identityMarker, 'unit identity marker')

  return renderUnitText({
    marker,
    serviceName,
    hostNode: node,
    cliScript: cli,
    managedRoot: root,
    port: fixedPort,
    advertisedEndpoint: advertised
  })
}

/**
 * A unit may be replaced only when this adapter's exact identity is present.
 */
export function isManagedOrcaUnit(text) {
  if (typeof text !== 'string') return false
  const lines = text.split(/\r?\n/)
  return (
    lines.includes(UNIT_IDENTITY_MARKER) &&
    /^ExecStart=.*\/scripts\/orca\/cli\.mjs(?:["\s])/m.test(text) &&
    /--managed-root/.test(text)
  )
}

/**
 * Refuse a symlinked unit or a symlinked ancestor before reading or writing: a
 * symlink could redirect the write into the operator's own Orca state.
 *
 * EVERY ancestor from the unit up to the filesystem root is inspected, including
 * components above the nearest existing directory. Stopping at the first path
 * that exists (as an earlier version did) accepted an existing regular unit, or a
 * missing leaf, reached through a symlinked parent. `lstat` never follows a link
 * and never opens or reads the target, so a FIFO ancestor cannot block.
 */
async function assertNoSymlinkUnitPath(unitPath) {
  let current = unitPath
  for (;;) {
    const info = await lstat(current).catch((err) => {
      if (err.code === 'ENOENT') return null
      throw err
    })
    if (info?.isSymbolicLink()) throw new Error(`refusing a symlinked unit path: ${current}`)
    const parent = dirname(current)
    if (parent === current) return
    current = parent
  }
}

/**
 * Fail closed on a pre-existing unit we did not generate. Returns 'absent' or
 * 'managed'; a foreign unit is an error before any download or service action.
 * Rejects symlinked paths and non-regular/foreign files instead of trusting the
 * marker alone.
 */
export async function inspectExistingUnit({
  unitPath,
  read = (path) => readFile(path, 'utf8'),
  uid = typeof process.getuid === 'function' ? process.getuid() : null
} = {}) {
  assertAbsoluteClean(unitPath, 'unit path')
  await assertNoSymlinkUnitPath(unitPath)
  try {
    const info = await lstat(unitPath)
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(`refusing a non-regular unit: ${unitPath}`)
    }
    if (uid !== null && info.uid !== uid) {
      throw new Error(`refusing a unit not owned by this user: ${unitPath}`)
    }
    const text = await read(unitPath)
    if (!isManagedOrcaUnit(text)) {
      throw new Error(`refusing to overwrite an existing foreign unit: ${unitPath}`)
    }
    return { state: 'managed', text }
  } catch (err) {
    if (err?.code === 'ENOENT') return { state: 'absent', text: null }
    throw err
  }
}
