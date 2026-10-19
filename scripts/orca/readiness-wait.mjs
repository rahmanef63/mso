/**
 * Bounded readiness capture: one JSON line, capped stdout, capped/redacted
 * stderr, explicit timeout, and premature-exit failure.
 */

import { createBoundedLineReader } from './bounded-stream.mjs'
import { redactSensitiveText } from './bounded-proc.mjs'

export function waitForReadiness({ child, timeoutMs, stderrSink, signal }) {
  return new Promise((resolve, reject) => {
    let settled = false
    let reader = null
    let abortListener = null
    const stderrTail = () => redactSensitiveText(stderrSink.text()).slice(-2048)
    const timer = setTimeout(() => {
      finish(
        new Error(
          `timed out after ${timeoutMs}ms waiting for orca_server_ready${stderrTail() ? `: ${stderrTail()}` : ''}`
        )
      )
    }, timeoutMs)
    const cleanup = () => {
      clearTimeout(timer)
      child.removeListener('error', onError)
      child.removeListener('exit', onExit)
      if (signal && abortListener) signal.removeEventListener('abort', abortListener)
    }
    const finish = (err, value) => {
      if (settled) return
      settled = true
      cleanup()
      if (err) {
        reader?.detach()
        reject(err)
      } else resolve(value)
    }
    const onError = (err) => finish(new Error(`failed to spawn orcad-server: ${err.message}`))
    const onExit = (code, exitSignal) =>
      finish(
        new Error(`orcad-server exited prematurely (code ${code}, signal ${exitSignal}): ${stderrTail()}`)
      )

    if (signal) {
      abortListener = () => {
        const reason = signal.reason instanceof Error ? signal.reason.message : 'startup cancelled'
        finish(new Error(reason))
      }
      if (signal.aborted) {
        abortListener()
        return
      }
      signal.addEventListener('abort', abortListener, { once: true })
    }

    reader = createBoundedLineReader(child.stdout, {
      onLine: (line) => {
        if (!line.includes('"orca_server_ready"')) return
        try {
          finish(null, { payload: JSON.parse(line), reader })
        } catch (err) {
          finish(new Error(`invalid readiness JSON: ${redactSensitiveText(err.message)}`))
        }
      },
      onOverflow: (err) => finish(err)
    })
    child.once('error', onError)
    child.once('exit', onExit)
  })
}
