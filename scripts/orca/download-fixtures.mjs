import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const FIXED_URL = 'https://example.invalid/fixed-artifact.bin'

export function responseFor(chunks, { ok = true, status = 200, contentLength, url = FIXED_URL } = {}) {
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

export function redirectFor(location, status = 302) {
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

export async function scratch(name) {
  return mkdtemp(join(tmpdir(), `orca-download-${name}-`))
}
