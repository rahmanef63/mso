/**
 * Supervised Orca server lifecycle: spawn, bounded readiness, verified owned
 * child/daemon identities, transactional receipts, and retriable teardown.
 * Smoke cleans the task-owned daemon; a persistent run preserves it.
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
import { waitForProcessIdentity } from './proc-identity.mjs'
import { redactSensitiveText } from './bounded-proc.mjs'
import { waitForDaemon } from './daemon-identity.mjs'
import { waitForReadiness } from './readiness-wait.mjs'
import { publishPrivatePair, writePrivateFile } from './private-store.mjs'
import { createLifecycleTeardown } from './lifecycle-teardown.mjs'

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

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
  daemonEntryPath,
  signal,
  discoveryWaitMs
}) {
  validateLauncherArgs(options)
  if (!nodeBinary || !slotDir) throw new Error('nodeBinary and slotDir are required')
  if (!env?.ORCA_USER_DATA) throw new Error('isolated env with ORCA_USER_DATA is required')
  const root = managedRoot ?? env.ORCA_MANAGED_ROOT
  if (!root) throw new Error('managedRoot is required to publish private receipts')
  if (signal?.aborted) throw new Error('startup cancelled before spawn')
  const bind = options.bind ?? '127.0.0.1'
  const port = options.port ?? 0
  const entry = resolve(serverEntry ?? join(slotDir, 'orcad-server.js'))
  const daemonEntry = resolve(daemonEntryPath ?? join(slotDir, 'daemon-entry.js'))
  const userData = env.ORCA_USER_DATA
  const args = [entry, '--bind', bind, '--port', String(port), '--json']
  if (options.webClientRoot) args.push('--web-client-root', options.webClientRoot)
  if (options.pairingAddress) args.push('--pairing-address', options.pairingAddress)

  const serverExe = await realpath(nodeBinary).catch(() => nodeBinary)
  if (signal?.aborted) throw new Error('startup cancelled before spawn')
  const child = spawn(nodeBinary, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
  const childExit = new Promise((resolveExit) => {
    child.once('exit', (code, exitSignal) => resolveExit({ code, signal: exitSignal }))
  })
  const stderrSink = createRollingTextSink(child.stderr)
  const receiptPaths = []
  let stdoutReader = null
  let serverIdentity = null
  let daemonIdentity = null
  let expectedIdentity = () => false
  const teardown = createLifecycleTeardown({
    root,
    userData,
    nodeBinary: serverExe,
    daemonEntryPath: daemonEntry,
    discoveryWaitMs,
    getServerIdentity: () => serverIdentity,
    getReceiptPaths: () => receiptPaths,
    getExpectedIdentity: () => expectedIdentity
  })

  const cleanup = async () => {
    stdoutReader?.detach()
    if (!serverIdentity && child.pid && child.exitCode === null && child.signalCode === null) {
      // Only signal the tracked ChildProcess handle, never a raw reusable PID.
      try {
        child.kill('SIGKILL')
      } catch {}
      await Promise.race([childExit, delay(3000)])
    }
    return teardown.cleanup()
  }

  try {
    const ready = await waitForReadiness({ child, timeoutMs, stderrSink, signal })
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

    daemonIdentity = await waitForDaemon(payload.health.terminalDaemon.pid, {
      nodeBinary: serverExe,
      daemonEntryPath: daemonEntry,
      userData
    })
    if (!daemonIdentity) throw new Error('daemon identity could not be verified against procfs')
    teardown.setDaemonIdentity(daemonIdentity)

    const identity = createRuntimeIdentity({
      readyPayload: payload,
      serverIdentity,
      nodeBinary: serverExe,
      serverEntry: entry,
      userData,
      boundEndpoint: payload.boundEndpoint ?? payload.endpoint,
      advertisedEndpoint: sanitizeEndpoint(payload.advertisedEndpoint) ?? payload.advertisedEndpoint
    })
    const entries = []
    if (privateStatusPath) {
      receiptPaths.push(privateStatusPath)
      entries.push({ path: privateStatusPath, data: payload })
    }
    if (runtimeIdentityPath) {
      receiptPaths.push(runtimeIdentityPath)
      entries.push({ path: runtimeIdentityPath, data: identity })
    }
    if (entries.length === 1) await writePrivateFile(entries[0].path, entries[0].data, { root })
    else if (entries.length > 1) await publishPrivatePair({ root, entries })

    expectedIdentity = (receipt) => {
      if (receipt?.runtimeId !== payload.runtimeId) return false
      if (receipt.serverStartTicks !== undefined) {
        return String(receipt.serverStartTicks) === String(serverIdentity.startTicks)
      }
      return receipt?.health?.pid === serverIdentity.pid
    }

    return {
      child,
      childExit,
      readyPayload: payload,
      redacted: redactServerReadiness(payload),
      identity,
      serverIdentity,
      daemonIdentity: teardown.getDaemonIdentity(),
      stop: teardown.stop
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
