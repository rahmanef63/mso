/**
 * Verify an Orca terminal daemon using kernel identity only: uid, executable,
 * daemon-entry.js script path, a canonical protocol socket inside the private
 * daemon directory, and canonical pid records sorted by protocol version.
 */

import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { readProcessIdentity, verifyProcessIdentity } from './proc-identity.mjs'
import { parseDaemonPid } from './launcher.mjs'

const PID_RECORD_RE = /^daemon-v(\d+)\.pid$/
const SOCKET_RE = /^daemon-v\d+\.sock$/

async function realpathOr(path) {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

/** Canonical daemon socket: real parent, protocol filename, no symlink components. */
export async function canonicalDaemonSocket(argv, { userData }) {
  const idx = argv.indexOf('--socket')
  const socketArg = idx >= 0 ? argv[idx + 1] : null
  if (!socketArg || !isAbsolute(socketArg) || !SOCKET_RE.test(basename(socketArg))) return null
  try {
    const userReal = await realpath(userData)
    const daemonDir = join(userData, 'daemon')
    const daemonReal = await realpath(daemonDir)
    const socketReal = await realpath(socketArg)
    if (daemonReal !== join(userReal, 'daemon')) return null
    if (dirname(socketReal) !== daemonReal) return null
    const socketInfo = await lstat(socketArg)
    if (socketInfo.isSymbolicLink() || !socketInfo.isSocket()) return null
    for (const path of [userData, daemonDir]) {
      const info = await lstat(path)
      if (info.isSymbolicLink() || !info.isDirectory()) return null
    }
    // Lexical socket parent must be under user-data with no symlink component,
    // so a `daemon-link/daemon-vN.sock` alias cannot impersonate the real dir.
    const socketAbs = resolve(socketArg)
    const rel = relative(resolve(userData), socketAbs)
    if (rel.startsWith('..') || isAbsolute(rel)) return null
    let current = resolve(userData)
    for (const part of rel.split(sep).slice(0, -1)) {
      current = join(current, part)
      if ((await lstat(current)).isSymbolicLink()) return null
    }
    return socketReal
  } catch {
    return null
  }
}

export async function verifyDaemon(pid, { nodeBinary, daemonEntryPath, userData }) {
  if (!Number.isInteger(pid) || pid <= 1) return null
  const actual = await readProcessIdentity(pid)
  if (!actual) return null
  if (!(await canonicalDaemonSocket(actual.argv, { userData }))) return null
  const expected = {
    pid,
    startTicks: actual.startTicks,
    uid: process.getuid(),
    exe: await realpathOr(nodeBinary),
    scriptPath: daemonEntryPath
  }
  if (!(await verifyProcessIdentity(actual, expected))) return null
  return actual
}

/** Bounded retry for a daemon that is spawning while readiness is published. */
export async function waitForDaemon(pid, options, { timeoutMs = 3000, pollMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const identity = await verifyDaemon(pid, options)
    if (identity) return identity
    if (Date.now() >= deadline) return null
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

function protocolVersion(name) {
  const match = PID_RECORD_RE.exec(name)
  return match ? Number(match[1]) : -1
}

async function scanOwnedDaemon({ userData, nodeBinary, daemonEntryPath }) {
  let files
  try {
    files = await readdir(join(userData, 'daemon'))
  } catch {
    return null
  }
  const records = files.filter((name) => PID_RECORD_RE.test(name)).sort((a, b) => protocolVersion(b) - protocolVersion(a))
  for (const name of records) {
    const raw = await readFile(join(userData, 'daemon', name), 'utf8').catch(() => '')
    const pid = parseDaemonPid(raw)
    const identity = pid ? await verifyDaemon(pid, { nodeBinary, daemonEntryPath, userData }) : null
    if (identity) return identity
  }
  return null
}

/**
 * Bounded discovery: poll for a canonical pid record published after spawn,
 * without an arbitrary first-N cap or a process census.
 */
export async function discoverOwnedDaemon({
  userData,
  nodeBinary,
  daemonEntryPath,
  waitMs = 0,
  pollMs = 100
}) {
  if (!userData) return null
  const deadline = Date.now() + Math.max(0, waitMs)
  for (;;) {
    const identity = await scanOwnedDaemon({ userData, nodeBinary, daemonEntryPath })
    if (identity) return identity
    const remaining = deadline - Date.now()
    if (remaining <= 0) return null
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, remaining)))
  }
}
