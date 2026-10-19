/**
 * Preflight guards for the managed Orca install.
 *
 * Each guard fails clearly and mutates nothing: the configured split-origin
 * endpoint, the systemd user bus, the fixed loopback port, and the shape of a
 * prepared release are all checked before any download, write, or service call.
 * The operator's existing Orca state and port 6768 are never read or signalled.
 */

import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { isAbsolute, join, normalize, sep } from 'node:path'
import { ORCA_VERSION } from './constants.mjs'
import { SERVICE_NAME } from './managed-paths.mjs'
import { getReleaseContentId, getReleaseIdentity } from './release-identity.mjs'
import { assertConfiguredAdvertisedEndpoint, assertPersistentPort } from './supervision.mjs'

/** `<configured app origin>` -> the exact WSS endpoint Orca advertises. */
export function toWssEndpoint(appOrigin) {
  if (typeof appOrigin !== 'string' || !appOrigin.trim()) {
    throw new Error('Orca install requires MSO_INSTALL_APP_ORIGIN (the configured split app origin)')
  }
  let url
  try {
    url = new URL(appOrigin.trim())
  } catch {
    throw new Error(`configured Orca app origin is not a valid URL: ${appOrigin}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('configured Orca app origin must be http(s)')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('configured Orca app origin must not contain credentials, query, or fragment')
  }
  const wss = new URL(url.href)
  wss.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return assertConfiguredAdvertisedEndpoint(wss.href)
}

export function defaultUserBusEnvironment({ env = process.env } = {}) {
  const current = env.XDG_RUNTIME_DIR
  if (current && existsSync(`${current}/bus`)) return { XDG_RUNTIME_DIR: current }
  const uid = typeof process.getuid === 'function' ? process.getuid() : null
  if (uid !== null && existsSync(`/run/user/${uid}/bus`)) return { XDG_RUNTIME_DIR: `/run/user/${uid}` }
  return null
}

/** A clear preflight failure instead of a unit that can never start. */
export async function assertUserSystemdBus({ env = process.env, probe = defaultUserBusEnvironment } = {}) {
  const bus = await probe({ env })
  if (!bus) {
    throw new Error(
      `Cannot reach the systemd user bus for this account, so ${SERVICE_NAME} could not be installed or started. ` +
        'On a normal systemd host enable user linger (`loginctl enable-linger $USER`) and make XDG_RUNTIME_DIR available to MSO. ' +
        'Nothing has been changed.'
    )
  }
  return bus
}

/** Fixed-port preflight. Never points at 6768: that is the operator's own instance. */
export async function assertPortFree({ port, host = '127.0.0.1' }) {
  const fixedPort = assertPersistentPort(port)
  await new Promise((resolve, reject) => {
    const probe = createServer()
    probe.unref()
    probe.once('error', (err) => {
      reject(
        new Error(
          err?.code === 'EADDRINUSE'
            ? `port ${host}:${fixedPort} is already in use; refusing to start ${SERVICE_NAME} over another process`
            : `could not verify port ${host}:${fixedPort} is free: ${err?.code ?? 'unknown error'}`
        )
      )
    })
    probe.listen(fixedPort, host, () => probe.close(() => resolve()))
  })
}

export function assertPreparedRelease(release, managedRoot) {
  if (!release || typeof release !== 'object') throw new Error('preparePinnedRelease returned no release')
  const root = normalize(managedRoot)
  const identity = getReleaseIdentity()
  // The pinned release lives at exactly `<root>/releases/<version>+<contentId>`
  // and every other path is a fixed suffix of that slot. Comparing against the
  // canonical expectation (rather than a lexical `startsWith`) makes a
  // `/root/../foreign` spelling fail closed as loudly as an outright escape.
  const expectedReleaseRoot = join(root, 'releases', `${identity.version}+${identity.contentId}`)
  const expected = {
    releaseRoot: expectedReleaseRoot,
    slotDir: join(expectedReleaseRoot, 'slot'),
    webDir: join(expectedReleaseRoot, 'web'),
    receiptPath: join(expectedReleaseRoot, 'receipt.json'),
    nodeBinary: join(expectedReleaseRoot, identity.node.executablePath)
  }
  for (const [key, value] of Object.entries(expected)) {
    if (typeof release[key] !== 'string' || !isAbsolute(release[key])) {
      throw new Error(`prepared release ${key} must be an absolute path`)
    }
    if (release[key] !== normalize(release[key]) || release[key].split(sep).includes('..')) {
      throw new Error(`prepared release ${key} is not a canonical path: ${release[key]}`)
    }
  }
  if (release.releaseRoot !== expected.releaseRoot) {
    throw new Error(`prepared release releaseRoot is not the immutable release root: ${release.releaseRoot}`)
  }
  for (const key of ['slotDir', 'nodeBinary', 'webDir', 'receiptPath']) {
    if (release[key] !== expected[key]) {
      throw new Error(`prepared release ${key} is outside the immutable release root: ${release[key]}`)
    }
  }
  if (release.version !== ORCA_VERSION) {
    throw new Error(`prepared release version mismatch: expected ${ORCA_VERSION}, got ${release.version}`)
  }
  if (release.receipt?.release?.contentId !== getReleaseContentId()) {
    throw new Error('prepared release receipt content id does not match the pinned release')
  }
  return release
}
