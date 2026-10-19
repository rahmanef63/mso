/**
 * Release identity and integrity receipt.
 *
 * The content id is derived only from pinned release facts, so a release can
 * be located and verified before any download/extraction. Reuse always
 * re-hashes the installed slot, web bundle, Node executable, and license files;
 * a mismatch is refused, never silently repaired.
 */

import { createHash } from 'node:crypto'
import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileSha256 } from './node-runtime.mjs'
import { verifySlotIntegrity } from './materializer.mjs'
import { readPrivateJson, verifyWebTree } from './release-tree.mjs'
import { assertNoSymlinkAncestors, assertOwnedRegularFile, isSafeRelativePath } from './safe-paths.mjs'

export const RELEASE_LAYOUT = Object.freeze(['licenses', 'receipt.json', 'runtimes', 'slot', 'web'])

export function buildReceipt({ identity, slot, web }) {
  return {
    schemaVersion: 2,
    release: {
      contentId: identity.contentId,
      version: identity.version,
      orcadVersion: identity.orcadVersion,
      target: identity.target,
      sourceCommit: identity.sourceCommit,
      runtimeLayout: identity.runtimeLayout
    },
    deb: identity.deb,
    node: identity.node,
    slot: {
      treeSha256: slot.treeSha256,
      fullVersion: slot.fullVersion,
      fileCount: Object.keys(slot.files).length,
      files: slot.files
    },
    web: {
      treeSha256: web.treeSha256,
      fileCount: web.fileCount,
      totalBytes: web.totalBytes,
      files: web.files
    },
    licenses: identity.licenses.map((entry) => ({ ...entry })),
    createdAt: new Date().toISOString()
  }
}

function slotTreeSha256(files) {
  const hash = createHash('sha256')
  for (const [name, digest] of Object.entries(files)) hash.update(`${name}\0${digest}\n`)
  return hash.digest('hex')
}

function assertReceipt(receipt, identity) {
  if (!receipt || receipt.schemaVersion !== 2) throw new Error('Receipt schema is not version 2')
  const release = receipt.release
  if (!release || release.contentId !== identity.contentId) {
    throw new Error('Receipt content id does not match the pinned release')
  }
  if (release.version !== identity.version || release.sourceCommit !== identity.sourceCommit) {
    throw new Error('Receipt release identity does not match the pins')
  }
  if (receipt.node?.executablePath !== identity.node.executablePath) {
    throw new Error('Receipt Node runtime path does not match the pinned sibling layout')
  }
  if (receipt.slot?.fileCount !== Object.keys(receipt.slot?.files ?? {}).length) {
    throw new Error('Receipt slot file count is inconsistent')
  }
  if (slotTreeSha256(receipt.slot.files) !== receipt.slot.treeSha256) {
    throw new Error('Receipt slot tree digest is inconsistent')
  }
}

export async function verifyInstalledRelease({ releaseRoot, identity }) {
  await assertNoSymlinkAncestors(releaseRoot)
  const rootStat = await lstat(releaseRoot)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`Release root is not a real directory: ${releaseRoot}`)
  }
  const entries = (await readdir(releaseRoot)).sort()
  if (entries.length !== RELEASE_LAYOUT.length || entries.some((n, i) => n !== RELEASE_LAYOUT[i])) {
    throw new Error(`Release layout is not exact: ${entries.join(', ')}`)
  }

  const receiptPath = join(releaseRoot, 'receipt.json')
  const receipt = await readPrivateJson(receiptPath)
  assertReceipt(receipt, identity)

  const slotDir = join(releaseRoot, 'slot')
  const slotMap = new Map(
    Object.entries(receipt.slot.files).map(([name, digest]) => {
      if (!isSafeRelativePath(name)) throw new Error(`Unsafe slot receipt path: ${name}`)
      return [name, { sha: digest }]
    })
  )
  if (!(await verifySlotIntegrity(slotDir, slotMap, {
    expectedVersion: receipt.slot.fullVersion,
    exactFileSet: true
  }))) {
    throw new Error('Installed slot failed rehash verification')
  }

  const webDir = join(releaseRoot, 'web')
  if (!(await verifyWebTree({ dir: webDir, expected: receipt.web }))) {
    throw new Error('Installed web bundle failed rehash verification')
  }

  if (!isSafeRelativePath(identity.node.executablePath)) {
    throw new Error(`Unsafe Node runtime path: ${identity.node.executablePath}`)
  }
  const runtimesDir = join(releaseRoot, 'runtimes')
  const runtimeEntries = (await readdir(runtimesDir)).sort()
  const expectedRuntimeDir = `node-${identity.node.executableSha256}`
  if (runtimeEntries.length !== 1 || runtimeEntries[0] !== expectedRuntimeDir) {
    throw new Error(`Release runtimes layout is not exact: ${runtimeEntries.join(', ')}`)
  }
  const nodeBinary = join(releaseRoot, identity.node.executablePath)
  const nodeStat = await assertOwnedRegularFile(nodeBinary)
  if ((nodeStat.mode & 0o100) === 0) throw new Error('Installed Node executable is not executable')
  if ((await fileSha256(nodeBinary)) !== identity.node.executableSha256) {
    throw new Error('Installed Node executable failed rehash verification')
  }

  for (const entry of receipt.licenses) {
    if (!isSafeRelativePath(entry.path)) throw new Error(`Unsafe license path: ${entry.path}`)
    const licensePath = join(releaseRoot, entry.path)
    const s = await assertOwnedRegularFile(licensePath)
    if (s.size !== entry.size) throw new Error(`License size mismatch: ${entry.path}`)
    if ((await fileSha256(licensePath)) !== entry.sha256) {
      throw new Error(`License checksum mismatch: ${entry.path}`)
    }
  }

  return {
    releaseRoot,
    slotDir,
    nodeBinary,
    webDir,
    version: identity.version,
    receipt,
    receiptPath
  }
}
