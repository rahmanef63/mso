/**
 * Hardened Orca artifact materializer.
 * Enforces path safety, manifest schema v3, marker validation, symlink rejection,
 * full cache re-hashing before reuse, and atomic non-destructive publication.
 */

import { createHash, randomUUID } from 'node:crypto'
import { copyFile, chmod, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize } from 'node:path'
import {
  SUPPORTED_TARGET,
  PINNED_NODE,
  ORCAD_VERSION,
  ORCAD_SERVER_TARGET_FILENAME,
  ORCAD_NODE_RUNTIME_MARKER_FILENAME,
  ORCAD_VERSION_FILENAME,
  ORCAD_TEMPLATE_MANIFEST_FILENAME,
  ORCAD_TEMPLATE_TARGETS_DIR,
  isSupportedTarget
} from './constants.mjs'
import { fileSha256 } from './node-runtime.mjs'

const SHA256_RE = /^[a-f0-9]{64}$/
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/

const PTY_JS = [
  'package.json', 'lib/conpty_console_list_agent.js', 'lib/eventEmitter2.js',
  'lib/index.js', 'lib/interfaces.js', 'lib/shared/conout.js', 'lib/terminal.js',
  'lib/types.js', 'lib/unixTerminal.js', 'lib/utils.js', 'lib/windowsConoutConnection.js',
  'lib/windowsPtyAgent.js', 'lib/windowsTerminal.js', 'lib/worker/conoutSocketWorker.js'
].map((f) => `node_modules/node-pty/${f}`)

const RG_LICENSES = [
  'JEMALLOC-COPYING', 'LICENSE-MIT', 'LLVM-LIBUNWIND-LICENSE.TXT', 'MUSL-COPYRIGHT',
  'PCRE2-LICENCE.md', 'README.md', 'RUST-CRATE-NOTICES.txt', 'SLJIT-LICENSE', 'UNLICENSE'
].map((f) => `ripgrep/licenses/${f}`)

const BASE_ARTIFACTS = [
  'out/cli/index.js', 'out/package.json', 'orcad.js', 'orcad-server.js',
  'parcel-watcher-process-entry.js', 'daemon-entry.js',
  'profile-state-writer-worker-entry.js', 'profile-state-backup-worker-entry.js',
  'foreign-sqlite-reader-entry.js', 'port-scan-command-worker-entry.js',
  'session-scanner-service-entry.js', 'worker-thread-child-process-entry.js',
  'claude-profile-setup-worker-entry.js', '.server-target', '.runtime-node',
  'node_modules/@parcel/watcher/index.js', 'node_modules/@parcel/watcher/watcher.node',
  'node_modules/emojibase-data/en/shortcodes/emojibase.json',
  'node_modules/@linear/sdk/index.js', ...PTY_JS, ...RG_LICENSES,
  'native-chat-visuals/.claude-plugin/plugin.json',
  'native-chat-visuals/skills/orca-chat-visuals/SKILL.md',
  'out/mobile-web/manifest.json'
]

export function isSafePathSegment(relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) return false
  if (isAbsolute(relPath) || relPath.includes('\\') || CONTROL_CHAR_RE.test(relPath)) return false
  const parts = relPath.split('/')
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return false
  const normalized = normalize(relPath)
  return !normalized.startsWith('..') && normalized !== '.'
}

export function verifyManifestSchema(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Invalid manifest: root must be an object')
  }
  if (manifest.schemaVersion !== 3) {
    throw new Error(`Unsupported schema version: ${manifest.schemaVersion}, expected 3`)
  }
  if (!manifest.commonSha256 || typeof manifest.commonSha256 !== 'object' || Array.isArray(manifest.commonSha256)) {
    throw new Error('Invalid manifest: commonSha256 must be an object')
  }
  if (!manifest.targets || typeof manifest.targets !== 'object' || Array.isArray(manifest.targets)) {
    throw new Error('Invalid manifest: targets must be an object')
  }
}

export function verifyTargetMarkers({
  serverTarget,
  runtimeNodeSha256,
  target = SUPPORTED_TARGET,
  expectedNodeSha256 = PINNED_NODE.executableSha256
}) {
  if (serverTarget.trim() !== target) throw new Error(`Target identity mismatch: expected ${target}, got ${serverTarget.trim()}`)
  if (runtimeNodeSha256.trim() !== expectedNodeSha256) throw new Error(`Runtime node pin mismatch: expected ${expectedNodeSha256}, got ${runtimeNodeSha256.trim()}`)
}

export function getSlotArtifactFilenames(target, manifest) {
  const prefix = 'out/mobile-web/'
  const mobileWebAssets = Object.keys(manifest.commonSha256)
    .filter((f) => f.startsWith(prefix) && f !== 'out/mobile-web/manifest.json')
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return [
    ...BASE_ARTIFACTS,
    'node_modules/node-pty/build/Release/pty.node',
    'ripgrep/linux-x64/rg',
    ...mobileWebAssets
  ]
}

