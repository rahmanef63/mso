import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import {
  validateLauncherArgs,
  validateServerReadiness,
  redactServerReadiness,
  parseDaemonPid,
  writePrivateStatusFile
} from './launcher.mjs'

describe('launcher options, readiness validation & redaction', () => {
  it('validates launcher options correctly and rejects malformed/non-loopback/occupied IPs', () => {
    assert.doesNotThrow(() => {
      validateLauncherArgs({
        bind: '127.0.0.1',
        port: 6769
      })
    })

    assert.doesNotThrow(() => {
      validateLauncherArgs({
        bind: '127.0.0.2',
        port: 0
      })
    })

    // Rejects occupied system port 6768
    assert.throws(
      () => {
        validateLauncherArgs({
          bind: '127.0.0.1',
          port: 6768
        })
      },
      { message: /occupied/i }
    )

    // Rejects malformed bind IP like 127.evil
    assert.throws(
      () => {
        validateLauncherArgs({
          bind: '127.evil.com',
          port: 6769
        })
      },
      { message: /valid IP address/i }
    )

    // Rejects non-loopback IP
    assert.throws(
      () => {
        validateLauncherArgs({
          bind: '0.0.0.0',
          port: 6769
        })
      },
      { message: /loopback/i }
    )
  })

  it('validates valid server readiness payload matching childPid', () => {
    const validPayload = {
      type: 'orca_server_ready',
      schemaVersion: 1,
      runtimeId: 'rt-123',
      endpoint: 'ws://127.0.0.1:6769',
      boundEndpoint: 'ws://127.0.0.1:6769',
      advertisedEndpoint: 'ws://127.0.0.1:6769',
      managedWslCliReconciliation: 'settled',
      pairing: {
        available: true,
        url: 'orca://pair#bearerToken12345',
        endpoint: 'ws://127.0.0.1:6769',
        deviceId: 'dev-1',
        webClientUrl: 'http://127.0.0.1:6769/?token=secretToken',
        scope: 'runtime',
        qr: null
      },
      health: {
        buildHash: 'hash123',
        buildVersion: '1.4.230',
        nodeVersion: '24.21.0',
        nodeAbi: '137',
        platform: 'linux',
        arch: 'x64',
        pid: 12345,
        terminalDaemon: {
          state: 'live',
          ownsFreshSessions: true,
          pid: 12346,
          buildVersion: '1.4.230',
          entryPath: '/slot/daemon-entry.js',
          protocolVersion: 1,
          cgroupUnit: null,
          selfTest: {
            ok: true,
            coverage: 'pty-spawn',
            verdict: 'healthy',
            durationMs: 42
          }
        }
      }
    }

    assert.doesNotThrow(() => {
      validateServerReadiness(validPayload, { expectedChildPid: 12345 })
    })
  })

  it('rejects forged childPid in readiness payload', () => {
    const forgedPayload = {
      type: 'orca_server_ready',
      schemaVersion: 1,
      health: {
        buildVersion: '1.4.230',
        nodeVersion: '24.21.0',
        pid: 999999, // Forged PID
        terminalDaemon: {
          state: 'live',
          ownsFreshSessions: true,
          selfTest: { ok: true }
        }
      }
    }

    assert.throws(
      () => {
        validateServerReadiness(forgedPayload, { expectedChildPid: 12345 })
      },
      { message: /PID mismatch/i }
    )
  })

  it('rejects 0.0.0-orcad and requires exact 1.4.230', () => {
    const oldPayload = {
      type: 'orca_server_ready',
      schemaVersion: 1,
      health: {
        buildVersion: '0.0.0-orcad',
        nodeVersion: '24.21.0',
        pid: 12345,
        terminalDaemon: {
          state: 'live',
          ownsFreshSessions: true,
          selfTest: { ok: true }
        }
      }
    }

    assert.throws(
      () => {
        validateServerReadiness(oldPayload, { expectedChildPid: 12345 })
      },
      { message: /buildVersion mismatch/i }
    )
  })

  it('redacts sensitive bearer URLs from safe status metadata', () => {
    const payload = {
      type: 'orca_server_ready',
      schemaVersion: 1,
      runtimeId: 'rt-123',
      boundEndpoint: 'ws://127.0.0.1:6769',
      pairing: {
        available: true,
        url: 'orca://pair#SECRET_BEARER_TOKEN',
        webClientUrl: 'http://127.0.0.1:6769/?token=SECRET_WEB_TOKEN',
        scope: 'runtime'
      },
      health: {
        pid: 1234,
        buildVersion: '1.4.230',
        terminalDaemon: {
          pid: 1235,
          state: 'live',
          selfTest: { ok: true }
        }
      }
    }

    const redacted = redactServerReadiness(payload)
    const serialized = JSON.stringify(redacted)

    assert.equal(serialized.includes('SECRET_BEARER_TOKEN'), false)
    assert.equal(serialized.includes('SECRET_WEB_TOKEN'), false)
    assert.equal(redacted.pairingAvailable, true)
    assert.equal(redacted.boundEndpoint, 'ws://127.0.0.1:6769')
    assert.equal(redacted.serverPid, 1234)
    assert.equal(redacted.daemonPid, 1235)
  })

  it('writes private status file with 0600 mode and rejects symlinks', async () => {
    const testDir = join(tmpdir(), `test-status-${randomUUID()}`)
    await mkdir(testDir, { recursive: true, mode: 0o700 })
    const statusFile = join(testDir, 'status.json')

    await writePrivateStatusFile(statusFile, { test: 'ok' })

    const { stat } = await import('node:fs/promises')
    const s = await stat(statusFile)
    assert.equal(s.mode & 0o777, 0o600)

    // Reject writing through symlink
    const linkFile = join(testDir, 'link-status.json')
    await symlink(statusFile, linkFile)
    await assert.rejects(
      async () => {
        await writePrivateStatusFile(linkFile, { test: 'fail' })
      },
      { message: /symlink/i }
    )

    await rm(testDir, { recursive: true, force: true })
  })

  it('parses daemon pid from file content', () => {
    assert.equal(parseDaemonPid('12345\n'), 12345)
    assert.equal(parseDaemonPid(JSON.stringify({ pid: 54321 })), 54321)
    assert.equal(parseDaemonPid(''), null)
    assert.equal(parseDaemonPid('not-a-number'), null)
  })
})
