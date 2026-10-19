/**
 * Bounded, leak-free subprocess execution for Orca CLI/RPC calls.
 * Captures capped stdout/stderr, enforces a deadline and byte caps, and always
 * reaps the owned child (and its process group) before returning or throwing.
 */

import { spawn } from 'node:child_process'

const DEFAULT_TIMEOUT_MS = 30000
const DEFAULT_MAX_STDOUT = 4 * 1024 * 1024
const DEFAULT_MAX_STDERR = 64 * 1024
const KILL_GRACE_MS = 500

const SENSITIVE_PATTERNS = [
  [/orca:\/\/pair[^\s"']*/gi, '[redacted-pairing-url]'],
  [/([?&#\s](?:token|code|pairing|key|secret)=)[^&\s"'#]+/gi, '$1REDACTED'],
  [/(ORCA_(?:PAIRING_CODE|REMOTE_PAIRING|REMOTE_AUTH_TOKEN)\s*[=:]\s*)\S+/gi, '$1REDACTED'],
  [/(authorization:\s*bearer\s+)\S+/gi, '$1REDACTED']
]

/** Remove bearer/pairing material from any diagnostic string. */
export function redactSensitiveText(text) {
  if (typeof text !== 'string') return ''
  let out = text
  for (const [pattern, replacement] of SENSITIVE_PATTERNS) out = out.replace(pattern, replacement)
  return out
}

function killTree(pid) {
  if (!pid) return
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {}
  }
}

/**
 * Run one command to completion with hard bounds.
 * Resolves { code, signal, stdout, stderr }; rejects on spawn error, timeout,
 * or output overflow, after the child is confirmed dead.
 */
export function runBounded({
  cmd,
  args = [],
  env,
  cwd,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxStdoutBytes = DEFAULT_MAX_STDOUT,
  maxStderrBytes = DEFAULT_MAX_STDERR
}) {
  if (typeof cmd !== 'string' || cmd.length === 0) {
    return Promise.reject(new Error('runBounded requires a command'))
  }
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env,
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const stdout = []
    const stderr = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    let timer = null
    let pendingError = null

    const settle = (error, result) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (error) reject(error)
      else resolve(result)
    }

    // Kill the owned group and wait for the real close before settling.
    const abort = (error) => {
      if (settled || pendingError) return
      pendingError = error
      if (timer) clearTimeout(timer)
      killTree(child.pid)
      const force = setTimeout(() => settle(pendingError), KILL_GRACE_MS)
      force.unref?.()
    }

    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > maxStdoutBytes) {
        abort(new Error(`stdout exceeded ${maxStdoutBytes} bytes`))
        return
      }
      stdout.push(chunk)
    })

    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length
      if (stderrBytes > maxStderrBytes) {
        abort(new Error(`stderr exceeded ${maxStderrBytes} bytes`))
        return
      }
      stderr.push(chunk)
    })

    child.on('error', (err) => {
      if (pendingError) return settle(pendingError)
      settle(err)
    })

    child.on('close', (code, signal) => {
      if (pendingError) return settle(pendingError)
      settle(null, {
        code,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8')
      })
    })

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        abort(new Error(`command timed out after ${timeoutMs}ms: ${cmd} ${args.join(' ')}`))
      }, timeoutMs)
      timer.unref?.()
    }
  })
}

/** Graceful-then-forced kill of a detached child; awaits real exit. */
export async function reapBoundedChild(child, { graceMs = KILL_GRACE_MS } = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return true
  try {
    child.kill('SIGTERM')
  } catch {}
  const exited = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), graceMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
  if (!exited) killTree(child.pid)
  return exited
}
