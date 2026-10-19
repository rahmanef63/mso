/**
 * Slot materialization from an already verified Orca template directory: the
 * full per-file contract, symlink/ownership/path safety, a destination TOCTOU
 * re-hash, the upstream raw-byte artifact identity, and publish-or-refuse.
 */

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, chmod, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  ORCAD_NODE_RUNTIME_MARKER_FILENAME,
  ORCAD_SERVER_TARGET_FILENAME,
  ORCAD_SLOT_FILE_COUNT,
  ORCAD_TEMPLATE_MANIFEST_FILENAME,
  ORCAD_TEMPLATE_TARGETS_DIR,
  ORCAD_VERSION,
  ORCAD_VERSION_FILENAME,
  SUPPORTED_TARGET
} from './constants.mjs'
import { fileSha256 } from './node-runtime.mjs'
import {
  getSlotArtifactFilenames,
  getUpstreamArtifactOrder,
  verifyManifestSchema,
  verifyTargetMarkers
} from './slot-manifest.mjs'
import {
  assertNoSymlinkAncestors,
  ensurePrivateDirTree,
  isSafeRelativePath,
  lstatOrNull
} from './safe-paths.mjs'

export { getSlotArtifactFilenames, verifyManifestSchema, verifyTargetMarkers }

const MAX_MANIFEST_BYTES = 1024 * 1024
const EXECUTABLE_SLOT_FILES = new Set(['ripgrep/linux-x64/rg'])

export const isSafePathSegment = isSafeRelativePath

async function assertRealDir(dir, label) {
  await assertNoSymlinkAncestors(dir)
  const s = await lstatOrNull(dir)
  if (!s || !s.isDirectory() || s.isSymbolicLink()) {
    throw new Error(`${label} is not a real directory: ${dir}`)
  }
}

async function readSmallFile(filePath, label) {
  await assertNoSymlinkAncestors(filePath)
  const s = await lstatOrNull(filePath)
  if (!s || !s.isFile() || s.isSymbolicLink()) {
    throw new Error(`${label} is not a regular file: ${filePath}`)
  }
  if (s.size > MAX_MANIFEST_BYTES) throw new Error(`${label} is unexpectedly large: ${filePath}`)
  return readFile(filePath)
}

async function collectRegularFiles(root, rel = '') {
  const entries = await readdir(join(root, rel), { withFileTypes: true })
  const out = []
  for (const entry of entries) {
    const next = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isSymbolicLink()) throw new Error(`Refusing symlink in slot: ${next}`)
    if (entry.isDirectory()) out.push(...(await collectRegularFiles(root, next)))
    else if (entry.isFile()) {
      if (next !== ORCAD_VERSION_FILENAME) out.push(next)
    } else throw new Error(`Refusing non-regular slot entry: ${next}`)
  }
  return out
}

export async function verifySlotIntegrity(slotDir, fileMap, { expectedVersion, exactFileSet } = {}) {
  try {
    const s = await lstat(slotDir)
    if (!s.isDirectory() || s.isSymbolicLink()) return false
    await assertNoSymlinkAncestors(slotDir)
    for (const [name, entry] of fileMap.entries()) {
      if (!isSafeRelativePath(name)) return false
      const filePath = join(slotDir, name)
      await assertNoSymlinkAncestors(filePath)
      const f = await lstat(filePath)
      if (!f.isFile() || f.isSymbolicLink()) return false
      if ((await fileSha256(filePath)) !== entry.sha) return false
    }
    if (expectedVersion !== undefined) {
      const v = await readFile(join(slotDir, ORCAD_VERSION_FILENAME), 'utf8')
      if (v.trim() !== expectedVersion) return false
    }
    if (exactFileSet) {
      const actual = (await collectRegularFiles(slotDir)).sort()
      const expected = [...fileMap.keys()].sort()
      if (actual.length !== expected.length) return false
      if (actual.some((name, i) => name !== expected[i])) return false
    }
    return true
  } catch {
    return false
  }
}

function slotTreeSha256(filenames, fileMap) {
  const hash = createHash('sha256')
  for (const name of filenames) hash.update(`${name}\0${fileMap.get(name).sha}\n`)
  return hash.digest('hex')
}

function filesObject(fileMap) {
  return Object.fromEntries([...fileMap.entries()].map(([name, entry]) => [name, entry.sha]))
}

