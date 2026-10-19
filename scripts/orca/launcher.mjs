/**
 * Orca launcher validation, readiness contract, private receipt publication.
 * Process signalling lives in lifecycle.mjs and always uses proc-identity.mjs.
 */

import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { isIP } from 'node:net'
import { DEFAULT_BIND, DEFAULT_PORT, ORCA_VERSION, PINNED_NODE, WEB_CLIENT_INDEX_FILENAME } from './constants.mjs'

const EXPECTED_NODE_VERSION = PINNED_NODE.version
const EXPECTED_NODE_ABI = '137'
const RUNTIME_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/

export function validateLauncherArgs({ bind = DEFAULT_BIND, port = DEFAULT_PORT, webClientRoot } = {}) {
  if (!isIP(bind)) throw new Error(`bind host must be a valid IP address, got: ${bind}`)
  if (bind !== '127.0.0.1' && bind !== '::1' && !bind.startsWith('127.')) {
    throw new Error(`bind host must be a loopback address, got: ${bind}`)
  }
  const portNum = Number(port)
  if (typeof port === 'string' && !/^\d+$/.test(port)) throw new Error(`port must be an integer, got: ${port}`)
  if (!Number.isInteger(portNum) || portNum < 0 || portNum > 65535) {
    throw new Error(`port must be an integer 0-65535, got: ${port}`)
  }
  if (webClientRoot && !existsSync(join(webClientRoot, WEB_CLIENT_INDEX_FILENAME))) {
    throw new Error(`webClientRoot missing ${WEB_CLIENT_INDEX_FILENAME}`)
  }
}

export function sanitizeEndpoint(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null
  try {
    const url = new URL(value)
    if (url.username || url.password || url.search || url.hash) return null
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return null
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, '')}`
  } catch {
    return null
  }
}

function isLoopbackHost(hostname) {
  if (hostname === '::1' || hostname === '[::1]') return true
  return isIP(hostname) === 4 && hostname.startsWith('127.')
}

function parseWsEndpoint(value) {
  const clean = sanitizeEndpoint(value)
  if (!clean) return null
  const url = new URL(clean)
  return { url, protocol: url.protocol, hostname: url.hostname, port: Number(url.port || 0) }
}

export function validateServerReadiness(payload, {
  expectedChildPid,
  bind = DEFAULT_BIND,
  port = DEFAULT_PORT,
  advertisedEndpoint,
  allowLoopbackAdvertised = false
} = {}) {
  if (!payload || typeof payload !== 'object') throw new Error('Readiness payload is not an object')
  if (payload.type !== 'orca_server_ready' || payload.schemaVersion !== 1) {
    throw new Error(`Invalid readiness payload: ${payload.type} v${payload.schemaVersion}`)
  }
  if (typeof payload.runtimeId !== 'string' || !RUNTIME_ID_RE.test(payload.runtimeId)) {
    throw new Error('Readiness runtimeId is missing or malformed')
  }
  const health = payload.health
  if (!health || typeof health !== 'object') throw new Error('Readiness health block missing')
  if (health.buildVersion !== ORCA_VERSION) {
    throw new Error(`buildVersion mismatch: expected ${ORCA_VERSION}, got ${health.buildVersion}`)
  }
  if (health.nodeVersion !== EXPECTED_NODE_VERSION) {
    throw new Error(`nodeVersion mismatch: expected ${EXPECTED_NODE_VERSION}, got ${health.nodeVersion}`)
  }
  if (String(health.nodeAbi) !== EXPECTED_NODE_ABI) {
    throw new Error(`nodeAbi mismatch: expected ${EXPECTED_NODE_ABI}, got ${health.nodeAbi}`)
  }
  if (!Number.isInteger(expectedChildPid) || health.pid !== expectedChildPid) {
    throw new Error(`Health PID mismatch: expected child PID ${expectedChildPid}, got ${health.pid}`)
  }

  const bound = parseWsEndpoint(payload.boundEndpoint ?? payload.endpoint)
  if (!bound) throw new Error('bound endpoint is missing or malformed')
  if (bound.hostname !== bind) {
    throw new Error(`bound endpoint host mismatch: expected ${bind}, got ${bound.hostname}`)
  }
  if (bound.protocol !== 'ws:') throw new Error(`bound endpoint must be ws:// on loopback, got ${bound.protocol}`)
  const requestedPort = Number(port)
  if (requestedPort !== 0 && bound.port !== requestedPort) {
    throw new Error(`bound endpoint port mismatch: expected ${requestedPort}, got ${bound.port}`)
  }
  if (!Number.isInteger(bound.port) || bound.port < 1 || bound.port > 65535) {
    throw new Error(`bound endpoint port is invalid: ${bound.port}`)
  }

  const advertised = parseWsEndpoint(payload.advertisedEndpoint)
  if (!advertised) throw new Error('advertised endpoint is missing or malformed')
  const expectedAdvertised = advertisedEndpoint ? parseWsEndpoint(advertisedEndpoint) : null
  if (expectedAdvertised) {
    if (advertised.url.href !== expectedAdvertised.url.href) {
      throw new Error(`advertised endpoint mismatch: expected ${expectedAdvertised.url.href}, got ${advertised.url.href}`)
    }
  } else if (allowLoopbackAdvertised) {
    if (advertised.protocol !== 'ws:' && advertised.protocol !== 'wss:') {
      throw new Error(`advertised endpoint protocol unsupported: ${advertised.protocol}`)
    }
  } else if (advertised.protocol !== 'wss:' || isLoopbackHost(advertised.hostname)) {
    throw new Error('advertised endpoint must be the configured non-loopback wss URL')
  }

  const daemon = health.terminalDaemon
  if (!daemon || typeof daemon !== 'object') throw new Error('terminal daemon block missing')
  if (daemon.state !== 'live' || daemon.ownsFreshSessions !== true) {
    throw new Error(`terminal daemon is not live/owning sessions: ${daemon.state}`)
  }
  if (!Number.isInteger(daemon.pid) || daemon.pid <= 1) {
    throw new Error(`terminal daemon pid is invalid: ${daemon.pid}`)
  }
  if (typeof daemon.entryPath !== 'string' || !isAbsolute(daemon.entryPath)) {
    throw new Error('terminal daemon entryPath must be absolute')
  }
  if (!daemon.selfTest || daemon.selfTest.ok !== true) {
    throw new Error(`terminal daemon selfTest failed: ${daemon.selfTest?.verdict ?? 'missing'}`)
  }
}

