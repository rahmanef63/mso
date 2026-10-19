import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { terminateVerifiedProcess } from './proc-identity.mjs'
import { launch, makeRoot, recordedDaemonPid, waitGone } from './lifecycle-test-helpers.mjs'

describe('retriable lifecycle teardown and receipt ownership', () => {
  it('preserves the daemon for a persistent run and only stops the server', async () => {
    const root = await makeRoot()
    const instance = await launch(root)
    const daemonIdentity = { ...instance.daemonIdentity }
    try {
      const result = await instance.stop({ cleanDaemon: false, timeoutMs: 4000 })
      assert.equal(result.exited, true)
      assert.equal(result.daemonExited, false)
      assert.equal(result.daemonPreserved, true)
      assert.equal(await waitGone(instance.child.pid), true)
      assert.equal(await waitGone(daemonIdentity.pid, 1000), false)
    } finally {
      await terminateVerifiedProcess(daemonIdentity, { timeoutMs: 3000 }).catch(() => {})
      await rm(root, { recursive: true, force: true })
    }
  })

  it('is idempotent and never signals a stale daemon identity', async () => {
    const root = await makeRoot()
    const instance = await launch(root)
    const daemonIdentity = { ...instance.daemonIdentity }
    try {
      instance.daemonIdentity.startTicks = '1'
      const result = await instance.stop({ cleanDaemon: true, timeoutMs: 1000 })
      assert.equal(result.exited, true)
      assert.equal(result.daemonExited, false)
      assert.equal(result.daemonCleanup, 'unknown')
      assert.equal(await waitGone(daemonIdentity.pid, 1000), false)

      const again = await instance.stop({ cleanDaemon: true, timeoutMs: 1000 })
      assert.equal(again.exited, true)
    } finally {
      await terminateVerifiedProcess(daemonIdentity, { timeoutMs: 3000 }).catch(() => {})
      await rm(root, { recursive: true, force: true })
    }
  })

  it('finds a delayed daemon record after an aborted startup', async () => {
    const root = await makeRoot()
    const controller = new AbortController()
    try {
      const pending = launch(root, {
        signal: controller.signal,
        env: {
          FAKE_MODE: 'delayed-ready',
          FAKE_READY_DELAY_MS: '5000',
          FAKE_DAEMON_DELAY_MS: '1200'
        }
      })
      const pidsFile = join(root, 'runtime', 'user-data', 'fake-pids.json')
      const deadline = Date.now() + 4000
      while (true) {
        try {
          await readFile(pidsFile, 'utf8')
          break
        } catch {
          if (Date.now() >= deadline) throw new Error('fake daemon was not spawned')
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
      }
      controller.abort(new Error('startup cancelled'))
      await assert.rejects(pending, /cancelled/i)
      const pids = JSON.parse(await readFile(pidsFile, 'utf8'))
      assert.equal(await waitGone(pids.serverPid), true)
      assert.equal(await waitGone(pids.daemonPid), true)
      assert.ok(await recordedDaemonPid(root), 'delayed daemon record was never published')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps teardown retriable after a receipt-cleanup failure', async () => {
    const root = await makeRoot()
    const identityPath = join(root, 'runtime-identity.json')
    const instance = await launch(root)
    try {
      await rm(identityPath)
      await mkdir(identityPath, { mode: 0o700 })
      await assert.rejects(() => instance.stop({ cleanDaemon: true, timeoutMs: 3000 }), /not a regular file/i)
      await rm(identityPath, { recursive: true, force: true })
      const retried = await instance.stop({ cleanDaemon: true, timeoutMs: 3000 })
      assert.equal(retried.exited, true)
      await assert.rejects(lstat(join(root, 'private-status.json')))
      await assert.rejects(lstat(identityPath))
    } finally {
      await instance.stop({ cleanDaemon: true, timeoutMs: 2000 }).catch(() => {})
      await rm(root, { recursive: true, force: true })
    }
  })

  it('never clears a receipt replaced by another runtime', async () => {
    const root = await makeRoot()
    const identityPath = join(root, 'runtime-identity.json')
    const instance = await launch(root)
    try {
      await writeFile(identityPath, JSON.stringify({ runtimeId: 'another-runtime', serverStartTicks: '1' }))
      const result = await instance.stop({ cleanDaemon: true, timeoutMs: 3000 })
      assert.equal(result.receiptsCleared, true)
      assert.deepEqual(result.preservedReceipts, [identityPath])
      await assert.rejects(lstat(join(root, 'private-status.json')))
      assert.equal(JSON.parse(await readFile(identityPath, 'utf8')).runtimeId, 'another-runtime')
    } finally {
      await instance.stop({ cleanDaemon: true, timeoutMs: 2000 }).catch(() => {})
      await rm(root, { recursive: true, force: true })
    }
  })
})
