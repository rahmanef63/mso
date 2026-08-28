// Model catalog metadata, sourced from the one fixed HTTPS models.dev endpoint.
// Lazy hierarchy: memory -> bounded private disk cache -> bounded network -> stale disk.
import { constants as fsConstants } from 'node:fs'
import { open, writeFile, rename, mkdir, chmod, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { randomBytes } from 'node:crypto'

const URL_MODELS_DEV = 'https://models.dev/api.json'
const TTL_MS = 60 * 60 * 1000
const STALE_RETRY_MS = 5 * 60 * 1000
const MAX_CATALOG_BYTES = 12 * 1024 * 1024
const CACHE_FILE = process.env.MODELS_CACHE_FILE || join(process.env.MODELS_CACHE_DIR || join(homedir(), '.models-rahmanef'), 'catalog.json')

let mem = null

function catalogObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('models.dev returned an invalid catalog')
  return value
}

async function readBoundedResponse(response) {
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > MAX_CATALOG_BYTES) throw new Error('models.dev catalog exceeds size limit')
  if (!response.body) throw new Error('models.dev returned no body')
  const reader = response.body.getReader()
  const chunks = []
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_CATALOG_BYTES) {
        await reader.cancel('catalog size limit exceeded').catch(() => {})
        throw new Error('models.dev catalog exceeds size limit')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const joined = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), bytes).toString('utf8')
  return catalogObject(JSON.parse(joined))
}

async function readDisk() {
  let handle
  try {
    handle = await open(CACHE_FILE, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_CATALOG_BYTES) return null
    const raw = JSON.parse(await handle.readFile('utf8'))
    if (raw && typeof raw.at === 'number' && raw.data) return { at: raw.at, data: catalogObject(raw.data) }
  } catch { /* no cache yet / corrupt / symlink */ }
  finally { await handle?.close().catch(() => {}) }
  return null
}

async function writeDisk(entry) {
  const dir = dirname(CACHE_FILE)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await chmod(dir, 0o700).catch(() => {})
  const tmp = `${CACHE_FILE}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
  try {
    await writeFile(tmp, JSON.stringify(entry), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await rename(tmp, CACHE_FILE)
  } finally {
    await rm(tmp, { force: true }).catch(() => {})
  }
}

/** @returns {Promise<Record<string, {models: Record<string, any>}>>} */
export async function getCatalog({ force = false } = {}) {
  const now = Date.now()
  if (!force && mem && now - mem.at < TTL_MS) return mem.data
  if (!force) {
    const disk = await readDisk()
    if (disk && now - disk.at < TTL_MS) { mem = disk; return disk.data }
  }
  try {
    const res = await fetch(URL_MODELS_DEV, {
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: { accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`models.dev HTTP ${res.status}`)
    const data = await readBoundedResponse(res)
    mem = { at: now, data }
    await writeDisk(mem).catch(() => {})
    return data
  } catch (err) {
    const disk = await readDisk()
    if (disk) { mem = { at: now - (TTL_MS - STALE_RETRY_MS), data: disk.data }; return disk.data }
    throw err
  }
}

/** Flatten catalog into `{ ref: "provider/model", provider, ...meta }[]`. */
export async function listModels(opts) {
  const cat = await getCatalog(opts)
  const out = []
  for (const [pid, provider] of Object.entries(cat)) {
    if (!provider || typeof provider !== 'object' || Array.isArray(provider)) continue
    for (const [mid, model] of Object.entries(provider.models || {})) {
      if (!model || typeof model !== 'object' || Array.isArray(model)) continue
      out.push({ ref: `${pid}/${mid}`, provider: pid, ...model })
    }
  }
  return out
}
