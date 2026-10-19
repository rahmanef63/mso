// Test fixture: disposable stand-in for orcad-server.
// Emits a real readiness line and spawns a real detached daemon that creates a
// canonical socket and pid record, so owned-child cleanup is exercised for real.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const value = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}

const bind = value('--bind', '127.0.0.1')
const port = Number(value('--port', '0'))
const mode = process.env.FAKE_MODE || 'normal'
const userData = process.env.ORCA_USER_DATA
const daemonEntry = process.env.FAKE_DAEMON_ENTRY || join(dirname(fileURLToPath(import.meta.url)), 'daemon-entry.js')
const advertised = value('--pairing-address', process.env.FAKE_ADVERTISED || `ws://${bind}:${port}`)

let daemonPid = 0
if (mode !== 'exit' && mode !== 'no-daemon' && userData) {
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
  writeFileSync(join(userData, 'fake-pids.json'), JSON.stringify({ serverPid: process.pid, daemonPid }), {
    mode: 0o600
  })
}

if (mode === 'ignore-term') process.on('SIGTERM', () => {})

if (mode === 'exit') {
  process.stderr.write('fixture exiting early\n')
  process.exit(7)
}

if (mode === 'stderr-flood') {
  process.stderr.write(`pairing failed: orca://pair?code=SECRET_PAIRING_CODE\n${'x'.repeat(300000)}`)
}

function emitReadiness() {
  if (mode === 'silent' || mode === 'stderr-flood') return
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

const readyDelayMs = mode === 'delayed-ready' ? Number(process.env.FAKE_READY_DELAY_MS || '1200') : 0
setTimeout(emitReadiness, readyDelayMs)

if (mode === 'crash-after-ready') {
  setTimeout(() => process.exit(42), readyDelayMs + Number(process.env.FAKE_CRASH_DELAY_MS || '300')).unref()
}

if (mode === 'stdout-flood') {
  const timer = setInterval(() => process.stdout.write('x'.repeat(65536)), 5)
  timer.unref()
}

setInterval(() => {}, 1000)
