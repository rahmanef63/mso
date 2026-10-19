// Test fixture: disposable stand-in for orcad-server.
// Emits a real readiness line and spawns a real detached daemon child, so the
// launcher's owned-child cleanup and identity checks are exercised for real.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const args = process.argv.slice(2)
const value = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}

const bind = value('--bind', '127.0.0.1')
const port = Number(value('--port', '0'))
const mode = process.env.FAKE_MODE || 'normal'
const userData = process.env.ORCA_USER_DATA
const daemonEntry = process.env.FAKE_DAEMON_ENTRY
const advertised = process.env.FAKE_ADVERTISED || `ws://${bind}:${port}`

let daemonPid = 0
if (mode !== 'exit' && mode !== 'no-daemon' && daemonEntry && userData) {
  const daemonDir = join(userData, 'daemon')
  const socketPath = join(daemonDir, 'daemon-v49.sock')
  const pidPath = join(daemonDir, 'daemon-v49.pid')
  mkdirSync(daemonDir, { recursive: true, mode: 0o700 })
  const daemon = spawn(process.execPath, [daemonEntry, '--socket', socketPath, '--pid-record', pidPath], {
    detached: true,
    stdio: 'ignore',
    env: process.env
  })
  daemon.unref()
  daemonPid = daemon.pid
  writeFileSync(pidPath, `${daemonPid}\n`, { mode: 0o600 })
}

if (mode === 'ignore-term') process.on('SIGTERM', () => {})

if (mode === 'exit') {
  process.stderr.write('fixture exiting early\n')
  process.exit(7)
}

if (mode === 'stderr-flood') {
  process.stderr.write(`pairing failed: orca://pair?code=SECRET_PAIRING_CODE\n${'x'.repeat(300000)}`)
}

if (mode !== 'silent' && mode !== 'stderr-flood') {
  const pid = mode === 'forged-pid' ? 999999 : process.pid
  const reportedDaemonPid = mode === 'daemon-forged-pid' ? 999999 : daemonPid
  const version = mode === 'wrong-version' ? '0.0.0-orcad' : '1.4.230'
  const payload = {
    type: 'orca_server_ready',
    schemaVersion: 1,
    runtimeId: 'fixture-runtime-id',
    boundEndpoint: `ws://${bind}:${port}`,
    advertisedEndpoint: mode === 'bad-endpoint' ? 'wss://evil.example' : advertised,
    pairing: {
      available: true,
      url: 'orca://pair?code=SECRET_PAIRING_CODE',
      endpoint: `ws://${bind}:${port}`,
      deviceId: 'fixture-device',
      webClientUrl: `http://${bind}:${port}/?token=SECRET_WEB_TOKEN`,
      scope: 'runtime',
      qr: null
    },
    health: {
      buildVersion: version,
      nodeVersion: '24.21.0',
      nodeAbi: '137',
      pid,
      terminalDaemon: {
        state: mode === 'daemon-down' ? 'down' : 'live',
        ownsFreshSessions: true,
        pid: reportedDaemonPid,
        entryPath: daemonEntry,
        selfTest: { ok: true, verdict: 'healthy', coverage: 'pty-spawn' }
      }
    }
  }
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

if (mode === 'stdout-flood') {
  const timer = setInterval(() => process.stdout.write('x'.repeat(65536)), 5)
  timer.unref()
}

setInterval(() => {}, 1000)
