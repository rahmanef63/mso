/**
 * Safe, non-secret view of an installed MSO-owned Orca runtime.
 *
 * This is the install-time readiness gate and the `status`/`--version` source.
 * It reads only private receipts, validates them against the live kernel
 * process identity, and never returns a pairing URL or token. A static HTTP 200
 * is deliberately not accepted as health.
 */

import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, relative } from 'node:path'
import { join } from 'node:path'
import { ORCA_VERSION, DEFAULT_PORT } from './constants.mjs'
import { readProcessIdentity } from './proc-identity.mjs'
import { readPrivateJson } from './private-store.mjs'
import { resolveManagedRoot } from './managed-paths.mjs'
import { sanitizeEndpoint } from './launcher.mjs'

const WEB_TITLE = '<title>Orca Web</title>'
const RUNTIME_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/

const unavailable = (reason) => ({ available: false, reason })

function isInside(root, candidate) {
  if (typeof candidate !== 'string' || !isAbsolute(candidate)) return false
  const rel = relative(root, candidate)
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel)
}

function expectedBoundEndpoint({ bind = '127.0.0.1', port = DEFAULT_PORT } = {}) {
  return `ws://${bind}:${port}`
}

function parseHttpPort(boundEndpoint) {
  try {
    const url = new URL(boundEndpoint)
    return url.protocol === 'ws:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
      ? Number(url.port)
      : null
  } catch {
    return null
  }
}

/**
 * @returns `{available:true, ...safe fields}` or `{available:false, reason}`.
 *          No pairing material is ever part of a successful result.
 */
export async function readManagedOrcaStatus({
  managedRoot = resolveManagedRoot(),
  expectedPort = DEFAULT_PORT,
  expectedAdvertisedEndpoint,
  readIdentity = readProcessIdentity,
  uid = typeof process.getuid === 'function' ? process.getuid() : null
} = {}) {
  const root = managedRoot
  const statusPath = join(root, 'private-status.json')
  const identityPath = join(root, 'runtime-identity.json')
  for (const path of [statusPath, identityPath]) {
    try {
      // `readPrivateJson` reports a missing file without an error code, so
      // classify presence explicitly: absent receipts are "missing", while a
      // present-but-rejected pair is "unreadable". No error-string parsing.
      await lstat(path)
    } catch (err) {
      return unavailable(err?.code === 'ENOENT' ? 'receipts_missing' : 'receipts_unreadable')
    }
  }
  let status
  let identity
  try {
    status = await readPrivateJson(statusPath, { root })
    identity = await readPrivateJson(identityPath, { root })
  } catch {
    return unavailable('receipts_unreadable')
  }

  if (!status || status.type !== 'orca_server_ready' || status.schemaVersion !== 1) {
    return unavailable('invalid_readiness_schema')
  }
  if (status.health?.buildVersion !== ORCA_VERSION) return unavailable('incompatible_version')
  if (typeof status.runtimeId !== 'string' || !RUNTIME_ID_RE.test(status.runtimeId)) {
    return unavailable('invalid_runtime_id')
  }
  if (status.boundEndpoint !== expectedBoundEndpoint({ port: expectedPort })) {
    return unavailable('unexpected_bound_endpoint')
  }
  if (typeof status.advertisedEndpoint !== 'string' || sanitizeEndpoint(status.advertisedEndpoint) !== status.advertisedEndpoint) {
    return unavailable('invalid_advertised_endpoint')
  }
  if (expectedAdvertisedEndpoint && status.advertisedEndpoint !== sanitizeEndpoint(expectedAdvertisedEndpoint)) {
    return unavailable('advertised_endpoint_mismatch')
  }
  if (status.pairing?.available !== true || status.pairing?.scope !== 'runtime' || typeof status.pairing?.url !== 'string') {
    return unavailable('pairing_unavailable')
  }

  const daemon = status.health?.terminalDaemon
  if (
    daemon?.state !== 'live' ||
    daemon?.ownsFreshSessions !== true ||
    daemon?.selfTest?.ok !== true ||
    !Number.isInteger(daemon?.pid) ||
    daemon.pid <= 1 ||
    typeof daemon?.entryPath !== 'string' ||
    !isAbsolute(daemon.entryPath)
  ) {
    return unavailable('terminal_daemon_unhealthy')
  }

  if (
    !identity ||
    identity.schemaVersion !== 1 ||
    identity.version !== ORCA_VERSION ||
    identity.runtimeId !== status.runtimeId ||
    !Number.isInteger(identity.serverPid) ||
    identity.serverPid <= 1
  ) {
    return unavailable('invalid_runtime_identity')
  }
  for (const [label, value] of [
    ['nodeBinary', identity.nodeBinary],
    ['serverEntry', identity.serverEntry],
    ['userData', identity.userData]
  ]) {
    if (!isInside(root, value)) return unavailable(`runtime_identity_${label}_outside_root`)
  }
  if (identity.boundEndpoint !== status.boundEndpoint) return unavailable('runtime_identity_bound_mismatch')
  if (identity.advertisedEndpoint !== status.advertisedEndpoint) {
    return unavailable('runtime_identity_advertised_mismatch')
  }

  const server = await readIdentity(identity.serverPid)
  if (!server) return unavailable('server_process_dead')
  if (String(server.startTicks) !== String(identity.serverStartTicks)) return unavailable('server_process_reused')
  if (uid !== null && server.uid !== uid) return unavailable('server_process_foreign')
  const expectedExe = await realpath(identity.nodeBinary).catch(() => identity.nodeBinary)
  if (server.exe !== expectedExe) return unavailable('server_executable_mismatch')
  if (!server.argv.includes(identity.serverEntry)) return unavailable('server_entry_mismatch')
  if (status.health?.pid !== identity.serverPid) return unavailable('health_pid_mismatch')

  const daemonIdentity = await readIdentity(daemon.pid)
  if (!daemonIdentity) return unavailable('terminal_daemon_dead')
  if (uid !== null && daemonIdentity.uid !== uid) return unavailable('terminal_daemon_foreign')
  if (!daemonIdentity.argv.includes(daemon.entryPath)) return unavailable('terminal_daemon_entry_mismatch')

  const boundPort = parseHttpPort(status.boundEndpoint)
  if (!Number.isInteger(boundPort) || boundPort !== expectedPort) return unavailable('unexpected_bound_port')

  return {
    available: true,
    version: status.health.buildVersion,
    runtimeId: status.runtimeId,
    boundEndpoint: status.boundEndpoint,
    advertisedEndpoint: status.advertisedEndpoint,
    serverPid: identity.serverPid,
    daemonPid: daemon.pid,
    readyAt: typeof identity.readyAt === 'string' ? identity.readyAt : null
  }
}

/** Static web proof is separate from identity health; both are required to call an install successful. */
export async function probeOrcaWebClient({ port = DEFAULT_PORT, timeoutMs = 5000, fetchImpl = fetch } = {}) {
  const url = `http://127.0.0.1:${port}/web-index.html`
  try {
    const response = await fetchImpl(url, {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs)
    })
    const body = await response.text()
    if (!response.ok || !body.includes(WEB_TITLE)) return { available: false, reason: 'web_client_unhealthy' }
    return { available: true, url, status: response.status }
  } catch {
    return { available: false, reason: 'web_client_unreachable' }
  }
}
