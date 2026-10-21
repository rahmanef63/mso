import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdir, mkdtemp, writeFile, symlink, rm, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  validateLauncherArgs,
  validateServerReadiness,
  redactServerReadiness,
  createRuntimeIdentity,
  ensureManagedRoot,
  writePrivateFile,
  parseDaemonPid
} from './launcher.mjs'

const READY = {
  type: 'orca_server_ready',
  schemaVersion: 1,
  runtimeId: 'runtime-abc',
  boundEndpoint: 'ws://127.0.0.1:6769',
  advertisedEndpoint: 'wss://orca.example.ts.net',
  pairing: { available: true, url: 'orca://pair?code=SECRET', endpoint: 'ws://127.0.0.1:6769' },
  health: {
    buildVersion: '1.4.230',
    nodeVersion: '24.21.0',
    nodeAbi: '137',
    pid: 12345,
    terminalDaemon: {
      state: 'live',
      ownsFreshSessions: true,
      pid: 12346,
      entryPath: '/slot/daemon-entry.js',
      selfTest: { ok: true, verdict: 'healthy' }
    }
  }
}

const clone = (v) => JSON.parse(JSON.stringify(v))
const opts = (extra = {}) => ({
  expectedChildPid: 12345,
  bind: '127.0.0.1',
  port: 6769,
  allowLoopbackAdvertised: false,
  ...extra
})

describe('launcher argument and readiness validation', () => {
  it('accepts loopback binds and rejects malformed, non-loopback, and out-of-range values', () => {
    assert.doesNotThrow(() => validateLauncherArgs({ bind: '127.0.0.1', port: 6769 }))
    assert.doesNotThrow(() => validateLauncherArgs({ bind: '127.0.0.2', port: 0 }))
    assert.doesNotThrow(() => validateLauncherArgs({ bind: '::1', port: 6769 }))
    assert.throws(() => validateLauncherArgs({ bind: '127.evil.com', port: 6769 }), /valid IP/i)
    assert.throws(() => validateLauncherArgs({ bind: '0.0.0.0', port: 6769 }), /loopback/i)
    assert.throws(() => validateLauncherArgs({ bind: '127.0.0.1', port: 70000 }), /0-65535|port/i)
    assert.throws(() => validateLauncherArgs({ bind: '127.0.0.1', port: -1 }), /port/i)
    assert.throws(() => validateLauncherArgs({ bind: '127.0.0.1', port: '6769x' }), /port/i)
  })

  it('does not hardcode a host port claim: a configured port is only rejected by the kernel', () => {
    // Any literal port is structurally valid; real occupancy is enforced at bind time.
    assert.doesNotThrow(() => validateLauncherArgs({ bind: '127.0.0.1', port: 6768 }))
  })

  it('accepts a fully consistent readiness payload', () => {
    assert.doesNotThrow(() => validateServerReadiness(READY, opts()))
  })

  it('rejects forged pid, wrong version, wrong ABI, dead daemon, and forged daemon pid', () => {
    const forged = clone(READY)
    forged.health.pid = 999999
    assert.throws(() => validateServerReadiness(forged, opts()), /PID mismatch/i)

    const old = clone(READY)
    old.health.buildVersion = '0.0.0-orcad'
    assert.throws(() => validateServerReadiness(old, opts()), /buildVersion mismatch/i)

    const abi = clone(READY)
    abi.health.nodeAbi = '127'
    assert.throws(() => validateServerReadiness(abi, opts()), /ABI/i)

    const down = clone(READY)
    down.health.terminalDaemon.state = 'down'
    assert.throws(() => validateServerReadiness(down, opts()), /daemon/i)

    const noSelfTest = clone(READY)
    noSelfTest.health.terminalDaemon.selfTest = { ok: false, verdict: 'failed' }
    assert.throws(() => validateServerReadiness(noSelfTest, opts()), /selfTest/i)

    const noDaemonPid = clone(READY)
    noDaemonPid.health.terminalDaemon.pid = 0
    assert.throws(() => validateServerReadiness(noDaemonPid, opts()), /daemon/i)
  })

  it('rejects endpoints that do not match the requested loopback bind and port', () => {
    const wrongHost = clone(READY)
    wrongHost.boundEndpoint = 'ws://10.0.0.5:6769'
    assert.throws(() => validateServerReadiness(wrongHost, opts()), /bound endpoint/i)

    const wrongPort = clone(READY)
    wrongPort.boundEndpoint = 'ws://127.0.0.1:7777'
    assert.throws(() => validateServerReadiness(wrongPort, opts()), /bound endpoint/i)

    const advertisedMismatch = clone(READY)
    advertisedMismatch.advertisedEndpoint = 'wss://other.example'
    assert.throws(
      () => validateServerReadiness(advertisedMismatch, opts({ advertisedEndpoint: 'wss://orca.example.ts.net' })),
      /advertised endpoint/i
    )

    const plainLoopback = clone(READY)
    plainLoopback.advertisedEndpoint = 'ws://127.0.0.1:6769'
    assert.throws(() => validateServerReadiness(plainLoopback, opts({ allowLoopbackAdvertised: false })), /advertised endpoint/i)
    assert.doesNotThrow(() => validateServerReadiness(plainLoopback, opts({ allowLoopbackAdvertised: true })))

    const badRuntime = clone(READY)
    badRuntime.runtimeId = ''
    assert.throws(() => validateServerReadiness(badRuntime, opts()), /runtimeId/i)
  })

  it('redacts every bearer/pairing field from safe metadata', () => {
    const redacted = redactServerReadiness(READY)
    const serialized = JSON.stringify(redacted)
    assert.equal(serialized.includes('SECRET'), false)
    assert.equal(redacted.pairingAvailable, true)
    assert.equal(redacted.serverPid, 12345)
    assert.equal(redacted.daemonPid, 12346)
    assert.equal(redacted.boundEndpoint, 'ws://127.0.0.1:6769')
    assert.equal(redacted.version, '1.4.230')
  })

  it('builds a schema-1 identity receipt from the owned child, not from health alone', () => {
    const receipt = createRuntimeIdentity({
      readyPayload: READY,
      serverIdentity: { pid: 12345, startTicks: '555' },
      nodeBinary: '/slot/runtimes/node/bin/node',
      serverEntry: '/slot/orcad-server.js',
      userData: '/root/runtime/user-data',
      boundEndpoint: 'ws://127.0.0.1:6769',
      advertisedEndpoint: 'wss://orca.example.ts.net',
      readyAt: '2026-10-19T00:00:00.000Z'
    })
    assert.deepEqual(Object.keys(receipt).sort(), [
      'advertisedEndpoint',
      'boundEndpoint',
      'nodeBinary',
      'readyAt',
      'runtimeId',
      'schemaVersion',
      'serverEntry',
      'serverPid',
      'serverStartTicks',
      'userData',
      'version'
    ])
    assert.equal(receipt.schemaVersion, 1)
    assert.equal(receipt.serverPid, 12345)
    assert.equal(receipt.serverStartTicks, '555')
    assert.equal(receipt.version, '1.4.230')
  })
})

