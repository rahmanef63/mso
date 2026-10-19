/**
 * Persistent supervised Orca run. Signal handlers exist before spawn, startup
 * abort cancels the launch through AbortSignal, and an unexpected child exit
 * fails the wrapper instead of leaving it alive. Never prints pairing material.
 */

import { join } from 'node:path'
import { DEFAULT_BIND, DEFAULT_PORT } from './constants.mjs'
import { createIsolatedEnv } from './env.mjs'
import { launchOrcadServer } from './lifecycle.mjs'
import { sanitizeEndpoint } from './launcher.mjs'
import { redactSensitiveText } from './bounded-proc.mjs'

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
  log = console,
  launch = launchOrcadServer
} = {}) {
  if (!release?.slotDir || !release?.nodeBinary || !release?.webDir) {
    throw new Error('runSupervisedRuntime requires a prepared release')
  }
  const fixedPort = assertPersistentPort(port)
  const advertised = assertConfiguredAdvertisedEndpoint(advertisedEndpoint)
  const env = createIsolatedEnv({ scratchDir: managedRoot })

  let phase = 'starting'
  let startupSignal = null
  let resolveSignal
  const signaled = new Promise((resolve) => {
    resolveSignal = resolve
  })
  const abortController = new AbortController()
  const handlers = new Map(
    ['SIGINT', 'SIGTERM'].map((signal) => {
      const handler = () => {
        if (phase === 'starting') {
          if (!startupSignal) {
            startupSignal = signal
            abortController.abort(new Error(`startup cancelled by ${signal}`))
          }
          return
        }
        resolveSignal(signal)
      }
      process.once(signal, handler)
      return [signal, handler]
    })
  )

  let instance = null
  let stopCompleted = false
  try {
    try {
      instance = await launch({
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
        signal: abortController.signal,
        privateStatusPath: join(managedRoot, 'private-status.json'),
        runtimeIdentityPath: join(managedRoot, 'runtime-identity.json')
      })
    } catch (err) {
      if (startupSignal) {
        throw new Error(`supervised startup cancelled by ${startupSignal}: ${redactSensitiveText(err.message)}`)
      }
      throw err
    }
    if (startupSignal) {
      // Readiness can win the race against the abort listener; never leave a
      // successfully launched runtime running after a startup signal.
      await instance.stop({ cleanDaemon: true })
      stopCompleted = true
      throw new Error(`supervised startup cancelled by ${startupSignal}`)
    }
    phase = 'running'
    log.log(
      `[orca-cli] Runtime ready: ${instance.redacted.boundEndpoint} (advertised ${instance.redacted.advertisedEndpoint})`
    )
    log.log(`[orca-cli] Safe metadata: ${JSON.stringify(instance.redacted)}`)

    const outcome = await Promise.race([
      signaled.then((signal) => ({ kind: 'signal', signal })),
      instance.childExit.then((exit) => ({ kind: 'exit', exit }))
    ])
    const childExited = instance.child.exitCode !== null || instance.child.signalCode !== null
    if (outcome.kind === 'exit' || (outcome.kind === 'signal' && childExited)) {
      const exit = outcome.kind === 'exit' ? outcome.exit : { code: instance.child.exitCode, signal: instance.child.signalCode }
      let cleanup = null
      let cleanupError = null
      try {
        cleanup = await instance.stop({ cleanDaemon: false })
        stopCompleted = true
      } catch (err) {
        cleanupError = err
      }
      const detail = `orcad-server exited unexpectedly (code ${exit.code}, signal ${exit.signal})`
      if (cleanupError) {
        throw new Error(`${detail}; cleanup failed: ${redactSensitiveText(cleanupError.message)}`)
      }
      throw new Error(
        `${detail}; receipts cleared=${Boolean(cleanup?.receiptsCleared)}; daemon preserved=${cleanup?.daemonPreserved}`
      )
    }

    const signal = outcome.signal
    log.log(`[orca-cli] Received ${signal}; stopping server...`)
    const stopResult = await instance.stop({ cleanDaemon: false })
    stopCompleted = true
    if (stopResult.daemonPreserved === true) {
      log.log('[orca-cli] Server stopped; verified terminal daemon is still running.')
    } else if (stopResult.daemonPreserved === false) {
      log.log('[orca-cli] Server stopped; terminal daemon is not running.')
    } else {
      log.log('[orca-cli] Server stopped; terminal daemon state is unknown (not promising persistence).')
    }
    return { signal, stop: stopResult, redacted: instance.redacted }
  } finally {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler)
    if (instance && !stopCompleted) await instance.stop({ cleanDaemon: false }).catch(() => {})
  }
}
