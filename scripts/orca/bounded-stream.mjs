/**
 * Bounded stream consumption. No unbounded buffering: callers cap per-line,
 * total, and rolling bytes, and can switch to discard-drain after readiness.
 */

export function createBoundedLineReader(stream, {
  maxLineBytes = 256 * 1024,
  maxTotalBytes = 4 * 1024 * 1024,
  onLine,
  onOverflow
} = {}) {
  let buffer = Buffer.alloc(0)
  let total = 0
  let discarding = false
  let failed = false

  const fail = (message) => {
    if (failed || discarding) return
    failed = true
    onOverflow?.(new Error(message))
  }

  const onData = (chunk) => {
    if (discarding) return
    if (failed) return
    total += chunk.length
    if (total > maxTotalBytes) return fail(`stdout exceeded ${maxTotalBytes} bytes before readiness`)
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk])
    let newline
    while ((newline = buffer.indexOf(0x0a)) >= 0) {
      const line = buffer.subarray(0, newline)
      buffer = buffer.subarray(newline + 1)
      if (line.length > maxLineBytes) return fail(`stdout line exceeded ${maxLineBytes} bytes`)
      onLine?.(line.toString('utf8').replace(/\r$/, ''))
      if (failed) return
    }
    if (buffer.length > maxLineBytes) fail(`stdout line exceeded ${maxLineBytes} bytes`)
  }

  stream.on('data', onData)
  return {
    /** Stop parsing; keep consuming so the child pipe never backpressures. */
    discard() {
      discarding = true
      buffer = Buffer.alloc(0)
    },
    detach() {
      discarding = true
      buffer = Buffer.alloc(0)
      stream.removeListener('data', onData)
      stream.resume()
    }
  }
}

/** Rolling byte-capped text sink (keeps the tail, drops the head). */
export function createRollingTextSink(stream, { maxBytes = 64 * 1024 } = {}) {
  const chunks = []
  let total = 0
  const onData = (chunk) => {
    chunks.push(chunk)
    total += chunk.length
    while (total > maxBytes) {
      const excess = total - maxBytes
      if (chunks[0].length <= excess) {
        total -= chunks[0].length
        chunks.shift()
      } else {
        chunks[0] = chunks[0].subarray(excess)
        total -= excess
        break
      }
    }
  }
  stream.on('data', onData)
  return {
    text: () => Buffer.concat(chunks).toString('utf8'),
    detach() {
      stream.removeListener('data', onData)
      stream.resume()
    }
  }
}

/** Keep draining an already-attached stream without retaining data. */
export function drain(stream) {
  stream.on('data', () => {})
  stream.resume()
}
