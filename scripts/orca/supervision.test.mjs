import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, lstat, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runSupervisedRuntime } from './supervision.mjs'
import { launchOrcadServer } from './lifecycle.mjs'
import { discoverOwnedDaemon } from './daemon-identity.mjs'
import { ensureIsolatedDirectories } from './env.mjs'
import { terminateVerifiedProcess } from './proc-identity.mjs'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
const FAKE_SERVER = join(FIXTURES, 'fake-orcad-server.mjs')
const DAEMON_ENTRY = join(FIXTURES, 'daemon-entry.js')
const NODE = process.execPath

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'orca-supervision-'))
  await ensureIsolatedDirectories(root)
  const webDir = join(root, 'web')
  await mkdir(webDir, { mode: 0o700 })
  await writeFile(join(webDir, 'web-index.html'), '<!doctype html><title>fixture</title>')
  return root
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

async function waitForPids(root, timeoutMs = 4000) {
  const file = join(root, 'runtime', 'user-data', 'fake-pids.json')
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      return JSON.parse(await readFile(file, 'utf8'))
    } catch {
      if (Date.now() >= deadline) throw new Error('fake pids were not written')
      await sleep(25)
    }
  }
}

async function waitGone(pid, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      process.kill(pid, 0)
      if (Date.now() >= deadline) return false
      await sleep(25)
    } catch {
      return true
    }
  }
}

function launchFor(mode, env = {}) {
  return (options) =>
    launchOrcadServer({
      ...options,
      serverEntry: FAKE_SERVER,
      daemonEntryPath: DAEMON_ENTRY,
      env: { ...options.env, FAKE_MODE: mode, ...env }
    })
}

function baseOptions(root, port, mode, env) {
  const logs = []
  return {
    release: { slotDir: FIXTURES, nodeBinary: NODE, webDir: join(root, 'web') },
    managedRoot: root,
    port,
    advertisedEndpoint: 'wss://orca-supervision-proof.invalid',
    timeoutMs: 6000,
    log: { log: (line) => logs.push(line) },
    launch: launchFor(mode, env),
    logs
  }
}

async function cleanupDaemon(root) {
  const userData = join(root, 'runtime', 'user-data')
  const identity = await discoverOwnedDaemon({
    userData,
    nodeBinary: NODE,
    daemonEntryPath: DAEMON_ENTRY,
    waitMs: 1000
  })
  if (identity) await terminateVerifiedProcess(identity, { timeoutMs: 3000 })
}

describe('supervised wrapper signal and child-exit supervision', () => {
  it('cancels a delayed startup through AbortSignal and reaps the owned child/daemon', async () => {
    const root = await makeRoot()
    const port = await freePort()
    try {
      const promise = runSupervisedRuntime(baseOptions(root, port, 'delayed-ready', { FAKE_READY_DELAY_MS: '1500' }))
      const pids = await waitForPids(root)
      process.emit('SIGTERM', 'SIGTERM')
      await assert.rejects(promise, /cancelled by SIGTERM/i)
      assert.equal(await waitGone(pids.serverPid), true)
      assert.equal(await waitGone(pids.daemonPid), true)
      await assert.rejects(lstat(join(root, 'private-status.json')))
      await assert.rejects(lstat(join(root, 'runtime-identity.json')))
    } finally {
      await cleanupDaemon(root).catch(() => {})
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails the wrapper on an unexpected child exit, clears receipts, and preserves restart state', async () => {
    const root = await makeRoot()
    const port = await freePort()
    try {
      await assert.rejects(
        () => runSupervisedRuntime(baseOptions(root, port, 'crash-after-ready', { FAKE_CRASH_DELAY_MS: '200' })),
        /exited unexpectedly \(code 42/i
      )
      const pids = await waitForPids(root)
      assert.equal(await waitGone(pids.serverPid), true)
      await assert.rejects(lstat(join(root, 'private-status.json')))
      await assert.rejects(lstat(join(root, 'runtime-identity.json')))
    } finally {
      await cleanupDaemon(root).catch(() => {})
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not leave a runtime alive when a startup signal lands after readiness', async () => {
    const root = await makeRoot()
    const port = await freePort()
    try {
      const options = baseOptions(root, port, 'normal')
      const realLaunch = options.launch
      options.launch = async (launchOptions) => {
        const instance = await realLaunch(launchOptions)
        process.emit('SIGTERM', 'SIGTERM')
        return instance
      }
      await assert.rejects(() => runSupervisedRuntime(options), /cancelled by SIGTERM/i)
      const pids = JSON.parse(await readFile(join(root, 'runtime', 'user-data', 'fake-pids.json'), 'utf8'))
      assert.equal(await waitGone(pids.serverPid), true)
      assert.equal(await waitGone(pids.daemonPid), true)
      await assert.rejects(lstat(join(root, 'private-status.json')))
    } finally {
      await cleanupDaemon(root).catch(() => {})
      await rm(root, { recursive: true, force: true })
    }
  })

  it('handles SIGTERM after readiness and reports verified daemon preservation', async () => {
    const root = await makeRoot()
    const port = await freePort()
    try {
      const options = baseOptions(root, port, 'normal')
      const promise = runSupervisedRuntime(options)
      const deadline = Date.now() + 5000
      while (!options.logs.some((line) => line.includes('Runtime ready'))) {
        if (Date.now() >= deadline) throw new Error('runtime did not report readiness')
        await sleep(25)
      }
      const pids = await waitForPids(root)
      process.emit('SIGTERM', 'SIGTERM')
      const result = await promise
      assert.equal(result.signal, 'SIGTERM')
      assert.equal(result.stop.daemonPreserved, true)
      assert.equal(await waitGone(pids.serverPid), true)
      assert.equal(await waitGone(pids.daemonPid, 1000), false)
    } finally {
      await cleanupDaemon(root).catch(() => {})
      await rm(root, { recursive: true, force: true })
    }
  })
})
