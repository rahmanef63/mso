import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import {
  ORCAD_COMMON_FILES,
  ORCAD_SERVER_TARGET_FILENAME,
  ORCAD_NODE_RUNTIME_MARKER_FILENAME,
  ORCAD_TARGET_FILES,
  ORCAD_SLOT_FILE_COUNT,
  ORCAD_VERSION,
  ORCAD_VERSION_FILENAME,
  PINNED_NODE,
  SUPPORTED_TARGET
} from './constants.mjs'
import {
  getSlotArtifactFilenames,
  isSafePathSegment,
  materializeOrcadSlot,
  verifyManifestSchema,
  verifySlotIntegrity,
  verifyTargetMarkers
} from './materializer.mjs'

const sha256 = (text) => createHash('sha256').update(text).digest('hex')
const MOBILE_COUNT = ORCAD_SLOT_FILE_COUNT - ORCAD_COMMON_FILES.length - ORCAD_TARGET_FILES.length

async function scratch(name) {
  const dir = join(tmpdir(), `orca-mat-${name}-${randomUUID()}`)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  return dir
}

async function writeSourceFile(root, rel, content) {
  const filePath = join(root, rel)
  await mkdir(join(filePath, '..'), { recursive: true })
  await writeFile(filePath, content)
  return sha256(content)
}

function mobileNames() {
  return Array.from({ length: MOBILE_COUNT }, (_, i) => `out/mobile-web/asset-${String(i).padStart(3, '0')}.txt`)
}

async function buildTemplate(root) {
  const templateDir = join(root, 'template')
  const targetDir = join(templateDir, 'targets', SUPPORTED_TARGET)
  await mkdir(targetDir, { recursive: true, mode: 0o700 })
  const commonSha256 = {}
  for (const name of ORCAD_COMMON_FILES) {
    commonSha256[name] = await writeSourceFile(templateDir, name, `common:${name}\n`)
  }
  for (const name of mobileNames()) {
    commonSha256[name] = await writeSourceFile(templateDir, name, `mobile:${name}\n`)
  }
  const files = {}
  for (const name of ORCAD_TARGET_FILES) {
    let content = `target:${name}\n`
    if (name === ORCAD_SERVER_TARGET_FILENAME) content = `${SUPPORTED_TARGET}\n`
    if (name === ORCAD_NODE_RUNTIME_MARKER_FILENAME) content = `${PINNED_NODE.executableSha256}\n`
    files[name] = await writeSourceFile(targetDir, name, content)
  }
  const manifest = { schemaVersion: 3, commonSha256, targets: { [SUPPORTED_TARGET]: { files } } }
  await writeFile(
    join(templateDir, 'orcad-template.json'),
    JSON.stringify(manifest, null, 2),
    { mode: 0o600 }
  )
  return { templateDir, manifest }
}

