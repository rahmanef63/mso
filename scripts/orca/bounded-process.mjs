/**
 * Bounded child-process execution for data-only upstream tooling.
 *
 * Guarantees:
 * - stdout/stderr are drained and capped in memory (never unbounded arrays);
 * - an optional stdout sink receives chunks with backpressure;
 * - timeout and caller abort escalate SIGTERM -> SIGKILL and await `close`;
 * - timers/listeners are always cleared, so a cancelled run leaves no handle.
 */

import { spawn } from 'node:child_process'

function abortError(message) {
  const err = new Error(message)
  err.name = 'AbortError'
  return err
}

function timeoutError(message) {
  const err = new Error(message)
  err.name = 'TimeoutError'
  return err
}

export async function runBoundedProcess({
  command,
  args = [],
  timeoutMs = 60000,
  signal,
  maxStdoutBytes = 0,
  maxStderrBytes = 65536,
  onStdout,
  stdoutFd,
  graceMs = 2000
} = {}) {
  if (typeof command !== 'string' || command.length === 0) {
    throw new Error('command is required')
  }
  if (stdoutFd !== undefined && typeof stdoutFd !== 'number') {
    throw new Error('stdoutFd must be a file descriptor number')
  }
  if (signal?.aborted) throw abortError('Process aborted before it started')

  const child = spawn(command, args, {
    stdio: ['ignore', stdoutFd === undefined ? 'pipe' : stdoutFd, 'pipe']
  })
  const stderrChunks = []
  const stdoutChunks = []
  let stderrBytes = 0
  let stderrTruncated = false
  let stdoutBytes = 0
  let timedOut = false
  let aborted = false
  let sinkFailure = null
  let closed = false

  const stop = () => {
    try {
      child.kill('SIGTERM')
    } catch {}
    const killTimer = setTimeout(() => {
      if (closed) return
      try {
        child.kill('SIGKILL')
      } catch {}
    }, graceMs)
    killTimer.unref?.()
  }

  const onAbort = () => {
    aborted = true
    stop()
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    stop()
  }, timeoutMs)
  timer.unref?.()

  child.stderr.on('data', (chunk) => {
    stderrBytes += chunk.length
    if (stderrBytes > maxStderrBytes) {
      stderrTruncated = true
      return
    }
    stderrChunks.push(chunk)
  })

  if (child.stdout) child.stdout.on('data', (chunk) => {
    stdoutBytes += chunk.length
    if (maxStdoutBytes > 0 && stdoutBytes > maxStdoutBytes) {
      sinkFailure = new Error(`Process stdout exceeded the cap of ${maxStdoutBytes} bytes`)
      stop()
      return
    }
    if (!onStdout) {
      if (maxStdoutBytes > 0) stdoutChunks.push(chunk)
      return
    }
    child.stdout.pause()
    Promise.resolve(onStdout(chunk)).then(
      () => {
        if (!closed) child.stdout.resume()
      },
      (err) => {
        sinkFailure = err
        stop()
      }
    )
  })
  if (child.stdout) child.stdout.on('error', (err) => {
    sinkFailure = err
    stop()
  })

  const spawnError = await new Promise((resolve) => {
    child.once('error', resolve)
    child.once('close', () => resolve(null))
  }).then((err) => {
    closed = true
    return err
  })

  child.removeAllListeners('error')
  clearTimeout(timer)
  signal?.removeEventListener('abort', onAbort)
  if (child.stdout && !child.stdout.destroyed) child.stdout.resume()
  if (child.stderr && !child.stderr.destroyed) child.stderr.resume()

  if (timedOut) throw timeoutError(`Process timed out after ${timeoutMs}ms: ${command}`)
  if (aborted) throw abortError(`Process aborted: ${command}`)
  if (spawnError) throw spawnError
  if (sinkFailure) throw sinkFailure

  return {
    code: child.exitCode,
    signal: child.signalCode,
    stdoutBytes,
    stdout: Buffer.concat(stdoutChunks).toString('utf8'),
    stderr: Buffer.concat(stderrChunks).toString('utf8'),
    stderrTruncated
  }
}
