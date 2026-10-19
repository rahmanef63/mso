/**
 * Persistent supervised Orca run. Stays alive until SIGINT/SIGTERM, then stops
 * only the verified owned server and deliberately preserves the terminal daemon
 * so user sessions survive a wrapper restart. Never prints pairing material.
 */

import { join } from 'node:path'
import { DEFAULT_BIND, DEFAULT_PORT } from './constants.mjs'
import { createIsolatedEnv } from './env.mjs'
import { launchOrcadServer } from './lifecycle.mjs'
import { sanitizeEndpoint } from './launcher.mjs'

const LOOPBACK_HOSTS = new Set(['localhost', '::1', '[::1]', '0.0.0.0', '[::]', '::'])

export function assertConfiguredAdvertisedEndpoint(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('run requires --advertised-endpoint (configured wss URL)')
  }
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`advertised endpoint is not a valid URL: ${value}`)
  }
  if (url.protocol !== 'wss:') throw new Error('advertised endpoint must use wss://')
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('advertised endpoint must not contain credentials, query, or fragment')
  }
  if (LOOPBACK_HOSTS.has(url.hostname) || /^127\./.test(url.hostname)) {
    throw new Error('advertised endpoint must not be loopback for a persistent run')
  }
  const normalized = sanitizeEndpoint(value)
  if (!normalized) throw new Error('advertised endpoint is malformed')
  return normalized
}

export function assertPersistentPort(port) {
  const value = Number(port)
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`run requires a fixed port 1-65535, got: ${port}`)
  }
  return value
}

export async function runSupervisedRuntime({
  release,
  managedRoot,
  port = DEFAULT_PORT,
  bind = DEFAULT_BIND,
  advertisedEndpoint,
  timeoutMs = 30000,
  log = console
} = {}) {
  if (!release?.slotDir || !release?.nodeBinary || !release?.webDir) {
    throw new Error('runSupervisedRuntime requires a prepared release')
  }
  const fixedPort = assertPersistentPort(port)
  const advertised = assertConfiguredAdvertisedEndpoint(advertisedEndpoint)
  const env = createIsolatedEnv({ scratchDir: managedRoot })
  const instance = await launchOrcadServer({
    nodeBinary: release.nodeBinary,
    slotDir: release.slotDir,
    options: {
      bind,
      port: fixedPort,
      webClientRoot: release.webDir,
      advertisedEndpoint: advertised,
      pairingAddress: advertised
    },
    env,
    managedRoot,
    timeoutMs,
    privateStatusPath: join(managedRoot, 'private-status.json'),
    runtimeIdentityPath: join(managedRoot, 'runtime-identity.json')
  })

  let resolveSignal
  const signaled = new Promise((resolve) => {
    resolveSignal = resolve
  })
  const handlers = new Map(
    ['SIGINT', 'SIGTERM'].map((signal) => {
      const handler = () => resolveSignal(signal)
      process.once(signal, handler)
      return [signal, handler]
    })
  )

  log.log(
    `[orca-cli] Runtime ready: ${instance.redacted.boundEndpoint} (advertised ${instance.redacted.advertisedEndpoint})`
  )
  log.log(`[orca-cli] Safe metadata: ${JSON.stringify(instance.redacted)}`)

  let stopResult = null
  try {
    const signal = await signaled
    log.log(`[orca-cli] Received ${signal}; stopping server (daemon preserved)...`)
    stopResult = await instance.stop({ cleanDaemon: false })
    log.log('[orca-cli] Server stopped; terminal daemon left running for session continuity.')
    return { signal, stop: stopResult, redacted: instance.redacted }
  } finally {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler)
    if (!stopResult) await instance.stop({ cleanDaemon: false }).catch(() => {})
  }
}
