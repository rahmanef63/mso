import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFile, rm } from 'node:fs/promises'
import { downloadToFile } from './download.mjs'
import { FIXED_URL, redirectFor, responseFor, scratch } from './download-fixtures.mjs'

describe('bounded download url and redirect policy', () => {
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
})
