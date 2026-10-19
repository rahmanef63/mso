/**
 * Verify an Orca terminal daemon using kernel identity only: uid, executable,
 * daemon-entry.js script path, and a --socket inside this runtime's user-data.
 */

import { readFile, readdir, realpath } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { readProcessIdentity, verifyProcessIdentity } from './proc-identity.mjs'
import { parseDaemonPid } from './launcher.mjs'

const MAX_DAEMON_PID_FILES = 8

async function realpathOr(path) {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

export async function verifyDaemon(pid, { nodeBinary, daemonEntryPath, userData }) {
  if (!Number.isInteger(pid) || pid <= 1) return null
  const actual = await readProcessIdentity(pid)
  if (!actual) return null
  const socketRoot = `${join(userData, 'daemon')}${sep}`
  const socketOk = actual.argv.some(
    (arg, i) => i > 0 && actual.argv[i - 1] === '--socket' && arg.startsWith(socketRoot)
  )
  const expected = {
    pid,
    startTicks: actual.startTicks,
    uid: process.getuid(),
    exe: await realpathOr(nodeBinary),
    scriptPath: daemonEntryPath
  }
  if (!(await verifyProcessIdentity(actual, expected))) return null
  if (!socketOk) return null
  return actual
}

export async function discoverOwnedDaemon({ userData, nodeBinary, daemonEntryPath }) {
  if (!userData) return null
  let files
  try {
    files = await readdir(join(userData, 'daemon'))
  } catch {
    return null
  }
  const pidFiles = files.filter((f) => /^daemon-v\d+\.pid$/.test(f)).slice(0, MAX_DAEMON_PID_FILES)
  for (const name of pidFiles) {
    const raw = await readFile(join(userData, 'daemon', name), 'utf8').catch(() => '')
    const pid = parseDaemonPid(raw)
    const identity = pid ? await verifyDaemon(pid, { nodeBinary, daemonEntryPath, userData }) : null
    if (identity) return identity
  }
  return null
}
