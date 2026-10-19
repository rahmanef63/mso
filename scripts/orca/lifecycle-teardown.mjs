/**
 * Retriable teardown for one owned Orca server/daemon pair. Discovery barriers
 * are bounded, cleanup never claims a stale identity exited, and receipts are
 * cleared only after the server is confirmed stopped.
 */

import { readProcessIdentity, terminateVerifiedProcess, verifyProcessIdentity } from './proc-identity.mjs'
import { discoverOwnedDaemon } from './daemon-identity.mjs'
import { clearPrivatePairIfMatch } from './private-store.mjs'

const PRE_STOP_DISCOVERY_MS = 500
const POST_STOP_DISCOVERY_MS = 3000
const PRESERVE_DISCOVERY_MS = 1000

export function createLifecycleTeardown({
  root,
  userData,
  nodeBinary,
  daemonEntryPath,
  discoveryWaitMs,
  getServerIdentity,
  getReceiptPaths,
  getExpectedIdentity
}) {
  let daemonIdentity = null
  let stopPromise = null
  let stopResult = null

  const ownDaemonScan = (waitMs) =>
    discoverOwnedDaemon({ userData, nodeBinary, daemonEntryPath, waitMs })

  const cleanup = async () => {
    const failures = []
    const preDaemon =
      daemonIdentity ?? (await ownDaemonScan(discoveryWaitMs ?? PRE_STOP_DISCOVERY_MS))
    if (preDaemon) daemonIdentity = preDaemon
    const serverIdentity = getServerIdentity()
    if (serverIdentity) {
      const result = await terminateVerifiedProcess(serverIdentity, { timeoutMs: 2000, killTimeoutMs: 3000 })
      if (!result.exited && !result.stale) failures.push(`server ${serverIdentity.pid} did not exit`)
    }
    const daemon =
      preDaemon ?? (await ownDaemonScan(Math.max(discoveryWaitMs ?? 0, POST_STOP_DISCOVERY_MS)))
    if (daemon) {
      daemonIdentity = daemon
      const result = await terminateVerifiedProcess(daemon, { timeoutMs: 2000, killTimeoutMs: 3000 })
      if (!result.exited && !result.stale) failures.push(`daemon ${daemon.pid} did not exit`)
    }
    return failures
  }

  const stop = (stopOptions = {}) => {
    if (stopResult) return Promise.resolve(stopResult)
    if (stopPromise) return stopPromise
    const attempt = (async () => {
      const { cleanDaemon = true, timeoutMs = 5000 } = stopOptions
      const serverIdentity = getServerIdentity()
      const preDaemon = cleanDaemon
        ? daemonIdentity ?? (await ownDaemonScan(discoveryWaitMs ?? PRE_STOP_DISCOVERY_MS))
        : null

      const serverResult = await terminateVerifiedProcess(serverIdentity, {
        timeoutMs,
        killTimeoutMs: 3000
      })
      if (!serverResult.exited && !serverResult.stale) {
        throw new Error(`stop failed: server ${serverIdentity.pid} is still alive`)
      }

      let daemonResult = { exited: false, stale: false, forced: false }
      let daemonPreserved = null
      let daemonKnown = Boolean(daemonIdentity || preDaemon)
      let daemonCleanup = cleanDaemon ? 'unknown' : 'preserved'
      if (cleanDaemon) {
        const daemon =
          preDaemon ?? (await ownDaemonScan(Math.max(discoveryWaitMs ?? 0, POST_STOP_DISCOVERY_MS)))
        if (daemon) {
          daemonIdentity = daemon
          daemonKnown = true
          daemonResult = await terminateVerifiedProcess(daemon, { timeoutMs, killTimeoutMs: 3000 })
          if (!daemonResult.exited && !daemonResult.stale) {
            throw new Error(`stop failed: daemon ${daemon.pid} is still alive`)
          }
          daemonCleanup = daemonResult.exited ? 'verified' : 'unknown'
        }
      } else {
        const daemon = daemonIdentity ?? (await ownDaemonScan(PRESERVE_DISCOVERY_MS))
        if (daemon) {
          const actual = await readProcessIdentity(daemon.pid)
          const alive = Boolean(actual && actual.state !== 'Z' && (await verifyProcessIdentity(actual, daemon)))
          daemonPreserved = alive
          daemonKnown = true
          if (alive) daemonIdentity = daemon
        } else {
          daemonPreserved = 'unknown'
        }
      }

      const { preserved } = await clearPrivatePairIfMatch({
        root,
        matches: getReceiptPaths().map((path) => ({
          path,
          predicate: getExpectedIdentity()
        }))
      })

      return {
        exited: true,
        daemonExited: Boolean(cleanDaemon && daemonResult.exited),
        daemonPreserved,
        daemonKnown,
        daemonCleanup,
        forced: Boolean(serverResult.forced || daemonResult.forced),
        receiptsCleared: true,
        preservedReceipts: preserved
      }
    })()
    const tracked = attempt.then(
      (value) => {
        stopResult = value
        return value
      },
      (err) => {
        stopPromise = null
        throw err
      }
    )
    stopPromise = tracked
    return tracked
  }

  return {
    cleanup,
    stop,
    getDaemonIdentity: () => daemonIdentity,
    setDaemonIdentity: (identity) => {
      daemonIdentity = identity
    }
  }
}