describe('materializer manifest contract', () => {
  it('rejects unsafe path segments', () => {
    for (const bad of ['../etc/passwd', '/abs', 'foo/../../bar', 'foo/./bar', '', 'foo\\bar', 'foo//bar', 'a/\x00/b']) {
      assert.equal(isSafePathSegment(bad), false, bad)
    }
    assert.equal(isSafePathSegment('valid/file.js'), true)
    assert.equal(isSafePathSegment('.server-target'), true)
  })

  it('rejects malformed manifest roots and digests', async () => {
    const root = await scratch('schema')
    try {
      const { manifest } = await buildTemplate(root)
      assert.throws(() => verifyManifestSchema(null), /invalid manifest/i)
      assert.throws(() => verifyManifestSchema([]), /invalid manifest/i)
      assert.throws(() => verifyManifestSchema({ schemaVersion: 2, commonSha256: {}, targets: {} }), /unsupported schema/i)
      assert.throws(() => verifyManifestSchema({ schemaVersion: 3, targets: {} }), /commonSha256/i)
      assert.throws(() => verifyManifestSchema({ schemaVersion: 3, commonSha256: [], targets: {} }), /commonSha256/i)
      assert.throws(
        () => verifyManifestSchema({ ...manifest, commonSha256: { ...manifest.commonSha256, 'out/x.js': 'nothex' } }),
        /invalid digest/i
      )
      assert.throws(
        () => verifyManifestSchema({ ...manifest, commonSha256: { ...manifest.commonSha256, 'out/../x.js': 'a'.repeat(64) } }),
        /unsafe manifest path/i
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('enforces the exact common/target file contract', async () => {
    const root = await scratch('contract')
    try {
      const { manifest } = await buildTemplate(root)
      const names = getSlotArtifactFilenames(SUPPORTED_TARGET, manifest)
      assert.equal(names.length, ORCAD_SLOT_FILE_COUNT)
      assert.equal(new Set(names).size, ORCAD_SLOT_FILE_COUNT)

      const withExtraTarget = JSON.parse(JSON.stringify(manifest))
      withExtraTarget.targets[SUPPORTED_TARGET].files['orcad-server.js'] = sha256('x')
      assert.throws(
        () => getSlotArtifactFilenames(SUPPORTED_TARGET, withExtraTarget),
        /unexpected target file/i
      )

      const missingTarget = JSON.parse(JSON.stringify(manifest))
      delete missingTarget.targets[SUPPORTED_TARGET].files[ORCAD_TARGET_FILES[0]]
      assert.throws(
        () => getSlotArtifactFilenames(SUPPORTED_TARGET, missingTarget),
        /missing target file/i
      )

      const shadowed = JSON.parse(JSON.stringify(manifest))
      shadowed.commonSha256['.server-target'] = sha256('x')
      assert.throws(
        () => getSlotArtifactFilenames(SUPPORTED_TARGET, shadowed),
        /unexpected common file/i
      )

      assert.throws(() => getSlotArtifactFilenames('darwin-arm64', manifest), /unsupported target/i)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('checks target marker identity', () => {
    assert.doesNotThrow(() =>
      verifyTargetMarkers({
        serverTarget: 'linux-x64-glibc',
        runtimeNodeSha256: PINNED_NODE.executableSha256
      })
    )
    assert.throws(
      () => verifyTargetMarkers({ serverTarget: 'linux-arm64', runtimeNodeSha256: PINNED_NODE.executableSha256 }),
      /target identity mismatch/i
    )
    assert.throws(
      () => verifyTargetMarkers({ serverTarget: 'linux-x64-glibc', runtimeNodeSha256: 'deadbeef'.repeat(8) }),
      /runtime node pin mismatch/i
    )
  })
})

describe('materializer filesystem behavior', () => {
  it('materializes the exact 175-file slot and preserves unrelated state', async () => {
    const root = await scratch('slot')
    try {
      const { templateDir } = await buildTemplate(root)
      const sentinel = join(root, 'out', 'user-state.txt')
      await mkdir(join(root, 'out'), { recursive: true, mode: 0o700 })
      await writeFile(sentinel, 'keep me')

      const result = await materializeOrcadSlot({
        templateDir,
        outputSlotDir: join(root, 'out', 'slot'),
        target: SUPPORTED_TARGET
      })
      assert.equal(result.reused, false)
      assert.equal(result.fullVersion.startsWith(`${ORCAD_VERSION}+`), true)
      assert.equal(Object.keys(result.files).length, ORCAD_SLOT_FILE_COUNT)
      const version = await readFile(join(result.slotDir, ORCAD_VERSION_FILENAME), 'utf8')
      assert.equal(version.trim(), result.fullVersion)
      assert.equal(await readFile(sentinel, 'utf8'), 'keep me')

      const reuse = await materializeOrcadSlot({
        templateDir,
        outputSlotDir: join(root, 'out', 'slot'),
        target: SUPPORTED_TARGET
      })
      assert.equal(reuse.reused, true)
      assert.equal(reuse.treeSha256, result.treeSha256)

      const isIntact = await verifySlotIntegrity(
        result.slotDir,
        new Map(Object.entries(result.files).map(([name, sha]) => [name, { sha }])),
        { expectedVersion: result.fullVersion, exactFileSet: true }
      )
      assert.equal(isIntact, true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses a tampered existing slot instead of overwriting it', async () => {
    const root = await scratch('tamper')
    try {
      const { templateDir } = await buildTemplate(root)
      const outputSlotDir = join(root, 'slot')
      const first = await materializeOrcadSlot({ templateDir, outputSlotDir, target: SUPPORTED_TARGET })
      const victim = join(first.slotDir, 'orcad-server.js')
      await writeFile(victim, 'tampered')
      await assert.rejects(
        materializeOrcadSlot({ templateDir, outputSlotDir, target: SUPPORTED_TARGET }),
        /refusing to overwrite/i
      )
      assert.equal(await readFile(victim, 'utf8'), 'tampered')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses a torn/partial existing slot', async () => {
    const root = await scratch('torn')
    try {
      const { templateDir } = await buildTemplate(root)
      const outputSlotDir = join(root, 'torn')
      await mkdir(outputSlotDir, { recursive: true, mode: 0o700 })
      await writeFile(join(outputSlotDir, ORCAD_VERSION_FILENAME), `${ORCAD_VERSION}+torn\n`)
      await assert.rejects(
        materializeOrcadSlot({ templateDir, outputSlotDir, target: SUPPORTED_TARGET }),
        /refusing to overwrite/i
      )
      assert.equal(await readFile(join(outputSlotDir, ORCAD_VERSION_FILENAME), 'utf8'), `${ORCAD_VERSION}+torn\n`)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a symlinked template source and a symlinked source file', async () => {
    const root = await scratch('symlink')
    try {
      const { templateDir } = await buildTemplate(root)
      await symlink(templateDir, join(root, 'template-link'))
      await assert.rejects(
        materializeOrcadSlot({
          templateDir: join(root, 'template-link'),
          outputSlotDir: join(root, 'slot-a'),
          target: SUPPORTED_TARGET
        }),
        /symlink/i
      )

      const realFile = join(templateDir, 'orcad-server.js')
      const saved = await readFile(realFile)
      await rm(realFile)
      const target = join(root, 'elsewhere.js')
      await writeFile(target, saved)
      await symlink(target, realFile)
      await assert.rejects(
        materializeOrcadSlot({
          templateDir,
          outputSlotDir: join(root, 'slot-b'),
          target: SUPPORTED_TARGET
        }),
        /symlink/i
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('produces a deterministic slot digest', async () => {
    const root = await scratch('digest')
    try {
      const { templateDir } = await buildTemplate(root)
      const a = await materializeOrcadSlot({ templateDir, outputSlotDir: join(root, 'a'), target: SUPPORTED_TARGET })
      const b = await materializeOrcadSlot({ templateDir, outputSlotDir: join(root, 'b'), target: SUPPORTED_TARGET })
      assert.equal(a.treeSha256, b.treeSha256)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
