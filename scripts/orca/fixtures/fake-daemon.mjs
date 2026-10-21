// Test fixture: a disposable stand-in for an Orca terminal daemon.
// Creates a canonical protocol socket and writes a canonical JSON pid record,
// optionally delayed to exercise bounded discovery barriers.
import { createServer } from 'node:net'
import { chmodSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const args = process.argv.slice(2)
const value = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}

const socketPath = value('--socket')
const pidRecord = value('--pid-record')
const delayMs = Number(value('--pid-delay-ms', process.env.FAKE_DAEMON_DELAY_MS || '0'))
if (!socketPath || !pidRecord) {
  process.stderr.write('fake daemon requires --socket and --pid-record\n')
  process.exit(2)
}

mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 })
const server = createServer((socket) => socket.end())
server.listen(socketPath, () => {
  chmodSync(socketPath, 0o600)
  const record = JSON.stringify({ pid: process.pid, startedAtMs: Date.now(), entryPath: process.argv[1] })
  setTimeout(() => writeFileSync(pidRecord, record, { mode: 0o600 }), Math.max(0, delayMs))
  process.stdout.write('ready\n')
})

const shutdown = () => {
  server.close(() => {
    try { unlinkSync(socketPath) } catch {}
    process.exit(0)
  })
}
process.on('SIGTERM', shutdown)
setInterval(() => {}, 1000)
