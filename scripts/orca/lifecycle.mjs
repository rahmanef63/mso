/**
 * Supervised Orca server lifecycle: spawn, bounded readiness, verified owned
 * child/daemon identities, atomic receipts, and explicitly-verified teardown.
 * Signal policy: smoke cleans the task-owned daemon; a persistent run preserves it.
 */

import { spawn } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  createRuntimeIdentity,
  redactServerReadiness,
  sanitizeEndpoint,
  validateLauncherArgs,
  validateServerReadiness
} from './launcher.mjs'
import { createRollingTextSink } from './bounded-stream.mjs'
import { terminateVerifiedProcess, waitForProcessIdentity } from './proc-identity.mjs'
import { redactSensitiveText } from './bounded-proc.mjs'
import { discoverOwnedDaemon, verifyDaemon } from './daemon-identity.mjs'
import { waitForReadiness } from './readiness-wait.mjs'
import { writePrivateFile } from './private-store.mjs'

export async function launchOrcadServer({
  nodeBinary,
  slotDir,
  serverEntry,
  options = {},
  env,
  managedRoot,
  timeoutMs = 30000,
  privateStatusPath,
  runtimeIdentityPath,
  daemonEntryPath
}) {
  validateLauncherArgs(options)
  if (!nodeBinary || !slotDir) throw new Error('nodeBinary and slotDir are required')
  if (!env?.ORCA_USER_DATA) throw new Error('isolated env with ORCA_USER_DATA is required')
  const bind = options.bind ?? '127.0.0.1'
  const port = options.port ?? 0
  const entry = resolve(serverEntry ?? join(slotDir, 'orcad-server.js'))
  const daemonEntry = resolve(daemonEntryPath ?? join(slotDir, 'daemon-entry.js'))
  const userData = env.ORCA_USER_DATA
  const args = [entry, '--bind', bind, '--port', String(port), '--json']
  if (options.webClientRoot) args.push('--web-client-root', options.webClientRoot)
  if (options.pairingAddress) args.push('--pairing-address', options.pairingAddress)

  const serverExe = await realpath(nodeBinary).catch(() => nodeBinary)
  const child = spawn(nodeBinary, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
  const stderrSink = createRollingTextSink(child.stderr)
  let stdoutReader = null
  let serverIdentity = null
  let daemonIdentity = null
  let stopped = false

  const cleanup = async () => {
    const failures = []
    stdoutReader?.detach()
    if (serverIdentity) {
      const result = await terminateVerifiedProcess(serverIdentity, { timeoutMs: 2000, killTimeoutMs: 3000 })
      if (!result.exited && !result.stale) failures.push(`server ${serverIdentity.pid} did not exit`)
    } else if (child.pid) {
      // Direct child of this process: this PID cannot be reused while we hold it.
      try { process.kill(child.pid, 'SIGKILL') } catch {}
      await new Promise((done) => {
        if (child.exitCode !== null || child.signalCode !== null) done()
        else child.once('exit', done)
      })
    }
    const daemon =
      daemonIdentity ?? (await discoverOwnedDaemon({ userData, nodeBinary: serverExe, daemonEntryPath: daemonEntry }))
    if (daemon) {
      daemonIdentity = daemon
      const result = await terminateVerifiedProcess(daemon, { timeoutMs: 2000, killTimeoutMs: 3000 })
      if (!result.exited && !result.stale) failures.push(`daemon ${daemon.pid} did not exit`)
    }
    return failures
  }

  try {
    const ready = await waitForReadiness({ child, timeoutMs, stderrSink })
    stdoutReader = ready.reader
    // Keep consuming stdout (discard) so a chatty server can never stall the pipe.
    stdoutReader.discard()
    const payload = ready.payload
    validateServerReadiness(payload, {
      expectedChildPid: child.pid,
      bind,
      port,
      advertisedEndpoint: options.advertisedEndpoint,
      allowLoopbackAdvertised: options.allowLoopbackAdvertised === true
    })

    serverIdentity = await waitForProcessIdentity(child.pid, {
      exe: serverExe,
      scriptPath: entry,
      uid: process.getuid()
    })
    if (!serverIdentity) throw new Error('server child identity could not be verified against procfs')

    daemonIdentity = await verifyDaemon(payload.health.terminalDaemon.pid, {
      nodeBinary: serverExe,
      daemonEntryPath: daemonEntry,
      userData
    })
    if (!daemonIdentity) throw new Error('daemon identity could not be verified against procfs')

    const identity = createRuntimeIdentity({
      readyPayload: payload,
      serverIdentity,
      nodeBinary: serverExe,
      serverEntry: entry,
      userData,
      boundEndpoint: payload.boundEndpoint ?? payload.endpoint,
      advertisedEndpoint: sanitizeEndpoint(payload.advertisedEndpoint) ?? payload.advertisedEndpoint
    })
    const root = managedRoot ?? env.ORCA_MANAGED_ROOT
    if (!root) throw new Error('managedRoot is required to publish private receipts')
    if (privateStatusPath) await writePrivateFile(privateStatusPath, payload, { root })
    if (runtimeIdentityPath) await writePrivateFile(runtimeIdentityPath, identity, { root })

    const stop = async ({ cleanDaemon = true, timeoutMs: stopTimeout = 5000 } = {}) => {
      if (stopped) return { exited: true, daemonExited: !cleanDaemon, forced: false }
      stopped = true
      const serverResult = await terminateVerifiedProcess(serverIdentity, {
        timeoutMs: stopTimeout,
        killTimeoutMs: 3000
      })
      if (!serverResult.exited && !serverResult.stale) {
        throw new Error(`stop failed: server ${serverIdentity.pid} is still alive`)
      }
      let daemonResult = { exited: false, stale: false, forced: false }
      if (cleanDaemon) {
        const daemon =
          daemonIdentity ??
          (await discoverOwnedDaemon({ userData, nodeBinary: serverExe, daemonEntryPath: daemonEntry }))
        if (daemon) {
          daemonIdentity = daemon
          daemonResult = await terminateVerifiedProcess(daemon, { timeoutMs: stopTimeout, killTimeoutMs: 3000 })
          if (!daemonResult.exited && !daemonResult.stale) {
            throw new Error(`stop failed: daemon ${daemon.pid} is still alive`)
          }
        }
      }
      return {
        exited: Boolean(serverResult.exited),
        daemonExited: Boolean(cleanDaemon && daemonResult.exited),
        forced: Boolean(serverResult.forced || daemonResult.forced)
      }
    }

    return {
      child,
      readyPayload: payload,
      redacted: redactServerReadiness(payload),
      identity,
      serverIdentity,
      daemonIdentity,
      stop
    }
  } catch (err) {
    const failures = await cleanup()
    const suffix = failures.length > 0 ? `; cleanup failures: ${failures.join(', ')}` : ''
    throw new Error(`${redactSensitiveText(err.message)}${suffix}`)
  } finally {
    stderrSink.detach()
    // Keep stdout flowing until the child exits; stop() detaches explicitly.
    if (child.exitCode !== null || child.signalCode !== null) child.stdout.resume()
  }
}
