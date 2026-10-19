/**
 * Strict validation of the upstream orcad-template manifest.
 *
 * The manifest is one release contract: schema 3, plain objects only, safe
 * relative paths, SHA-256 digests, the exact upstream common list, exactly the
 * five linux-x64-glibc target files, and no target key that shadows a common
 * key. The final slot is always 175 files.
 */

import {
  ORCAD_COMMON_FILES,
  ORCAD_SLOT_FILE_COUNT,
  ORCAD_TARGET_FILES,
  PINNED_NODE,
  SUPPORTED_TARGET,
  isSupportedTarget
} from './constants.mjs'
import { isSafeRelativePath } from './safe-paths.mjs'

const SHA256_RE = /^[a-f0-9]{64}$/
const MOBILE_PREFIX = 'out/mobile-web/'
const MANIFEST_NAME = 'out/mobile-web/manifest.json'
const WATCHER_ENTRY_NAME = 'node_modules/@parcel/watcher/index.js'

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function assertDigest(name, digest, label) {
  if (typeof digest !== 'string' || !SHA256_RE.test(digest)) {
    throw new Error(`Missing or invalid digest for ${label}: ${name}`)
  }
}

export function verifyManifestSchema(manifest) {
  if (!isPlainObject(manifest)) throw new Error('Invalid manifest: root must be an object')
  if (manifest.schemaVersion !== 3) {
    throw new Error(`Unsupported schema version: ${manifest.schemaVersion}, expected 3`)
  }
  if (!isPlainObject(manifest.commonSha256)) {
    throw new Error('Invalid manifest: commonSha256 must be an object')
  }
  if (!isPlainObject(manifest.targets)) {
    throw new Error('Invalid manifest: targets must be an object')
  }
  for (const [name, digest] of Object.entries(manifest.commonSha256)) {
    if (!isSafeRelativePath(name)) throw new Error(`Unsafe manifest path: ${name}`)
    assertDigest(name, digest, 'common file')
  }
  for (const [targetName, target] of Object.entries(manifest.targets)) {
    if (!isSafeRelativePath(targetName)) throw new Error(`Unsafe target name: ${targetName}`)
    if (!isPlainObject(target) || !isPlainObject(target.files)) {
      throw new Error(`Invalid manifest target: ${targetName}`)
    }
    for (const [name, digest] of Object.entries(target.files)) {
      if (!isSafeRelativePath(name)) throw new Error(`Unsafe target path: ${name}`)
      assertDigest(name, digest, `target ${targetName} file`)
    }
  }
}

function assertExactSet(actual, expected, label) {
  const actualSet = new Set(actual)
  const expectedSet = new Set(expected)
  for (const name of expectedSet) {
    if (!actualSet.has(name)) throw new Error(`Manifest is missing ${label}: ${name}`)
  }
  for (const name of actualSet) {
    if (!expectedSet.has(name)) throw new Error(`Manifest has an unexpected ${label}: ${name}`)
  }
}

function mobileAssets(manifest) {
  return Object.keys(manifest.commonSha256)
    .filter((name) => name.startsWith(MOBILE_PREFIX) && name !== MANIFEST_NAME)
    .sort(compareCodeUnits)
}

/**
 * Upstream artifact identity order (`orcadArtifactFilenames` in
 * src/shared/orcad-artifacts.ts): the common artifacts with the three
 * target-only common positions interleaved where upstream lists them, then the
 * native PTY and ripgrep artifacts, then the sorted mobile page assets.
 * `filenames` is the slot's file set; the result is a permutation of it.
 */
export function getUpstreamArtifactOrder(filenames) {
  const [serverTarget, runtimeMarker, watcherNative, ptyNative, ripgrep] = ORCAD_TARGET_FILES
  const mobile = filenames
    .filter((name) => name.startsWith(MOBILE_PREFIX) && name !== MANIFEST_NAME)
    .sort(compareCodeUnits)
  const order = []
  for (const name of ORCAD_COMMON_FILES) {
    if (name === WATCHER_ENTRY_NAME) order.push(serverTarget, runtimeMarker, name, watcherNative)
    else if (name === MANIFEST_NAME) order.push(name, ptyNative, ripgrep)
    else order.push(name)
  }
  order.push(...mobile)
  const expected = new Set(filenames)
  const isPermutation =
    order.length === filenames.length &&
    new Set(order).size === order.length &&
    order.every((name) => expected.has(name))
  if (!isPermutation) throw new Error('Upstream artifact order is not a permutation of the slot files')
  return order
}

export function getSlotArtifactFilenames(target, manifest) {
  if (!isSupportedTarget(target)) throw new Error(`Unsupported target: ${target}`)
  verifyManifestSchema(manifest)
  const mobile = mobileAssets(manifest)
  assertExactSet(Object.keys(manifest.commonSha256), [...ORCAD_COMMON_FILES, ...mobile], 'common file')

  const targetManifest = manifest.targets[target]
  if (!targetManifest) throw new Error(`Template manifest does not support target: ${target}`)
  assertExactSet(Object.keys(targetManifest.files), ORCAD_TARGET_FILES, 'target file')
  for (const name of ORCAD_TARGET_FILES) {
    if (Object.hasOwn(manifest.commonSha256, name)) {
      throw new Error(`Target file must not shadow a common file: ${name}`)
    }
  }

  const filenames = [...ORCAD_COMMON_FILES, ...ORCAD_TARGET_FILES, ...mobile]
  if (filenames.length !== ORCAD_SLOT_FILE_COUNT) {
    throw new Error(
      `Slot file contract mismatch: expected ${ORCAD_SLOT_FILE_COUNT}, got ${filenames.length}`
    )
  }
  return filenames
}

export function verifyTargetMarkers({
  serverTarget,
  runtimeNodeSha256,
  target = SUPPORTED_TARGET,
  expectedNodeSha256 = PINNED_NODE.executableSha256
}) {
  if (serverTarget.trim() !== target) {
    throw new Error(`Target identity mismatch: expected ${target}, got ${serverTarget.trim()}`)
  }
  if (runtimeNodeSha256.trim() !== expectedNodeSha256) {
    throw new Error(
      `Runtime node pin mismatch: expected ${expectedNodeSha256}, got ${runtimeNodeSha256.trim()}`
    )
  }
}
