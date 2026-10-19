import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { readFile, rm, stat } from 'node:fs/promises'
import { downloadToFile } from './download.mjs'
import { FIXED_URL, responseFor, scratch } from './download-fixtures.mjs'

describe('bounded streamed download', () => {
  it('streams to a private file and verifies hash and size', async () => {
    const dir = await scratch('ok')
    try {
      const dest = join(dir, 'artifact.bin')
      const chunks = [Buffer.from('hello '), Buffer.from('orca')]
      const expected = createHash('sha256').update(Buffer.concat(chunks)).digest('hex')
      const result = await downloadToFile({
        url: FIXED_URL,
        expectedUrl: FIXED_URL,
        destination: dest,
        expectedSha256: expected,
        expectedSize: 10,
        maxBytes: 10,
        fetchImpl: async () => responseFor(chunks, { contentLength: 10 })
      })
      assert.equal(result.size, 10)
      assert.equal(result.sha256, expected)
      assert.equal((await readFile(dest, 'utf8')), 'hello orca')
      assert.equal((await stat(dest)).mode & 0o077, 0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('aborts before allocating when the stream exceeds the cap', async () => {
    const dir = await scratch('cap')
    try {
      const dest = join(dir, 'artifact.bin')
      const chunks = [Buffer.alloc(8), Buffer.alloc(8)]
      let pulled = 0
      const response = responseFor(chunks)
      const iterator = response.body[Symbol.asyncIterator]()
      response.body[Symbol.asyncIterator] = () => ({
        next: async () => {
          pulled += 1
          return iterator.next()
        },
        return: () => iterator.return()
      })
      await assert.rejects(
        downloadToFile({
          url: FIXED_URL,
          expectedUrl: FIXED_URL,
          destination: dest,
          maxBytes: 10,
          fetchImpl: async () => response
        }),
        /exceeds/i
      )
      assert.equal(pulled, 2)
      await assert.rejects(stat(dest), /ENOENT/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects oversized content-length before reading the body', async () => {
    const dir = await scratch('length')
    try {
      let pulled = 0
      const response = responseFor([Buffer.alloc(4)], { contentLength: 1024 })
      response.body[Symbol.asyncIterator] = () => ({
        next: async () => {
          pulled += 1
          return { done: true, value: undefined }
        }
      })
      await assert.rejects(
        downloadToFile({
          url: FIXED_URL,
          expectedUrl: FIXED_URL,
          destination: join(dir, 'a.bin'),
          maxBytes: 32,
          fetchImpl: async () => response
        }),
        /content-length|exceeds/i
      )
      assert.equal(pulled, 0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('supports pre-aborted signals without invoking fetch', async () => {
    const dir = await scratch('abort')
    try {
      let called = false
      const controller = new AbortController()
      controller.abort()
      await assert.rejects(
        downloadToFile({
          url: FIXED_URL,
          expectedUrl: FIXED_URL,
          destination: join(dir, 'a.bin'),
          maxBytes: 16,
          signal: controller.signal,
          fetchImpl: async () => {
            called = true
            return responseFor([])
          }
        }),
        { name: 'AbortError' }
      )
      assert.equal(called, false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('times out and removes partial files', async () => {
    const dir = await scratch('timeout')
    try {
      const dest = join(dir, 'a.bin')
      const response = responseFor([])
      response.body[Symbol.asyncIterator] = () => ({
        next: () => new Promise((resolve) => setTimeout(() => resolve({ done: true }), 500)),
        return: async () => ({ done: true })
      })
      await assert.rejects(
        downloadToFile({
          url: FIXED_URL,
          expectedUrl: FIXED_URL,
          destination: dest,
          maxBytes: 16,
          timeoutMs: 40,
          fetchImpl: async () => response
        }),
        /timed out/i
      )
      await assert.rejects(stat(dest), /ENOENT/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('removes the partial file when the digest does not match', async () => {
    const dir = await scratch('digest')
    try {
      const dest = join(dir, 'a.bin')
      await assert.rejects(
        downloadToFile({
          url: FIXED_URL,
          expectedUrl: FIXED_URL,
          destination: dest,
          expectedSha256: '0'.repeat(64),
          maxBytes: 16,
          fetchImpl: async () => responseFor([Buffer.from('abc')])
        }),
        /checksum/i
      )
      await assert.rejects(stat(dest), /ENOENT/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
