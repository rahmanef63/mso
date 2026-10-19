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
import { readOwnedUnitFile } from './unit-read.mjs'

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
 * A unit may be replaced only when this adapter's exact identity is present and,
 * when expectedUnit or expectedConfig is provided, matches byte-for-byte.
 * Extraneous directives, foreign ExecStart, ExecStartPre/Post hooks, and
 * wrapper scripts are rejected.
 */
export function isManagedOrcaUnit(text, expectedUnit = null) {
  if (typeof text !== 'string') return false
  if (typeof expectedUnit === 'string') {
    return text === expectedUnit
  }
  if (expectedUnit && typeof expectedUnit === 'object') {
    return text === renderOrcaServiceUnit(expectedUnit)
  }
  if (!text.startsWith(`${UNIT_IDENTITY_MARKER}\n`)) return false
  if (/^ExecStart(?:Pre|Post)=/m.test(text)) return false
  if (/^EnvironmentFile=/m.test(text)) return false

  const execLine = text.match(/^ExecStart=(.+)$/m)
  if (!execLine) return false
  const exec = execLine[1]

  if (!exec.includes('--managed-root')) return false

  const validExec = /^("?(?:[^"\\]|\\.)*node"?) ("?(?:[^"\\]|\\.)*\/scripts\/orca\/cli\.mjs"?) "run"/m.test(exec)
  if (!validExec) return false

  return true
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
  expectedUnit,
  expectedConfig,
  read,
  uid = typeof process.getuid === 'function' ? process.getuid() : null
} = {}) {
  assertAbsoluteClean(unitPath, 'unit path')
  await assertNoSymlinkUnitPath(unitPath)

  let targetExpected = expectedUnit
  if (!targetExpected && expectedConfig) {
    targetExpected = renderOrcaServiceUnit(expectedConfig)
  }

  try {
    let text
    if (typeof read === 'function') {
      const info = await lstat(unitPath)
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error(`refusing a non-regular unit: ${unitPath}`)
      }
      if (uid !== null && info.uid !== uid) {
        throw new Error(`refusing a unit not owned by this user: ${unitPath}`)
      }
      text = await read(unitPath)
    } else {
      text = await readOwnedUnitFile(unitPath, uid)
      if (text === null) return { state: 'absent', text: null }
    }

    if (!isManagedOrcaUnit(text, targetExpected)) {
      throw new Error(`refusing to overwrite an existing foreign unit: ${unitPath}`)
    }
    return { state: 'managed', text }
  } catch (err) {
    if (err?.code === 'ENOENT') return { state: 'absent', text: null }
    throw err
  }
}
