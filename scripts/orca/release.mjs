/**
 * `preparePinnedRelease` — immutable Orca release acquisition.
 *
 * Chain: fixed .deb URL/digest -> package identity -> fresh data-only
 * extraction -> exact 175-file slot + standalone web bundle + pinned Node +
 * MIT license/notices -> private receipt -> atomic publish. Existing releases
 * are reused only after a complete rehash; a mismatch is refused, never
 * overwritten or deleted.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ORCA_DEB_FILENAME,
  ORCA_LICENSE_SHA256,
  ORCA_THIRD_PARTY_NOTICES_RELATIVE_PATH,
  ORCA_THIRD_PARTY_NOTICES_SHA256,
  ORCA_THIRD_PARTY_NOTICES_SIZE,
  ORCA_THIRD_PARTY_NOTICES_URL,
  SUPPORTED_TARGET,
  assertSupportedHostPlatform
} from './constants.mjs'
import { acquireAndExtractDeb, downloadDebArchive, verifyDebHash } from './artifact-source.mjs'
import { extractAsarEntry } from './asar-license.mjs'
import { downloadToFile } from './download.mjs'
import { fetchAndMaterializeNodeRuntime, fileSha256 } from './node-runtime.mjs'
import { materializeOrcadSlot } from './materializer.mjs'
import { buildReceipt, verifyInstalledRelease } from './release-receipt.mjs'
import { getReleaseIdentity } from './release-identity.mjs'
import { copyVerifiedFile, copyWebTree, writePrivateJson } from './release-tree.mjs'
import {
  assertNoSymlinkAncestors,
  assertOwnedRegularFile,
  ensurePrivateDir,
  ensurePrivateDirTree,
  lstatOrNull
} from './safe-paths.mjs'

async function verifyPinnedFile(filePath, { sha256, size, label }) {
  const s = await assertOwnedRegularFile(filePath)
  if (size !== undefined && s.size !== size) {
    throw new Error(`${label} size mismatch: expected ${size}, got ${s.size}`)
  }
  if ((await fileSha256(filePath)) !== sha256) throw new Error(`${label} checksum mismatch`)
  return filePath
}

async function resolveDeb({ cacheDir, verifiedDebCache, signal, timeoutMs, fetchImpl, allowDownload }) {
  if (verifiedDebCache) {
    await verifyDebHash(verifiedDebCache)
    return verifiedDebCache
  }
  if (!allowDownload) throw new Error('No verified deb cache supplied and download is disabled')
  const debPath = join(cacheDir, ORCA_DEB_FILENAME)
  if (await lstatOrNull(debPath)) {
    await verifyDebHash(debPath)
    return debPath
  }
  await downloadDebArchive({ destination: debPath, signal, timeoutMs, fetchImpl })
  return debPath
}

async function resolveNotices({ cacheDir, verifiedSourceRoot, signal, timeoutMs, fetchImpl }) {
  if (verifiedSourceRoot) {
    if (!verifiedSourceRoot.startsWith('/')) throw new Error('verifiedSourceRoot must be absolute')
    const sourcePath = join(verifiedSourceRoot, ORCA_THIRD_PARTY_NOTICES_RELATIVE_PATH)
    return verifyPinnedFile(sourcePath, {
      sha256: ORCA_THIRD_PARTY_NOTICES_SHA256,
      size: ORCA_THIRD_PARTY_NOTICES_SIZE,
      label: 'Third-party notices'
    })
  }
  const noticesPath = join(cacheDir, 'THIRD_PARTY_NOTICES.md')
  if (await lstatOrNull(noticesPath)) {
    return verifyPinnedFile(noticesPath, {
      sha256: ORCA_THIRD_PARTY_NOTICES_SHA256,
      size: ORCA_THIRD_PARTY_NOTICES_SIZE,
      label: 'Third-party notices'
    })
  }
  const result = await downloadToFile({
    url: ORCA_THIRD_PARTY_NOTICES_URL,
    expectedUrl: ORCA_THIRD_PARTY_NOTICES_URL,
    destination: noticesPath,
    expectedSha256: ORCA_THIRD_PARTY_NOTICES_SHA256,
    expectedSize: ORCA_THIRD_PARTY_NOTICES_SIZE,
    maxBytes: ORCA_THIRD_PARTY_NOTICES_SIZE,
    signal,
    timeoutMs,
    fetchImpl,
    allowedRedirectHosts: ['raw.githubusercontent.com']
  })
  return result.path
}

export async function preparePinnedRelease({
  installRoot,
  verifiedDebCache,
  verifiedSourceRoot,
  signal,
  timeoutMs = 300000,
  fetchImpl,
  allowDownload = true
} = {}) {
  assertSupportedHostPlatform()
  if (typeof installRoot !== 'string' || !installRoot.startsWith('/')) {
    throw new Error(`installRoot must be absolute: ${installRoot}`)
  }
  await ensurePrivateDirTree(installRoot)
  const identity = getReleaseIdentity()
  const releasesDir = await ensurePrivateDir(installRoot, 'releases')
  const releaseRoot = join(releasesDir, `${identity.version}+${identity.contentId}`)

  if (await lstatOrNull(releaseRoot)) {
    try {
      return await verifyInstalledRelease({ releaseRoot, identity })
    } catch (err) {
      throw new Error(`Refusing to replace existing release ${releaseRoot}: ${err.message}`)
    }
  }

  const cacheDir = await ensurePrivateDir(installRoot, 'cache')
  const debPath = await resolveDeb({
    cacheDir,
    verifiedDebCache,
    signal,
    timeoutMs,
    fetchImpl,
    allowDownload
  })
  const runtimesDir = await ensurePrivateDir(cacheDir, 'runtimes')
  const nodeBinary = await fetchAndMaterializeNodeRuntime({
    target: SUPPORTED_TARGET,
    runtimesDir,
    signal,
    allowDownload,
    timeoutMs,
    fetchImpl
  })
  const noticesPath = await resolveNotices({
    cacheDir,
    verifiedSourceRoot,
    signal,
    timeoutMs,
    fetchImpl
  })

  const workDir = await ensurePrivateDir(cacheDir, 'work')
  const extractDir = join(workDir, `deb-${identity.contentId}-${randomUUID()}`)
  const source = await acquireAndExtractDeb({ debPath, extractDir, signal, timeoutMs })
  const stagingRoot = join(releasesDir, `.staging-${identity.contentId}-${randomUUID()}`)
  await assertNoSymlinkAncestors(stagingRoot)
  await mkdir(stagingRoot, { recursive: false, mode: 0o700 })
  try {
    const slot = await materializeOrcadSlot({
      templateDir: source.templateDir,
      outputSlotDir: join(stagingRoot, 'slot'),
      target: identity.target
    })
    const web = await copyWebTree({
      sourceDir: source.webDir,
      destDir: join(stagingRoot, 'web')
    })
    await copyVerifiedFile({
      sourcePath: nodeBinary,
      destination: join(stagingRoot, identity.node.executablePath),
      expectedSha256: identity.node.executableSha256,
      mode: 0o700
    })
    await mkdir(join(stagingRoot, 'licenses'), { recursive: false, mode: 0o700 })
    await extractAsarEntry({
      asarPath: source.appAsarPath,
      entryName: 'LICENSE',
      destination: join(stagingRoot, 'licenses', 'LICENSE'),
      expectedSha256: ORCA_LICENSE_SHA256
    })
    await copyVerifiedFile({
      sourcePath: noticesPath,
      destination: join(stagingRoot, 'licenses', 'THIRD_PARTY_NOTICES.md'),
      expectedSha256: ORCA_THIRD_PARTY_NOTICES_SHA256
    })
    const receipt = buildReceipt({ identity, slot, web })
    await writePrivateJson(join(stagingRoot, 'receipt.json'), receipt)

    await verifyInstalledRelease({ releaseRoot: stagingRoot, identity })
    if (await lstatOrNull(releaseRoot)) {
      throw new Error(`Release appeared concurrently at ${releaseRoot}; refusing to overwrite`)
    }
    await rename(stagingRoot, releaseRoot)
    await rm(extractDir, { recursive: true, force: true }).catch(() => {})
    return await verifyInstalledRelease({ releaseRoot, identity })
  } finally {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => {})
  }
}

export { getReleaseContentId, getReleaseIdentity } from './release-identity.mjs'