export function redactServerReadiness(payload) {
  const health = payload?.health ?? {}
  const daemon = health.terminalDaemon ?? {}
  return {
    type: 'orca_server_ready',
    schemaVersion: 1,
    runtimeId: typeof payload?.runtimeId === 'string' ? payload.runtimeId : null,
    version: typeof health.buildVersion === 'string' ? health.buildVersion : null,
    nodeVersion: typeof health.nodeVersion === 'string' ? health.nodeVersion : null,
    nodeAbi: typeof health.nodeAbi === 'string' ? health.nodeAbi : null,
    boundEndpoint: sanitizeEndpoint(payload?.boundEndpoint ?? payload?.endpoint),
    advertisedEndpoint: sanitizeEndpoint(payload?.advertisedEndpoint),
    pairingAvailable: Boolean(payload?.pairing?.available),
    serverPid: Number.isInteger(health.pid) ? health.pid : null,
    daemonPid: Number.isInteger(daemon.pid) ? daemon.pid : null,
    healthState: typeof daemon.state === 'string' ? daemon.state : null,
    selfTestVerdict: typeof daemon.selfTest?.verdict === 'string' ? daemon.selfTest.verdict : null
  }
}

export function parseDaemonPid(raw) {
  if (!raw || typeof raw !== 'string') return null
  const num = Number(raw.trim())
  if (Number.isInteger(num) && num > 1) return num
  try {
    const parsed = JSON.parse(raw.trim())
    if (parsed && Number.isInteger(parsed.pid) && parsed.pid > 1) return parsed.pid
  } catch {}
  return null
}

export function createRuntimeIdentity({
  readyPayload,
  serverIdentity,
  nodeBinary,
  serverEntry,
  userData,
  boundEndpoint,
  advertisedEndpoint,
  readyAt = new Date().toISOString()
}) {
  if (!serverIdentity || !Number.isInteger(serverIdentity.pid) || !serverIdentity.startTicks) {
    throw new Error('createRuntimeIdentity requires a verified server identity (pid + startTicks)')
  }
  for (const [label, p] of [['nodeBinary', nodeBinary], ['serverEntry', serverEntry], ['userData', userData]]) {
    if (typeof p !== 'string' || !isAbsolute(p)) throw new Error(`${label} must be an absolute path`)
  }
  return {
    schemaVersion: 1,
    runtimeId: readyPayload.runtimeId,
    version: ORCA_VERSION,
    serverPid: serverIdentity.pid,
    serverStartTicks: String(serverIdentity.startTicks),
    nodeBinary,
    serverEntry,
    userData,
    boundEndpoint: sanitizeEndpoint(boundEndpoint) ?? boundEndpoint,
    advertisedEndpoint: sanitizeEndpoint(advertisedEndpoint) ?? advertisedEndpoint,
    readyAt
  }
}

export { ensureManagedRoot, writePrivateFile, readPrivateJson } from './private-store.mjs'
