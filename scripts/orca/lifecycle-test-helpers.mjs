import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchOrcadServer } from './lifecycle.mjs'
import { ensureIsolatedDirectories, createIsolatedEnv } from './env.mjs'

export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
export const FAKE_SERVER = join(FIXTURES, 'fake-orcad-server.mjs')
export const DAEMON_ENTRY = join(FIXTURES, 'daemon-entry.js')
export const NODE = process.execPath

export function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function waitGone(pid, timeoutMs = 4000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (!alive(pid)) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return !alive(pid)
}

export async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

export async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'orca-lifecycle-'))
  await ensureIsolatedDirectories(root)
  return root
}

export async function launch(root, extra = {}) {
  const port = extra.port ?? (await freePort())
  const env = {
    ...createIsolatedEnv({ scratchDir: root }),
    FAKE_DAEMON_ENTRY: DAEMON_ENTRY,
    FAKE_ADVERTISED: `ws://127.0.0.1:${port}`,
    ...(extra.env || {})
  }
  return launchOrcadServer({
    nodeBinary: NODE,
    slotDir: FIXTURES,
    serverEntry: FAKE_SERVER,
    daemonEntryPath: DAEMON_ENTRY,
    options: {
      bind: '127.0.0.1',
      port,
      allowLoopbackAdvertised: true,
      ...(extra.options || {})
    },
    env,
    managedRoot: root,
    privateStatusPath: extra.privateStatusPath ?? join(root, 'private-status.json'),
    runtimeIdentityPath: extra.runtimeIdentityPath ?? join(root, 'runtime-identity.json'),
    timeoutMs: extra.timeoutMs ?? extra.options?.timeoutMs ?? 5000,
    signal: extra.signal
  })
}

export async function recordedDaemonPid(root) {
  const dir = join(root, 'runtime', 'user-data', 'daemon')
  const files = await readdir(dir).catch(() => [])
  const pidFile = files.find((f) => /^daemon-v\d+\.pid$/.test(f))
  if (!pidFile) return null
  const raw = await readFile(join(dir, pidFile), 'utf8')
  let pid
  try {
    pid = JSON.parse(raw).pid
  } catch {
    pid = Number(raw.trim())
  }
  return Number.isInteger(pid) && pid > 1 ? pid : null
}
