import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseProcStat,
  readProcessIdentity,
  verifyProcessIdentity,
  waitForProcessIdentity,
  waitForProcessExit,
  terminateVerifiedProcess
} from './proc-identity.mjs'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
const HOLDER = join(FIXTURES, 'hold-child.mjs')
const STUBBORN = join(FIXTURES, 'stubborn-child.mjs')

async function spawnHolder(script = HOLDER, args = []) {
  const child = spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  child.stderr.resume()
  // Wait for the fixture's "ready" line: guarantees its signal handlers exist.
  await new Promise((resolve, reject) => {
    let buf = ''
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8')
      if (buf.includes('ready')) resolve()
    })
    child.once('exit', () => reject(new Error('fixture exited before ready')))
  })
  child.stdout.resume()
  return child
}

async function stopFixture(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGKILL')
  await new Promise((resolve) => child.once('exit', resolve))
}

function statLine({ pid = 4242, comm = 'node', startTicks = '987654' } = {}) {
  const rest = ['S', '1', String(pid), String(pid), '0', '-1', '4194304']
  while (rest.length < 19) rest.push('0')
  rest.push(startTicks)
  while (rest.length < 50) rest.push('0')
  return `${pid} (${comm}) ${rest.join(' ')}`
}

describe('proc identity parses kernel identity and verifies owned children', () => {
  it('parses start ticks when comm contains spaces and parentheses', () => {
    const parsed = parseProcStat(statLine({ pid: 77, comm: 'my (weird) node', startTicks: '12345' }))
    assert.equal(parsed.pid, 77)
    assert.equal(parsed.comm, 'my (weird) node')
    assert.equal(parsed.state, 'S')
    assert.equal(parsed.startTicks, '12345')
  })

  it('reads the current process identity from procfs', async () => {
    const identity = await readProcessIdentity(process.pid)
    assert.ok(identity)
    assert.equal(identity.pid, process.pid)
    assert.equal(identity.uid, process.getuid())
    assert.equal(identity.exe, await realpath(process.execPath))
    assert.match(identity.startTicks, /^\d+$/)
    assert.ok(identity.argv.some((a) => a.includes('proc-identity.test.mjs')))
  })

  it('returns null for a process that does not exist', async () => {
    assert.equal(await readProcessIdentity(2 ** 22 + 12345), null)
  })

  it('accepts the real owned child and rejects forged uid/exe/start ticks/script/socket', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orca-proc-'))
    const socketPath = join(dir, 'daemon', 'daemon-v1.sock')
    const child = await spawnHolder(HOLDER, ['--socket', socketPath, '--entry-path', HOLDER])
    try {
      const expected = await waitForProcessIdentity(child.pid, {
        exe: await realpath(process.execPath),
        scriptPath: HOLDER,
        socketPath,
        uid: process.getuid()
      })
      assert.ok(expected)
      assert.equal(await verifyProcessIdentity(expected, expected), true)

      assert.equal(await verifyProcessIdentity({ ...expected, uid: expected.uid + 1 }, expected), false)
      assert.equal(await verifyProcessIdentity({ ...expected, exe: '/bin/false' }, expected), false)
      assert.equal(await verifyProcessIdentity({ ...expected, startTicks: '1' }, expected), false)
      assert.equal(await verifyProcessIdentity({ ...expected, pid: expected.pid + 1 }, expected), false)

      assert.equal(
        await waitForProcessIdentity(child.pid, { scriptPath: join(dir, 'other-entry.js') }, { attempts: 2, delayMs: 5 }),
        null
      )
      assert.equal(
        await waitForProcessIdentity(child.pid, { socketPath: join(dir, 'other', 'x.sock') }, { attempts: 2, delayMs: 5 }),
        null
      )
    } finally {
      await stopFixture(child)
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('waits for a real exit and reports reused/stale identities without signaling them', async () => {
    const child = await spawnHolder()
    const identity = await waitForProcessIdentity(child.pid, { exe: await realpath(process.execPath), scriptPath: HOLDER })
    assert.ok(identity)

    const stale = { ...identity, startTicks: '1' }
    const result = await terminateVerifiedProcess(stale, { timeoutMs: 200 })
    assert.equal(result.signaled, false)
    assert.equal(result.exited, false)
    assert.equal(child.exitCode, null)

    const terminated = await terminateVerifiedProcess(identity, { timeoutMs: 3000 })
    assert.equal(terminated.signaled, true)
    assert.equal(terminated.exited, true)
    assert.equal(await waitForProcessExit(identity, { timeoutMs: 1000 }), true)
  })

  it('escalates to SIGKILL for a verified child that ignores SIGTERM', async () => {
    const child = await spawnHolder(STUBBORN)
    try {
      const identity = await waitForProcessIdentity(child.pid, { exe: await realpath(process.execPath), scriptPath: STUBBORN })
      assert.ok(identity)
      const result = await terminateVerifiedProcess(identity, { timeoutMs: 300, killTimeoutMs: 3000 })
      assert.equal(result.signaled, true)
      assert.equal(result.forced, true)
      assert.equal(result.exited, true)
    } finally {
      await stopFixture(child)
    }
  })
})
