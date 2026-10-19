import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, readdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchOrcadServer } from './lifecycle.mjs'
import { readProcessIdentity } from './proc-identity.mjs'
import { ensureIsolatedDirectories, createIsolatedEnv } from './env.mjs'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
const FAKE_SERVER = join(FIXTURES, 'fake-orcad-server.mjs')
const DAEMON_ENTRY = join(FIXTURES, 'hold-child.mjs')
const NODE = process.execPath

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitGone(pid, timeoutMs = 4000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (!alive(pid)) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return !alive(pid)
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'orca-lifecycle-'))
  await ensureIsolatedDirectories(root)
  return root
}

async function launch(root, extra = {}) {
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
    timeoutMs: extra.timeoutMs ?? extra.options?.timeoutMs ?? 5000
  })
}

async function recordedDaemonPid(root) {
  const dir = join(root, 'runtime', 'user-data', 'daemon')
  const files = await readdir(dir).catch(() => [])
  const pidFile = files.find((f) => /^daemon-v\d+\.pid$/.test(f))
  if (!pidFile) return null
  const pid = Number((await readFile(join(dir, pidFile), 'utf8')).trim())
  return Number.isInteger(pid) && pid > 1 ? pid : null
}

describe('supervised launch, owned identity, and scoped teardown', () => {
  it('launches a real child, publishes private receipts, and stops both owned processes', async () => {
    const root = await makeRoot()
    const instance = await launch(root)
    try {
      const serverIdentity = await readProcessIdentity(instance.child.pid)
      assert.ok(serverIdentity)
      assert.equal(instance.identity.serverPid, instance.child.pid)
      assert.equal(instance.identity.serverStartTicks, serverIdentity.startTicks)
      assert.equal(instance.identity.version, '1.4.230')
      assert.equal(instance.identity.nodeBinary, await realpath(NODE))

      assert.equal((await stat(join(root, 'private-status.json'))).mode & 0o777, 0o600)
      assert.equal((await stat(join(root, 'runtime-identity.json'))).mode & 0o777, 0o600)
      assert.equal((await readFile(join(root, 'runtime-identity.json'), 'utf8')).includes('SECRET'), false)

      assert.ok(instance.daemonIdentity)
      assert.equal(instance.daemonIdentity.uid, process.getuid())
      assert.ok(instance.daemonIdentity.argv.includes(DAEMON_ENTRY))
      assert.ok(instance.daemonIdentity.argv.some((a) => a.endsWith('daemon-v49.sock')))

      const daemonPid = instance.daemonIdentity.pid
      const result = await instance.stop({ cleanDaemon: true, timeoutMs: 4000 })
      assert.equal(result.exited, true)
      assert.equal(result.daemonExited, true)
      assert.equal(await waitGone(instance.child.pid), true)
      assert.equal(await waitGone(daemonPid), true)
    } finally {
      await instance.stop({ cleanDaemon: true, timeoutMs: 2000 }).catch(() => {})
      await rm(root, { recursive: true, force: true })
    }
  })

  it('preserves the daemon for a persistent run and only stops the server', async () => {
    const root = await makeRoot()
    const instance = await launch(root)
    const daemonPid = instance.daemonIdentity.pid
    try {
      const result = await instance.stop({ cleanDaemon: false, timeoutMs: 4000 })
      assert.equal(result.exited, true)
      assert.equal(result.daemonExited, false)
      assert.equal(await waitGone(instance.child.pid), true)
      assert.equal(alive(daemonPid), true)
    } finally {
      try { process.kill(daemonPid, 'SIGKILL') } catch {}
      await rm(root, { recursive: true, force: true })
    }
  })

  it('is idempotent and never signals a stale daemon identity', async () => {
    const root = await makeRoot()
    const instance = await launch(root)
    const daemonPid = instance.daemonIdentity.pid
    try {
      instance.daemonIdentity.startTicks = '1'
      const result = await instance.stop({ cleanDaemon: true, timeoutMs: 1000 })
      assert.equal(result.exited, true)
      assert.equal(result.daemonExited, false)
      assert.equal(alive(daemonPid), true)

      const again = await instance.stop({ cleanDaemon: true, timeoutMs: 1000 })
      assert.equal(again.exited, true)
    } finally {
      try { process.kill(daemonPid, 'SIGKILL') } catch {}
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reaps child and daemon on every failed-readiness path', async () => {
    const cases = [
      { env: { FAKE_MODE: 'forged-pid' }, match: /PID mismatch/i },
      { env: { FAKE_MODE: 'wrong-version' }, match: /buildVersion mismatch/i },
      { env: { FAKE_MODE: 'daemon-down' }, match: /daemon/i },
      { env: { FAKE_MODE: 'bad-endpoint' }, match: /advertised endpoint/i, options: { advertisedEndpoint: 'wss://orca.example.ts.net' } },
      { env: { FAKE_MODE: 'daemon-forged-pid' }, match: /daemon identity/i },
      { env: { FAKE_MODE: 'exit' }, match: /exited prematurely/i },
      { env: { FAKE_MODE: 'silent' }, match: /timed out/i, timeoutMs: 400 }
    ]
    for (const testCase of cases) {
      const root = await makeRoot()
      try {
        const before = Date.now()
        await assert.rejects(() => launch(root, testCase), testCase.match)
        assert.ok(Date.now() - before < 15000, 'failure path did not settle promptly')
        const daemonPid = await recordedDaemonPid(root)
        if (daemonPid) {
          assert.equal(await waitGone(daemonPid), true, `daemon ${daemonPid} survived ${testCase.env.FAKE_MODE}`)
        }
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  })

  it('cleans up when the private receipt write is rejected outside the managed root', async () => {
    const root = await makeRoot()
    const outside = await mkdtemp(join(tmpdir(), 'orca-outside-'))
    try {
      await assert.rejects(
        () => launch(root, { privateStatusPath: join(outside, 'status.json') }),
        /outside/i
      )
      const daemonPid = await recordedDaemonPid(root)
      if (daemonPid) assert.equal(await waitGone(daemonPid), true)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('keeps draining capped stdout after readiness instead of stalling', async () => {
    const root = await makeRoot()
    const instance = await launch(root, { env: { FAKE_MODE: 'stdout-flood' } })
    try {
      await new Promise((r) => setTimeout(r, 300))
      const result = await instance.stop({ cleanDaemon: true, timeoutMs: 4000 })
      assert.equal(result.exited, true)
      assert.equal(result.daemonExited, true)
    } finally {
      await instance.stop({ cleanDaemon: true, timeoutMs: 2000 }).catch(() => {})
      await rm(root, { recursive: true, force: true })
    }
  })

  it('caps stderr and never leaks pairing material in the failure message', async () => {
    const root = await makeRoot()
    try {
      await assert.rejects(
        () => launch(root, { env: { FAKE_MODE: 'stderr-flood' }, timeoutMs: 700 }),
        (err) => {
          assert.equal(err.message.length < 20000, true, 'error message is unbounded')
          assert.equal(err.message.includes('SECRET_PAIRING_CODE'), false)
          return /timed out|stderr|exited/i.test(err.message)
        }
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
