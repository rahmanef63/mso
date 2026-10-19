import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { downloadToFile } from './download.mjs'

const FIXED_URL = 'https://example.invalid/fixed-artifact.bin'

function responseFor(chunks, { ok = true, status = 200, contentLength, url = FIXED_URL } = {}) {
  let index = 0
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'ERR',
    url,
    redirected: false,
    headers: {
      get: (name) => (name.toLowerCase() === 'content-length' && contentLength !== undefined ? String(contentLength) : null)
    },
    body: {
      [Symbol.asyncIterator]() {
        return this
      },
      async next() {
        if (index >= chunks.length) return { done: true, value: undefined }
        return { done: false, value: Buffer.from(chunks[index++]) }
      },
      async return() {
        index = chunks.length
        return { done: true, value: undefined }
      }
    }
  }
}

function redirectFor(location, status = 302) {
  return {
    ok: false,
    status,
    statusText: 'Found',
    url: undefined,
    redirected: false,
    headers: { get: (name) => (name.toLowerCase() === 'location' ? location : null) },
    body: { cancel: async () => {} }
  }
}

async function scratch(name) {
  const dir = join(tmpdir(), `orca-download-${name}-${randomUUID()}`)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  return dir
}

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

  it('rejects url drift, redirects, and non-https transport', async () => {
    const dir = await scratch('url')
    try {
      const base = { destination: join(dir, 'a.bin'), maxBytes: 16 }
      await assert.rejects(
        downloadToFile({ ...base, url: 'http://example.invalid/x', expectedUrl: FIXED_URL, fetchImpl: async () => responseFor([]) }),
        /https/i
      )
      await assert.rejects(
        downloadToFile({ ...base, url: 'https://evil.invalid/x', expectedUrl: FIXED_URL, fetchImpl: async () => responseFor([]) }),
        /fixed artifact url/i
      )
      await assert.rejects(
        downloadToFile({ ...base, url: FIXED_URL, expectedUrl: FIXED_URL, fetchImpl: async () => ({ ...responseFor([]), redirected: true }) }),
        /redirect/i
      )
      await assert.rejects(
        downloadToFile({
          ...base,
          url: FIXED_URL,
          expectedUrl: FIXED_URL,
          fetchImpl: async () => responseFor([], { url: 'https://evil.invalid/x' })
        }),
        /redirect|url/i
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('follows an allow-listed HTTPS redirect and verifies the final bytes', async () => {
    const dir = await scratch('redirect-ok')
    try {
      const allowed = 'https://objects.githubusercontent.com/asset'
      const dest = join(dir, 'f.bin')
      const result = await downloadToFile({
        url: FIXED_URL,
        expectedUrl: FIXED_URL,
        destination: dest,
        maxBytes: 16,
        allowedRedirectHosts: ['objects.githubusercontent.com'],
        fetchImpl: async (url) =>
          url === FIXED_URL ? redirectFor(allowed) : responseFor([Buffer.from('ok')], { url })
      })
      assert.equal(result.size, 2)
      assert.equal(await readFile(dest, 'utf8'), 'ok')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses redirects to non-allowlisted, plaintext, or private hosts', async () => {
    const dir = await scratch('redirect-deny')
    try {
      const base = {
        url: FIXED_URL,
        expectedUrl: FIXED_URL,
        destination: join(dir, 'f.bin'),
        maxBytes: 16,
        allowedRedirectHosts: ['objects.githubusercontent.com']
      }
      for (const location of [
        'https://evil.invalid/asset',
        'http://objects.githubusercontent.com/asset',
        'https://127.0.0.1/asset',
        'https://user:pass@objects.githubusercontent.com/asset'
      ]) {
        await assert.rejects(
          downloadToFile({ ...base, fetchImpl: async () => redirectFor(location) }),
          /redirect/i
        )
      }
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
