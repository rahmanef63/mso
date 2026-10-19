import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateLauncherArgs,
  validateServerReadiness,
  redactServerReadiness,
  parseDaemonPid
} from './launcher.mjs'

describe('launcher options, readiness validation & redaction', () => {
  it('validates launcher options correctly', () => {
    assert.doesNotThrow(() => {
      validateLauncherArgs({
        bind: '127.0.0.1',
        port: 6768
      })
    })

    assert.doesNotThrow(() => {
      validateLauncherArgs({
        bind: '127.0.0.2',
        port: 0
      })
    })

    // Rejects non-loopback IP by default
    assert.throws(
      () => {
        validateLauncherArgs({
          bind: '0.0.0.0',
          port: 6768
        })
      },
      { message: /loopback/i }
    )

    // Rejects invalid port
    assert.throws(
      () => {
        validateLauncherArgs({
          bind: '127.0.0.1',
          port: 70000
        })
      },
      { message: /port/i }
    )
  })

  it('validates valid server readiness payload', () => {
    const validPayload = {
      type: 'orca_server_ready',
      schemaVersion: 1,
      runtimeId: 'rt-123',
      endpoint: 'ws://127.0.0.1:6768',
      boundEndpoint: 'ws://127.0.0.1:6768',
      advertisedEndpoint: 'ws://127.0.0.1:6768',
      managedWslCliReconciliation: 'settled',
      pairing: {
        available: true,
        url: 'orca://pair#bearerToken12345',
        endpoint: 'ws://127.0.0.1:6768',
        deviceId: 'dev-1',
        webClientUrl: 'http://127.0.0.1:6768/?token=secretToken',
        scope: 'runtime',
        qr: null
      },
      health: {
        buildHash: 'hash123',
        buildVersion: '1.4.230',
        nodeVersion: 'v24.21.0',
        nodeAbi: '127',
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
      validateServerReadiness(validPayload)
    })
  })

  it('rejects readiness payload with degraded daemon or failing selfTest', () => {
    const degradedDaemon = {
      type: 'orca_server_ready',
      schemaVersion: 1,
      health: {
        buildVersion: '1.4.230',
        terminalDaemon: {
          state: 'degraded',
          ownsFreshSessions: true,
          selfTest: { ok: true }
        }
      }
    }

    assert.throws(
      () => {
        validateServerReadiness(degradedDaemon)
      },
      { message: /terminalDaemon state is not live/i }
    )

    const failingSelfTest = {
      type: 'orca_server_ready',
      schemaVersion: 1,
      health: {
        buildVersion: '1.4.230',
        terminalDaemon: {
          state: 'live',
          ownsFreshSessions: true,
          selfTest: { ok: false, verdict: 'failed' }
        }
      }
    }

    assert.throws(
      () => {
        validateServerReadiness(failingSelfTest)
      },
      { message: /terminal daemon selfTest failed/i }
    )
  })

  it('redacts sensitive bearer URLs from safe status metadata', () => {
    const payload = {
      type: 'orca_server_ready',
      schemaVersion: 1,
      runtimeId: 'rt-123',
      boundEndpoint: 'ws://127.0.0.1:6768',
      pairing: {
        available: true,
        url: 'orca://pair#SECRET_BEARER_TOKEN',
        webClientUrl: 'http://127.0.0.1:6768/?token=SECRET_WEB_TOKEN',
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
    assert.equal(redacted.boundEndpoint, 'ws://127.0.0.1:6768')
    assert.equal(redacted.serverPid, 1234)
    assert.equal(redacted.daemonPid, 1235)
  })

  it('parses daemon pid from file content', () => {
    assert.equal(parseDaemonPid('12345\n'), 12345)
    assert.equal(parseDaemonPid(JSON.stringify({ pid: 54321 })), 54321)
    assert.equal(parseDaemonPid(''), null)
    assert.equal(parseDaemonPid('not-a-number'), null)
  })
})
