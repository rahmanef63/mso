/**
 * Prepare an immutable Orca release slot plus the pinned Node runtime.
 * The caller supplies either an already-extracted template/web pair or a
 * verified deb; downloads stay disabled unless explicitly allowed.
 */

import { existsSync } from 'node:fs'
import { copyFile, chmod, mkdir, symlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  PINNED_NODE,
  SUPPORTED_TARGET,
  ORCAD_RUNTIMES_DIRNAME,
  ORCAD_NODE_RUNTIME_DIR_PREFIX,
  ORCAD_NODE_RUNTIME_POSIX_EXECUTABLE
} from './constants.mjs'
import { ensureIsolatedDirectories } from './env.mjs'
import { fetchAndMaterializeNodeRuntime } from './node-runtime.mjs'
import { materializeOrcadSlot } from './materializer.mjs'
import { acquireAndExtractDeb } from './artifact-source.mjs'

export async function prepareRelease({
  debPath,
  templateDir,
  webDir,
  managedRoot,
  allowDownload = false,
  signal
} = {}) {
  if (!managedRoot) throw new Error('managedRoot is required')
  await ensureIsolatedDirectories(managedRoot)

  let resolvedTemplate = templateDir
  let resolvedWeb = webDir
  if (!resolvedTemplate || !resolvedWeb) {
    const extracted = await acquireAndExtractDeb({
      debPath,
      extractDir: join(managedRoot, 'upstream-extracted'),
      allowDownload,
      signal
    })
    resolvedTemplate = extracted.templateDir
    resolvedWeb = extracted.webDir
  }

  const slotsRoot = join(managedRoot, 'slots', SUPPORTED_TARGET)
  const runtimesRoot = join(slotsRoot, ORCAD_RUNTIMES_DIRNAME)
  const nodeBinary = await fetchAndMaterializeNodeRuntime({
    target: SUPPORTED_TARGET,
    runtimesDir: runtimesRoot,
    allowDownload
  })

  const { slotDir, fullVersion } = await materializeOrcadSlot({
    templateDir: resolvedTemplate,
    outputSlotDir: join(slotsRoot, 'active'),
    target: SUPPORTED_TARGET
  })

  const slotExpectedNode = join(
    slotDir,
    '..',
    ORCAD_RUNTIMES_DIRNAME,
    `${ORCAD_NODE_RUNTIME_DIR_PREFIX}${PINNED_NODE.executableSha256}`,
    ...ORCAD_NODE_RUNTIME_POSIX_EXECUTABLE.split('/')
  )
  if (!existsSync(slotExpectedNode)) {
    await mkdir(dirname(slotExpectedNode), { recursive: true, mode: 0o700 })
    try {
      await symlink(nodeBinary, slotExpectedNode)
    } catch {
      await copyFile(nodeBinary, slotExpectedNode)
      await chmod(slotExpectedNode, 0o755)
    }
  }

  return {
    releaseRoot: managedRoot,
    slotDir,
    nodeBinary,
    version: fullVersion,
    templateDir: resolvedTemplate,
    webDir: resolvedWeb
  }
}
