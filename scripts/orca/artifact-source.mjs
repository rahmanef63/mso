/**
 * Orca release artifact (.deb) acquisition and data-only extraction.
 *
 * The fixed published .deb digest is the trust anchor. Every acquisition re-verifies the
 * file, reads package identity with `dpkg-deb -f`, and extracts into a fresh private
 * staging directory with `dpkg-deb -x` (data only: no maintainer scripts, apt, root,
 * graphical execution) and never trusts or overwrites an existing directory.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  ORCA_APP_ASAR_PATH,
  ORCA_APP_ASAR_SHA256,
  ORCA_DEB_ARCHITECTURE,
  ORCA_DEB_FILENAME,
  ORCA_DEB_PACKAGE,
  ORCA_DEB_SHA256,
  ORCA_DEB_SIZE,
  ORCA_DEB_TEMPLATE_DIR,
  ORCA_DEB_URL,
  ORCA_DEB_WEB_DIR,
  ORCA_DOWNLOAD_REDIRECT_HOSTS,
  ORCA_VERSION
} from './constants.mjs'
import { downloadToFile } from './download.mjs'
import { fileSha256 } from './node-runtime.mjs'
import { runBoundedProcess } from './bounded-process.mjs'
import {
  assertNoSymlinkAncestors,
  assertOwnedRegularFile,
  ensurePrivateDirTree,
  lstatOrNull
} from './safe-paths.mjs'

export async function verifyDebHash(
  filePath,
  expected = ORCA_DEB_SHA256,
  { expectedSize = ORCA_DEB_SIZE } = {}
) {
  const s = await assertOwnedRegularFile(filePath)
  if (expectedSize !== undefined && s.size !== expectedSize) {
    throw new Error(`Deb archive size mismatch: expected ${expectedSize}, got ${s.size}`)
  }
  const actual = await fileSha256(filePath)
  if (actual !== expected) {
    throw new Error(`Deb archive checksum mismatch: expected ${expected}, got ${actual}`)
  }
  return actual
}

export async function downloadDebArchive({
  destination,
  signal,
  timeoutMs = 300000,
  fetchImpl,
  allowedRedirectHosts = ORCA_DOWNLOAD_REDIRECT_HOSTS
} = {}) {
  const result = await downloadToFile({
    url: ORCA_DEB_URL,
    expectedUrl: ORCA_DEB_URL,
    destination,
    expectedSha256: ORCA_DEB_SHA256,
    expectedSize: ORCA_DEB_SIZE,
    maxBytes: ORCA_DEB_SIZE,
    signal,
    timeoutMs,
    fetchImpl,
    allowedRedirectHosts
  })
  return result.path
}

function parseControl(text) {
  const fields = {}
  for (const line of text.split('\n')) {
    const match = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/.exec(line.trimEnd())
    if (match) fields[match[1].toLowerCase()] = match[2].trim()
  }
  return fields
}

export async function readDebControl({ debPath, signal, timeoutMs = 30000 } = {}) {
  await assertOwnedRegularFile(debPath)
  const res = await runBoundedProcess({
    command: 'dpkg-deb',
    args: ['-f', debPath, 'Package', 'Version', 'Architecture'],
    timeoutMs,
    signal,
    maxStdoutBytes: 8192,
    maxStderrBytes: 8192
  })
  if (res.code !== 0) {
    throw new Error(`dpkg-deb -f failed with code ${res.code}: ${res.stderr}`)
  }
  const fields = parseControl(res.stdout)
  const control = {
    package: fields.package,
    version: fields.version,
    architecture: fields.architecture
  }
  if (control.package !== ORCA_DEB_PACKAGE) {
    throw new Error(`Deb package identity mismatch: expected ${ORCA_DEB_PACKAGE}, got ${control.package}`)
  }
  if (control.version !== ORCA_VERSION) {
    throw new Error(`Deb version identity mismatch: expected ${ORCA_VERSION}, got ${control.version}`)
  }
  if (control.architecture !== ORCA_DEB_ARCHITECTURE) {
    throw new Error(
      `Deb architecture identity mismatch: expected ${ORCA_DEB_ARCHITECTURE}, got ${control.architecture}`
    )
  }
  return control
}

async function assertRequiredSource(extractDir, debSha256, control) {
  const templateDir = join(extractDir, ORCA_DEB_TEMPLATE_DIR)
  const webDir = join(extractDir, ORCA_DEB_WEB_DIR)
  const appAsarPath = join(extractDir, ORCA_APP_ASAR_PATH)
  for (const dir of [templateDir, webDir]) {
    await assertNoSymlinkAncestors(dir)
    const s = await lstatOrNull(dir)
    if (!s || !s.isDirectory() || s.isSymbolicLink()) {
      throw new Error(`Extracted deb is missing a real directory: ${dir}`)
    }
  }
  const asarStat = await assertOwnedRegularFile(appAsarPath)
  const asarSha256 = await fileSha256(appAsarPath)
  if (asarSha256 !== ORCA_APP_ASAR_SHA256) {
    throw new Error(`app.asar checksum mismatch: expected ${ORCA_APP_ASAR_SHA256}, got ${asarSha256}`)
  }
  return {
    appAsarSize: asarStat.size,
    debSha256,
    debSize: ORCA_DEB_SIZE,
    debUrl: ORCA_DEB_URL,
    ...control
  }
}

export async function acquireAndExtractDeb({
  debPath,
  extractDir,
  signal,
  allowDownload = false,
  timeoutMs = 120000,
  fetchImpl
} = {}) {
  if (typeof extractDir !== 'string' || !extractDir.startsWith('/')) {
    throw new Error(`extractDir must be absolute: ${extractDir}`)
  }
  await assertNoSymlinkAncestors(extractDir)
  if (await lstatOrNull(extractDir)) {
    throw new Error(`Refusing to reuse or overwrite an existing extraction: ${extractDir}`)
  }
  await ensurePrivateDirTree(dirname(extractDir))

  let resolvedDeb = debPath
  if (!resolvedDeb) {
    if (!allowDownload) throw new Error('debPath is required when download is not permitted')
    resolvedDeb = join(dirname(extractDir), ORCA_DEB_FILENAME)
    if (!(await lstatOrNull(resolvedDeb))) {
      await downloadDebArchive({ destination: resolvedDeb, signal, fetchImpl })
    }
  }

  const debSha256 = await verifyDebHash(resolvedDeb)
  const control = await readDebControl({ debPath: resolvedDeb, signal })

  const stagingDir = join(dirname(extractDir), `.extract-${basename(extractDir)}-${process.pid}-${randomUUID()}`)
  await assertNoSymlinkAncestors(stagingDir)
  await mkdir(stagingDir, { recursive: false, mode: 0o700 })
  try {
    const res = await runBoundedProcess({
      command: 'dpkg-deb',
      args: ['-x', resolvedDeb, stagingDir],
      timeoutMs,
      signal,
      maxStdoutBytes: 1024 * 1024,
      maxStderrBytes: 65536
    })
    if (res.code !== 0) {
      throw new Error(`dpkg-deb -x failed with code ${res.code}: ${res.stderr}`)
    }
    const source = await assertRequiredSource(stagingDir, debSha256, control)
    if (await lstatOrNull(extractDir)) {
      throw new Error(`Refusing to overwrite an extraction created concurrently: ${extractDir}`)
    }
    await rename(stagingDir, extractDir)
    return {
      ...source,
      templateDir: join(extractDir, ORCA_DEB_TEMPLATE_DIR),
      webDir: join(extractDir, ORCA_DEB_WEB_DIR),
      appAsarPath: join(extractDir, ORCA_APP_ASAR_PATH)
    }
  } finally {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
  }
}
