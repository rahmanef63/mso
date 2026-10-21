/**
 * Bounded, streamed HTTPS download of a single fixed artifact.
 *
 * Guarantees:
 * - only the exact pinned https URL is accepted (no caller-supplied overrides
 *   in production, no redirect that changes the target, no downgrade to http);
 * - bytes are written incrementally with a hard cap, so an oversized or
 *   endless response never lands in memory or on disk in full;
 * - timeout + caller abort cancel the fetch and remove the partial file;
 * - the finished file is renamed into place only after digest/size checks.
 */

import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { assertNoSymlinkAncestors, ensurePrivateDirTree, lstatOrNull } from './safe-paths.mjs'
import { assertFixedUrl, fetchPinnedResponse } from './download-request.mjs'

const DEFAULT_TIMEOUT_MS = 120000

function abortError(message) {
  const err = new Error(message)
  err.name = 'AbortError'
  return err
}

function closeStream(stream) {
  return new Promise((resolve) => {
    stream.once('close', resolve)
    stream.destroy()
  })
}

function writeChunk(stream, chunk) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      stream.removeListener('drain', onDrain)
      stream.removeListener('error', onError)
    }
    const onDrain = () => {
      cleanup()
      resolve()
    }
    const onError = (err) => {
      cleanup()
      reject(err)
    }
    if (stream.write(chunk)) return resolve()
    stream.once('drain', onDrain)
    stream.once('error', onError)
  })
}

export async function downloadToFile({
  url,
  expectedUrl,
  destination,
  expectedSha256,
  expectedSize,
  maxBytes,
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
  allowedRedirectHosts
} = {}) {
  await assertFixedUrl(url, expectedUrl)
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new Error(`maxBytes must be a positive integer, got ${maxBytes}`)
  }
  if (expectedSize !== undefined && expectedSize > maxBytes) {
    throw new Error(`Expected size ${expectedSize} exceeds the download cap ${maxBytes}`)
  }
  if (signal?.aborted) throw abortError('Download aborted before it started')

  await ensurePrivateDirTree(dirname(destination))
  await assertNoSymlinkAncestors(destination)
  const staging = join(dirname(destination), `.download-${process.pid}-${randomUUID()}`)
  await assertNoSymlinkAncestors(staging)

  const controller = new AbortController()
  let timedOut = false
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  timer.unref?.()

  let stream
  try {
    const res = await fetchPinnedResponse({
      url,
      expectedUrl,
      allowedRedirectHosts,
      fetchImpl,
      signal: controller.signal
    })

    const declared = Number(res.headers?.get?.('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(`Declared content-length ${declared} exceeds the download cap ${maxBytes}`)
    }

    stream = createWriteStream(staging, { mode: 0o600, flags: 'wx' })
    const hash = createHash('sha256')
    let total = 0

    const body = res.body
    if (!body || typeof body[Symbol.asyncIterator] !== 'function') {
      throw new Error('Artifact response has no readable body')
    }
    const iterator = body[Symbol.asyncIterator]()
    // Abort must interrupt a pending read, not just the fetch handshake.
    const abortPromise = new Promise((_, reject) => {
      controller.signal.addEventListener(
        'abort',
        () => {
          const err = timedOut
            ? new Error(`Artifact download timed out after ${timeoutMs}ms`)
            : abortError('Artifact download aborted')
          if (timedOut) err.name = 'TimeoutError'
          reject(err)
        },
        { once: true }
      )
    })
    abortPromise.catch(() => {})
    try {
      for (;;) {
        const step = await Promise.race([iterator.next(), abortPromise])
        if (step.done) break
        const buf = Buffer.isBuffer(step.value) ? step.value : Buffer.from(step.value)
        total += buf.length
        if (total > maxBytes) {
          throw new Error(`Artifact download exceeds the cap of ${maxBytes} bytes`)
        }
        hash.update(buf)
        await writeChunk(stream, buf)
      }
    } finally {
      await iterator.return?.().catch?.(() => {})
    }
    await new Promise((resolve, reject) => {
      stream.once('finish', resolve)
      stream.once('error', reject)
      stream.end()
    })
    stream = undefined

    const actualSha256 = hash.digest('hex')
    if (expectedSha256 !== undefined && actualSha256 !== expectedSha256) {
      throw new Error(
        `Artifact checksum mismatch: expected ${expectedSha256}, got ${actualSha256}`
      )
    }
    if (expectedSize !== undefined && total !== expectedSize) {
      throw new Error(`Artifact size mismatch: expected ${expectedSize}, got ${total}`)
    }

    await assertNoSymlinkAncestors(destination)
    if (await lstatOrNull(destination)) {
      throw new Error(`Refusing to overwrite existing artifact: ${destination}`)
    }
    await rename(staging, destination)
    return { path: destination, sha256: actualSha256, size: total }
  } catch (err) {
    if (timedOut) {
      const timeoutErr = new Error(`Artifact download timed out after ${timeoutMs}ms`)
      timeoutErr.name = 'TimeoutError'
      throw timeoutErr
    }
    if (controller.signal.aborted && !signal?.aborted) throw err
    if (signal?.aborted) throw abortError('Artifact download aborted')
    throw err
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    if (stream) await closeStream(stream)
    await rm(staging, { force: true }).catch(() => {})
  }
}