export async function verifySlotIntegrity(slotDir, fileMap) {
  try {
    const s = await lstat(slotDir)
    if (!s.isDirectory() || s.isSymbolicLink()) return false
    for (const [name, entry] of fileMap.entries()) {
      const p = join(slotDir, name)
      const fStat = await lstat(p)
      if (!fStat.isFile() || fStat.isSymbolicLink()) return false
      const h = await fileSha256(p)
      if (h !== entry.sha) return false
    }
    return true
  } catch {
    return false
  }
}

export async function materializeOrcadSlot({ templateDir, outputSlotDir, target = SUPPORTED_TARGET }) {
  if (!isSupportedTarget(target)) throw new Error(`Unsupported target: ${target}`)
  const tmplStat = await lstat(templateDir)
  if (!tmplStat.isDirectory() || tmplStat.isSymbolicLink()) throw new Error(`Template dir is invalid or symlink: ${templateDir}`)

  const manifest = JSON.parse(await readFile(join(templateDir, ORCAD_TEMPLATE_MANIFEST_FILENAME), 'utf8'))
  verifyManifestSchema(manifest)
  const targetManifest = manifest.targets[target]
  if (!targetManifest?.files) throw new Error(`Template manifest does not support target: ${target}`)

  const targetTemplateDir = join(templateDir, ORCAD_TEMPLATE_TARGETS_DIR, target)
  const serverTarget = await readFile(join(targetTemplateDir, ORCAD_SERVER_TARGET_FILENAME), 'utf8')
  const runtimeNode = await readFile(join(targetTemplateDir, ORCAD_NODE_RUNTIME_MARKER_FILENAME), 'utf8')
  verifyTargetMarkers({ serverTarget, runtimeNodeSha256: runtimeNode, target })

  const targetFiles = new Set(Object.keys(targetManifest.files))
  const filenames = getSlotArtifactFilenames(target, manifest)
  const fileMap = new Map()
  const combined = createHash('sha256')

  for (const name of filenames) {
    if (!isSafePathSegment(name)) throw new Error(`Unsafe path segment: ${name}`)
    const isTarget = targetFiles.has(name)
    const expectedSha = isTarget ? targetManifest.files[name] : manifest.commonSha256[name]
    if (!expectedSha || !SHA256_RE.test(expectedSha)) throw new Error(`Missing or invalid digest for ${name}`)
    const src = join(isTarget ? targetTemplateDir : templateDir, name)
    const srcStat = await lstat(src)
    if (!srcStat.isFile() || srcStat.isSymbolicLink()) throw new Error(`Source file is not a regular file: ${src}`)
    const fileBytes = await readFile(src)
    if (createHash('sha256').update(fileBytes).digest('hex') !== expectedSha) {
      throw new Error(`Checksum mismatch for ${name}`)
    }
    combined.update(fileBytes)
    fileMap.set(name, { sha: expectedSha, src, fileBytes })
  }

  const contentDigest = combined.digest('hex').slice(0, 12)
  const fullVersion = `${ORCAD_VERSION}+${contentDigest}`

  // Safe cache check: if outputSlotDir exists, rehash all files!
  try {
    const outStat = await lstat(outputSlotDir)
    if (outStat.isDirectory() && !outStat.isSymbolicLink()) {
      const vPath = join(outputSlotDir, ORCAD_VERSION_FILENAME)
      if ((await readFile(vPath, 'utf8')).trim() === fullVersion) {
        if (await verifySlotIntegrity(outputSlotDir, fileMap)) {
          return { slotDir: outputSlotDir, fullVersion }
        }
      }
    }
  } catch {}

  const stagingDir = join(dirname(outputSlotDir), `.staging-slot-${process.pid}-${randomUUID()}`)
  await mkdir(stagingDir, { recursive: true, mode: 0o700 })

  try {
    for (const [name, entry] of fileMap.entries()) {
      const dest = join(stagingDir, name)
      await mkdir(dirname(dest), { recursive: true, mode: 0o700 })
      await copyFile(entry.src, dest)
      // TOCTOU check: rehash copied file
      if ((await fileSha256(dest)) !== entry.sha) throw new Error(`TOCTOU copy corruption on ${name}`)
      if (/(?:^|\/)(?:rg|spawn-helper)$/.test(name)) await chmod(dest, 0o755)
    }

    await writeFile(join(stagingDir, ORCAD_VERSION_FILENAME), `${fullVersion}\n`, { mode: 0o600 })
    await mkdir(dirname(outputSlotDir), { recursive: true, mode: 0o700 })
    await rename(stagingDir, outputSlotDir)
    return { slotDir: outputSlotDir, fullVersion }
  } finally {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
  }
}
