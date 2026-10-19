/**
 * Linux process identity: kernel start ticks, uid, executable, argv.
 * Shared by launcher/lifecycle so no caller ever signals a PID it has not verified.
 * Identity is read from procfs only; /proc/<pid>/environ is never touched.
 */

import { readFile, readlink, realpath } from 'node:fs/promises'

const PROC = '/proc'

/** Parse /proc/<pid>/stat where comm may contain spaces and parentheses. */
export function parseProcStat(raw) {
  if (typeof raw !== 'string') return null
  const open = raw.indexOf('(')
  const close = raw.lastIndexOf(')')
  if (open < 0 || close < open) return null
  const pid = Number(raw.slice(0, open).trim())
  if (!Number.isInteger(pid) || pid <= 0) return null
  const comm = raw.slice(open + 1, close)
  const fields = raw.slice(close + 2).trim().split(/\s+/)
  // fields[0] is stat field 3 (state); starttime is field 22 -> index 19.
  const state = fields[0]
  const startTicks = fields[19]
  if (!state || !/^\d+$/.test(startTicks ?? '')) return null
  return { pid, comm, state, startTicks }
}

async function readUid(pid) {
  try {
    const status = await readFile(`${PROC}/${pid}/status`, 'utf8')
    const m = /^Uid:\s+(\d+)\s+(\d+)/m.exec(status)
    return m ? { uid: Number(m[1]), euid: Number(m[2]) } : null
  } catch {
    return null
  }
}

async function readArgv(pid) {
  try {
    const raw = await readFile(`${PROC}/${pid}/cmdline`, 'utf8')
    return raw.split('\0').filter((s) => s.length > 0)
  } catch {
    return null
  }
}

async function readExe(pid) {
  try {
    return await realpath(`${PROC}/${pid}/exe`)
  } catch {
    try {
      return await readlink(`${PROC}/${pid}/exe`)
    } catch {
      return null
    }
  }
}

/** Full identity snapshot, or null when the process is gone or its PID was reused mid-read. */
export async function readProcessIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return null
  let raw
  try {
    raw = await readFile(`${PROC}/${pid}/stat`, 'utf8')
  } catch {
    return null
  }
  const parsed = parseProcStat(raw)
  if (!parsed) return null
  const owner = await readUid(pid)
  if (!owner) return null
  const [argv, exe] = await Promise.all([readArgv(pid), readExe(pid)])
  // Re-read the kernel start time after the multi-file snapshot: a reused PID
  // must not combine fields from two different processes.
  let confirm
  try {
    confirm = parseProcStat(await readFile(`${PROC}/${pid}/stat`, 'utf8'))
  } catch {
    return null
  }
  if (!confirm || confirm.startTicks !== parsed.startTicks) return null
  return {
    pid,
    comm: parsed.comm,
    state: parsed.state,
    startTicks: parsed.startTicks,
    uid: owner.uid,
    euid: owner.euid,
    exe,
    argv: argv ?? []
  }
}

async function resolvePath(p) {
  try {
    return await realpath(p)
  } catch {
    return p
  }
}

async function hasScript(argv, scriptPath) {
  const wanted = await resolvePath(scriptPath)
  for (const arg of argv) {
    if (arg === scriptPath) return true
    if (arg.endsWith(`/${scriptPath}`)) return true
    if (arg.startsWith('/') && (await resolvePath(arg)) === wanted) return true
  }
  return false
}

function hasSocket(argv, socketPath) {
  const idx = argv.indexOf('--socket')
  if (idx >= 0 && argv[idx + 1] === socketPath) return true
  return argv.includes(socketPath)
}

/**
 * Compare a live snapshot with an expected identity. Only fields present in
 * `expected` are enforced; pid + startTicks + uid + exe are always enforced.
 */
export async function verifyProcessIdentity(actual, expected) {
  if (!actual || !expected) return false
  if (actual.pid !== expected.pid) return false
  if (String(actual.startTicks) !== String(expected.startTicks)) return false
  if (expected.uid !== undefined && actual.uid !== expected.uid) return false
  if (expected.exe !== undefined && actual.exe !== expected.exe) return false
  if (expected.scriptPath !== undefined && !(await hasScript(actual.argv, expected.scriptPath))) return false
  if (expected.socketPath !== undefined && !hasSocket(actual.argv, expected.socketPath)) return false
  return true
}

/** Poll until a child identity is observable and matches, else null. */
export async function waitForProcessIdentity(pid, expected = {}, { attempts = 40, delayMs = 50 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    const actual = await readProcessIdentity(pid)
    if (actual) {
      const baseline = {
        ...expected,
        pid,
        startTicks: expected.startTicks ?? actual.startTicks
      }
      if (await verifyProcessIdentity(actual, baseline)) return actual
    }
    if (i + 1 < attempts) await new Promise((r) => setTimeout(r, delayMs))
  }
  return null
}

/** True once the exact identity is gone (dead, zombie, or the PID was reused). */
export async function waitForProcessExit(identity, { timeoutMs = 5000, pollMs = 50 } = {}) {
  const start = Date.now()
  for (;;) {
    const actual = await readProcessIdentity(identity.pid)
    if (!actual || actual.state === 'Z' || actual.startTicks !== identity.startTicks) return true
    if (Date.now() - start >= timeoutMs) return false
    await new Promise((r) => setTimeout(r, pollMs))
  }
}

/**
 * Signal only after re-verifying kernel identity. Never signals a stale,
 * reused, or foreign PID; returns explicit failure instead of pretending.
 * Linux has no pidfd here, so a verify-then-kill window remains; start ticks
 * make reuse detectable before/after signalling but cannot eliminate the race.
 */
export async function terminateVerifiedProcess(
  identity,
  { timeoutMs = 5000, killTimeoutMs = 3000, pollMs = 50 } = {}
) {
  const before = await readProcessIdentity(identity.pid)
  if (!(await verifyProcessIdentity(before, identity))) {
    return { signaled: false, forced: false, exited: false, stale: true }
  }
  try {
    process.kill(identity.pid, 'SIGTERM')
  } catch (err) {
    if (err.code !== 'ESRCH') return { signaled: false, forced: false, exited: false, stale: false }
    return { signaled: false, forced: false, exited: true, stale: true }
  }
  if (await waitForProcessExit(identity, { timeoutMs, pollMs })) {
    return { signaled: true, forced: false, exited: true, stale: false }
  }
  const beforeKill = await readProcessIdentity(identity.pid)
  if (!(await verifyProcessIdentity(beforeKill, identity))) {
    return { signaled: true, forced: false, exited: false, stale: true }
  }
  try {
    process.kill(identity.pid, 'SIGKILL')
  } catch (err) {
    if (err.code !== 'ESRCH') throw err
  }
  const exited = await waitForProcessExit(identity, { timeoutMs: killTimeoutMs, pollMs })
  return { signaled: true, forced: true, exited, stale: false }
}