export async function materializeOrcadSlot({
  templateDir,
  outputSlotDir,
  target = SUPPORTED_TARGET
} = {}) {
  if (typeof templateDir !== 'string' || !templateDir.startsWith('/')) {
    throw new Error(`templateDir must be absolute: ${templateDir}`)
  }
  if (typeof outputSlotDir !== 'string' || !outputSlotDir.startsWith('/')) {
    throw new Error(`outputSlotDir must be absolute: ${outputSlotDir}`)
  }
  await assertRealDir(templateDir, 'Template')
  const manifestBytes = await readSmallFile(
    join(templateDir, ORCAD_TEMPLATE_MANIFEST_FILENAME),
    'Template manifest'
  )
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  const filenames = getSlotArtifactFilenames(target, manifest)
  const targetDir = join(templateDir, ORCAD_TEMPLATE_TARGETS_DIR, target)
  await assertRealDir(targetDir, 'Target template')
  verifyTargetMarkers({
    serverTarget: (await readSmallFile(join(targetDir, ORCAD_SERVER_TARGET_FILENAME), 'Target marker')).toString('utf8'),
    runtimeNodeSha256: (await readSmallFile(join(targetDir, ORCAD_NODE_RUNTIME_MARKER_FILENAME), 'Node marker')).toString('utf8'),
    target
  })

  const targetFiles = manifest.targets[target].files
  const fileMap = new Map()
  for (const name of filenames) {
    const isTarget = Object.hasOwn(targetFiles, name)
    const expectedSha = isTarget ? targetFiles[name] : manifest.commonSha256[name]
    const sourcePath = join(isTarget ? targetDir : templateDir, name)
    await assertNoSymlinkAncestors(sourcePath)
    const s = await lstat(sourcePath)
    if (!s.isFile() || s.isSymbolicLink()) throw new Error(`Source file is not regular: ${name}`)
    if ((await fileSha256(sourcePath)) !== expectedSha) throw new Error(`Checksum mismatch for ${name}`)
    fileMap.set(name, { sha: expectedSha, sourcePath })
  }
  if (fileMap.size !== ORCAD_SLOT_FILE_COUNT) {
    throw new Error(`Slot file contract mismatch: expected ${ORCAD_SLOT_FILE_COUNT}, got ${fileMap.size}`)
  }
  const treeSha256 = slotTreeSha256(filenames, fileMap)
  const artifactHash = createHash('sha256')
  for (const name of getUpstreamArtifactOrder(filenames)) {
    for await (const chunk of createReadStream(fileMap.get(name).sourcePath)) artifactHash.update(chunk)
  }
  const artifactSha256 = artifactHash.digest('hex')
  const fullVersion = `${ORCAD_VERSION}+${artifactSha256.slice(0, 12)}`
  const files = filesObject(fileMap)

  if (await lstatOrNull(outputSlotDir)) {
    if (await verifySlotIntegrity(outputSlotDir, fileMap, { expectedVersion: fullVersion, exactFileSet: true })) {
      return { slotDir: outputSlotDir, fullVersion, treeSha256, artifactSha256, files, reused: true }
    }
    throw new Error(`Refusing to overwrite an existing non-matching slot: ${outputSlotDir}`)
  }

  const parent = dirname(outputSlotDir)
  await ensurePrivateDirTree(parent)
  const stagingDir = join(parent, `.staging-slot-${process.pid}-${randomUUID()}`)
  await assertNoSymlinkAncestors(stagingDir)
  await mkdir(stagingDir, { recursive: false, mode: 0o700 })
  try {
    for (const [name, entry] of fileMap.entries()) {
      const dest = join(stagingDir, name)
      await assertNoSymlinkAncestors(dest)
      await mkdir(dirname(dest), { recursive: true, mode: 0o700 })
      await copyFile(entry.sourcePath, dest)
      const mode = EXECUTABLE_SLOT_FILES.has(name) ? 0o700 : 0o600
      await chmod(dest, mode)
      if ((await fileSha256(dest)) !== entry.sha) throw new Error(`TOCTOU copy corruption on ${name}`)
    }
    await writeFile(join(stagingDir, ORCAD_VERSION_FILENAME), `${fullVersion}\n`, { mode: 0o600 })
    if (!(await verifySlotIntegrity(stagingDir, fileMap, { expectedVersion: fullVersion, exactFileSet: true }))) {
      throw new Error('Staged slot failed its own integrity verification')
    }
    if (await lstatOrNull(outputSlotDir)) {
      throw new Error(`Refusing to overwrite a slot created concurrently: ${outputSlotDir}`)
    }
    await rename(stagingDir, outputSlotDir)
    return { slotDir: outputSlotDir, fullVersion, treeSha256, artifactSha256, files, reused: false }
  } finally {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
  }
}
