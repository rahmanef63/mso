import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalDaemonSocket, discoverOwnedDaemon, verifyDaemon } from './daemon-identity.mjs'
import { ensureIsolatedDirectories } from './env.mjs'
import { readProcessIdentity, terminateVerifiedProcess } from './proc-identity.mjs'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
const FAKE_DAEMON = join(FIXTURES, 'fake-daemon.mjs')
const NODE = process.execPath

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'orca-daemon-'))
  await ensureIsolatedDirectories(root)
  return root
}

async function spawnDaemon({ socketPath, pidRecord, delayMs = 0, env = {} }) {
  const child = spawn(NODE, [FAKE_DAEMON, '--socket', socketPath, '--pid-record', pidRecord], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FAKE_DAEMON_DELAY_MS: String(delayMs), ...env }
  })
  child.stderr.resume()
  await new Promise((resolve, reject) => {
    let buffered = ''
    child.stdout.on('data', (chunk) => {
      buffered += chunk.toString('utf8')
      if (buffered.includes('ready')) resolve()
    })
    child.once('exit', () => reject(new Error('fake daemon exited before ready')))
  })
  child.stdout.resume()
  return child
}

async function stopFixture(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGKILL')
  await new Promise((resolve) => child.once('exit', resolve))
}

describe('owned daemon discovery from canonical protocol records', () => {
  it('finds a delayed canonical record despite more than eight stale entries', async () => {
    const root = await makeRoot()
    const userData = join(root, 'runtime', 'user-data')
    const daemonDir = join(userData, 'daemon')
    await mkdir(daemonDir, { recursive: true, mode: 0o700 })
    for (let version = 1; version <= 12; version += 1) {
      await writeFile(join(daemonDir, `daemon-v${version}.pid`), JSON.stringify({ pid: 999999 }))
    }
    const socketPath = join(daemonDir, 'daemon-v49.sock')
    const pidRecord = join(daemonDir, 'daemon-v49.pid')
    const child = await spawnDaemon({ socketPath, pidRecord, delayMs: 700 })
    const options = { userData, nodeBinary: NODE, daemonEntryPath: FAKE_DAEMON }
    try {
      assert.equal(await discoverOwnedDaemon({ ...options, waitMs: 100, pollMs: 25 }), null)
      const identity = await discoverOwnedDaemon({ ...options, waitMs: 3000, pollMs: 25 })
      assert.ok(identity)
      assert.equal(identity.pid, child.pid)
      assert.equal(identity.uid, process.getuid())
      assert.equal(await terminateVerifiedProcess(identity, { timeoutMs: 3000 }).then((r) => r.exited), true)
    } finally {
      await stopFixture(child)
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a non-socket protocol path even when the filename is canonical', async () => {
    const root = await makeRoot()
    const userData = join(root, 'runtime', 'user-data')
    const daemonDir = join(userData, 'daemon')
    await mkdir(daemonDir, { recursive: true, mode: 0o700 })
    const fakeSocket = join(daemonDir, 'daemon-v49.sock')
    await writeFile(fakeSocket, 'not a socket')
    try {
      assert.equal(await canonicalDaemonSocket(['--socket', fakeSocket], { userData }), null)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a protocol socket outside the private daemon directory', async () => {
    const root = await makeRoot()
    const userData = join(root, 'runtime', 'user-data')
    const foreignDir = join(userData, 'foreign')
    await mkdir(foreignDir, { recursive: true, mode: 0o700 })
    const socketPath = join(foreignDir, 'daemon-v49.sock')
    const pidRecord = join(foreignDir, 'daemon-v49.pid')
    const child = await spawnDaemon({ socketPath, pidRecord })
    try {
      const actual = await readProcessIdentity(child.pid)
      assert.ok(actual)
      assert.equal(await canonicalDaemonSocket(actual.argv, { userData }), null)
      assert.equal(await verifyDaemon(child.pid, { userData, nodeBinary: NODE, daemonEntryPath: FAKE_DAEMON }), null)
    } finally {
      await stopFixture(child)
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a canonical socket reached through a symlinked ancestor', async () => {
    const root = await makeRoot()
    const userData = join(root, 'runtime', 'user-data')
    const daemonDir = join(userData, 'daemon')
    await mkdir(daemonDir, { recursive: true, mode: 0o700 })
    const alias = join(userData, 'daemon-link')
    await symlink(daemonDir, alias)
    const socketPath = join(alias, 'daemon-v49.sock')
    const pidRecord = join(alias, 'daemon-v49.pid')
    const child = await spawnDaemon({ socketPath, pidRecord })
    try {
      const actual = await readProcessIdentity(child.pid)
      assert.ok(actual)
      assert.equal(await canonicalDaemonSocket(actual.argv, { userData }), null)
      assert.equal(await verifyDaemon(child.pid, { userData, nodeBinary: NODE, daemonEntryPath: FAKE_DAEMON }), null)
    } finally {
      await stopFixture(child)
      await rm(root, { recursive: true, force: true })
    }
  })
})
