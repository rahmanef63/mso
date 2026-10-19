import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ORCAD_COMMON_FILES,
  ORCAD_NODE_RUNTIME_MARKER_FILENAME,
  ORCAD_SERVER_TARGET_FILENAME,
  ORCAD_SLOT_FILE_COUNT,
  ORCAD_TARGET_FILES,
  PINNED_NODE,
  SUPPORTED_TARGET
} from './constants.mjs'

export const sha256 = (text) => createHash('sha256').update(text).digest('hex')

export const MOBILE_COUNT =
  ORCAD_SLOT_FILE_COUNT - ORCAD_COMMON_FILES.length - ORCAD_TARGET_FILES.length

export async function scratch(name) {
  const dir = join(tmpdir(), `orca-mat-${name}-${randomUUID()}`)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  return dir
}

export async function writeSourceFile(root, rel, content) {
  const filePath = join(root, rel)
  await mkdir(join(filePath, '..'), { recursive: true })
  await writeFile(filePath, content)
  return sha256(content)
}

export function mobileNames() {
  return Array.from(
    { length: MOBILE_COUNT },
    (_, i) => `out/mobile-web/asset-${String(i).padStart(3, '0')}.txt`
  )
}

export async function buildTemplate(root) {
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
  await writeFile(join(templateDir, 'orcad-template.json'), JSON.stringify(manifest, null, 2), {
    mode: 0o600
  })
  return { templateDir, manifest }
}
