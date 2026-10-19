import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ORCAD_COMMON_FILES,
  ORCAD_SLOT_FILE_COUNT,
  ORCAD_TARGET_FILES,
  ORCAD_VERSION,
  ORCAD_VERSION_FILENAME,
  SUPPORTED_TARGET
} from './constants.mjs'
import { materializeOrcadSlot, verifySlotIntegrity } from './materializer.mjs'
import { buildTemplate, mobileNames, scratch } from './materializer-fixtures.mjs'

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

  it('derives fullVersion from the upstream raw-byte artifact identity (independent oracle)', async () => {
    const root = await scratch('version-oracle')
    try {
      const { templateDir } = await buildTemplate(root)
      const result = await materializeOrcadSlot({
        templateDir,
        outputSlotDir: join(root, 'slot'),
        target: SUPPORTED_TARGET
      })

      // Independent oracle: replicate orcad-artifact-identity.ts here (raw byte
      // concatenation in orcadArtifactFilenames order) without calling the
      // production order helper, then compare.
      const watcherEntry = 'node_modules/@parcel/watcher/index.js'
      const manifestName = 'out/mobile-web/manifest.json'
      const [serverTarget, runtimeMarker, watcherNative, ptyNative, ripgrep] = ORCAD_TARGET_FILES
      const order = []
      for (const name of ORCAD_COMMON_FILES) {
        if (name === watcherEntry) order.push(serverTarget, runtimeMarker, name, watcherNative)
        else if (name === manifestName) order.push(name, ptyNative, ripgrep)
        else order.push(name)
      }
      order.push(...mobileNames().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))

      const hash = createHash('sha256')
      for (const name of order) hash.update(await readFile(join(result.slotDir, name)))
      const digest = hash.digest('hex')

      assert.equal(result.artifactSha256, digest)
      assert.equal(result.fullVersion, `${ORCAD_VERSION}+${digest.slice(0, 12)}`)
      // The upstream version must not be the internal tree digest.
      assert.notEqual(result.fullVersion, `${ORCAD_VERSION}+${result.treeSha256.slice(0, 12)}`)
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
