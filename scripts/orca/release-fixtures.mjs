import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const sha256 = (text) => createHash('sha256').update(text).digest('hex')

export async function scratch(name) {
  // mkdtemp atomically creates an owner-only (0700) directory, so the shared
  // temp root never holds a predictable name.
  return mkdtemp(join(tmpdir(), `orca-rel-${name}-`))
}

export async function writeFileAt(root, rel, content) {
  const filePath = join(root, rel)
  await mkdir(join(filePath, '..'), { recursive: true })
  await writeFile(filePath, content, { mode: 0o600 })
  return filePath
}

export function fakeAsar(entryName, data) {
  const headerJson = Buffer.from(JSON.stringify({ files: { [entryName]: { size: data.length, offset: '0' } } }))
  const headerSize = headerJson.length + 8
  const preamble = Buffer.alloc(16)
  preamble.writeUInt32LE(4, 0)
  preamble.writeUInt32LE(headerSize, 4)
  preamble.writeUInt32LE(headerJson.length, 12)
  return Buffer.concat([preamble, headerJson, data])
}