describe('managed root publication safety', () => {
  it('creates a 0700 owned root and refuses symlinked ancestors or loose modes', async () => {
    const base = await mkdtemp(join(tmpdir(), 'orca-root-'))
    const root = join(base, 'managed')
    await ensureManagedRoot(root)
    assert.equal((await stat(root)).mode & 0o777, 0o700)

    const loose = join(base, 'loose')
    await mkdir(loose, { mode: 0o755 })
    await ensureManagedRoot(loose)
    assert.equal((await stat(loose)).mode & 0o777, 0o700)

    const link = join(base, 'link')
    await symlink(root, link)
    await assert.rejects(() => ensureManagedRoot(link), /symlink/i)

    const nested = join(link, 'child')
    await assert.rejects(() => ensureManagedRoot(nested), /symlink/i)

    await rm(base, { recursive: true, force: true })
  })

  it('writes private files atomically at 0600 with no temp residue', async () => {
    const base = await mkdtemp(join(tmpdir(), 'orca-write-'))
    await ensureManagedRoot(base)
    const file = join(base, 'private-status.json')
    await writePrivateFile(file, { ok: true }, { root: base })
    assert.equal((await stat(file)).mode & 0o777, 0o600)
    assert.deepEqual(await readdir(base), ['private-status.json'])

    await assert.rejects(() => writePrivateFile(join(base, '..', 'escape.json'), { ok: true }, { root: base }), /outside/i)

    const linkTarget = join(base, 'target.json')
    await writeFile(linkTarget, '{}', { mode: 0o600 })
    const link = join(base, 'link.json')
    await symlink(linkTarget, link)
    await assert.rejects(() => writePrivateFile(link, { ok: true }, { root: base }), /symlink/i)
    assert.deepEqual((await readdir(base)).sort(), ['link.json', 'private-status.json', 'target.json'])

    await rm(base, { recursive: true, force: true })
  })

  it('parses daemon pid records and rejects garbage', () => {
    assert.equal(parseDaemonPid('12345\n'), 12345)
    assert.equal(parseDaemonPid(JSON.stringify({ pid: 54321 })), 54321)
    assert.equal(parseDaemonPid(''), null)
    assert.equal(parseDaemonPid('not-a-number'), null)
    assert.equal(parseDaemonPid('0'), null)
  })
})
