/**
 * Pinned HTTPS request policy shared by artifact downloads.
 *
 * A fixed URL is the only accepted entry point. Redirects are refused unless
 * the caller opts into an explicit host allow-list (GitHub release assets);
 * even then every hop must stay on HTTPS with no credentials or odd ports.
 */

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const RETRYABLE_STATUSES = new Set([429, 503])
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_RETRY_DELAY_MS = 1500
const MAX_RETRY_DELAY_MS = 15000

function safeUrlLabel(rawUrl) {
  try {
    const parsed = new URL(rawUrl)
    return `${parsed.hostname}${parsed.pathname}`
  } catch {
    return 'artifact'
  }
}

function parseRetryAfterMs(headerValue, fallbackMs) {
  if (!headerValue) return fallbackMs
  const seconds = Number(headerValue)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.max(Math.round(seconds * 1000), 100), MAX_RETRY_DELAY_MS)
  }
  const timestamp = Date.parse(headerValue)
  if (Number.isFinite(timestamp)) {
    const delta = timestamp - Date.now()
    if (delta > 0) return Math.min(delta, MAX_RETRY_DELAY_MS)
  }
  return fallbackMs
}

function sleepWithSignal(ms, signal) {
  if (signal?.aborted) {
    const err = new Error('Artifact download aborted')
    err.name = 'AbortError'
    return Promise.reject(err)
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      const err = new Error('Artifact download aborted')
      err.name = 'AbortError'
      reject(err)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    timer.unref?.()
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function assertFixedUrl(url, expectedUrl) {
  if (typeof expectedUrl !== 'string' || !expectedUrl.startsWith('https://')) {
    throw new Error(`Fixed artifact URL must be https: ${expectedUrl}`)
  }
  if (typeof url !== 'string' || !url.startsWith('https://')) {
    throw new Error(`Refusing non-https artifact URL: ${url}`)
  }
  if (url !== expectedUrl) {
    throw new Error(`Refusing download from a non-fixed artifact URL: ${url}`)
  }
}

async function assertAllowedRedirect(nextUrl, allowedHosts, previousUrl) {
  let parsed
  try {
    parsed = new URL(nextUrl, previousUrl)
  } catch {
    throw new Error(`Refusing invalid redirect target: ${nextUrl}`)
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`Refusing non-https redirect target: ${parsed.href}`)
  }
  if (parsed.username || parsed.password) {
    throw new Error(`Refusing redirect target with credentials: ${parsed.href}`)
  }
  if (parsed.port && parsed.port !== '443') {
    throw new Error(`Refusing redirect target with a non-443 port: ${parsed.href}`)
  }
  if (!allowedHosts.includes(parsed.hostname)) {
    throw new Error(`Refusing redirect to a non-allowlisted host: ${parsed.hostname}`)
  }
  return parsed.href
}

export async function fetchPinnedResponse({
  url,
  expectedUrl,
  allowedRedirectHosts,
  fetchImpl,
  signal,
  maxRetries = DEFAULT_MAX_RETRIES,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  sleepImpl = sleepWithSignal
}) {
  assertFixedUrl(url, expectedUrl)
  let current = url
  let attempt = 0
  for (let hop = 0; hop <= 5; hop += 1) {
    const res = await fetchImpl(current, {
      signal,
      redirect: allowedRedirectHosts ? 'manual' : 'error'
    })
    if (!res || typeof res !== 'object') throw new Error('Artifact fetch returned no response')
    if (res.redirected) {
      throw new Error(`Refusing redirected artifact response: ${res.url ?? 'unknown'}`)
    }
    if (REDIRECT_STATUSES.has(res.status) && allowedRedirectHosts) {
      await res.body?.cancel?.().catch?.(() => {})
      const location = res.headers?.get?.('location')
      if (typeof location !== 'string' || location.length === 0) {
        throw new Error(`Redirect response ${res.status} has no location`)
      }
      current = await assertAllowedRedirect(location, allowedRedirectHosts, current)
      continue
    }
    if (RETRYABLE_STATUSES.has(res.status) && attempt < maxRetries) {
      await res.body?.cancel?.().catch?.(() => {})
      const backoff = Math.min(retryDelayMs * 2 ** attempt, MAX_RETRY_DELAY_MS)
      const waitMs = parseRetryAfterMs(res.headers?.get?.('retry-after'), backoff)
      attempt += 1
      await sleepImpl(waitMs, signal)
      hop -= 1
      continue
    }
    if (!res.ok) {
      await res.body?.cancel?.().catch?.(() => {})
      throw new Error(
        `Failed to download artifact (${safeUrlLabel(current)}): HTTP ${res.status} ${res.statusText ?? ''}`.trim()
      )
    }
    if (current !== expectedUrl && !allowedRedirectHosts) {
      throw new Error(`Refusing download from a non-fixed artifact URL: ${current}`)
    }
    if (res.url !== undefined && res.url !== current) {
      throw new Error(`Refusing redirected artifact response: ${res.url}`)
    }
    return res
  }
  throw new Error('Refusing artifact download with too many redirects')
}
