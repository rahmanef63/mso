import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readProcessIdentity } from './proc-identity.mjs'
import { DAEMON_ENTRY, NODE, launch, makeRoot, recordedDaemonPid, waitGone } from './lifecycle-test-helpers.mjs'

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
