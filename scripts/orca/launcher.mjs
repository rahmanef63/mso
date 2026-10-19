/**
 * Hardened Orca server process supervisor, readiness validation, and bearer-safe lifecycle.
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { lstat, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isIP } from 'node:net'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import {
  DEFAULT_BIND,
  DEFAULT_PORT,
  OCCUPIED_SYSTEM_PORT,
  ORCA_VERSION,
  WEB_CLIENT_INDEX_FILENAME
} from './constants.mjs'

export function validateLauncherArgs({ bind = DEFAULT_BIND, port = DEFAULT_PORT, webClientRoot } = {}) {
  const ipType = isIP(bind)
  if (!ipType) throw new Error(`bind host must be a valid IP address, got: ${bind}`)
  if (bind !== '127.0.0.1' && bind !== '::1' && !bind.startsWith('127.')) {
    throw new Error(`bind host must be a loopback address, got: ${bind}`)
  }
  const portNum = Number(port)
  if (!Number.isInteger(portNum) || portNum < 0 || portNum > 65535) {
    throw new Error(`port must be an integer 0-65535, got: ${port}`)
  }
  if (portNum === OCCUPIED_SYSTEM_PORT) {
    throw new Error(`Port ${OCCUPIED_SYSTEM_PORT} is occupied by existing system Orca; use port 6769 or 0`)
  }
  if (webClientRoot && !existsSync(join(webClientRoot, WEB_CLIENT_INDEX_FILENAME))) {
    throw new Error(`webClientRoot missing ${WEB_CLIENT_INDEX_FILENAME}`)
  }
}

export function validateServerReadiness(payload, { expectedChildPid } = {}) {
  if (!payload || typeof payload !== 'object') throw new Error('Readiness payload is not an object')
  if (payload.type !== 'orca_server_ready' || payload.schemaVersion !== 1) {
    throw new Error(`Invalid readiness payload: ${payload.type} v${payload.schemaVersion}`)
  }
  if (payload.health?.buildVersion !== ORCA_VERSION) {
    throw new Error(`Health buildVersion mismatch: expected ${ORCA_VERSION}, got ${payload.health?.buildVersion}`)
  }
  if (expectedChildPid && payload.health.pid !== expectedChildPid) {
    throw new Error(`Health PID mismatch: expected child PID ${expectedChildPid}, got ${payload.health.pid}`)
  }
  const d = payload.health?.terminalDaemon
  if (!d || d.state !== 'live' || d.ownsFreshSessions !== true || d.selfTest?.ok !== true) {
    throw new Error(`terminal daemon unhealthy or failed selfTest: ${d?.selfTest?.verdict ?? 'down'}`)
  }
}

export function redactServerReadiness(payload) {
  return {
    type: payload.type,
    schemaVersion: payload.schemaVersion,
    runtimeId: payload.runtimeId,
    boundEndpoint: payload.boundEndpoint ?? payload.endpoint ?? null,
    advertisedEndpoint: payload.advertisedEndpoint ?? null,
    pairingAvailable: Boolean(payload.pairing?.available),
    serverPid: payload.health?.pid ?? null,
    daemonPid: payload.health?.terminalDaemon?.pid ?? null,
    healthState: payload.health?.terminalDaemon?.state ?? null,
    selfTestVerdict: payload.health?.terminalDaemon?.selfTest?.verdict ?? null
  }
}

export function parseDaemonPid(raw) {
  if (!raw || typeof raw !== 'string') return null
  const num = Number(raw.trim())
  if (Number.isInteger(num) && num > 0) return num
  try {
    const p = JSON.parse(raw.trim())
    if (p && Number.isInteger(p.pid) && p.pid > 0) return p.pid
  } catch {}
  return null
}

export async function writePrivateStatusFile(filePath, data) {
  try {
    const s = await lstat(filePath)
    if (s.isSymbolicLink()) throw new Error(`Refusing to write status: ${filePath} is a symlink`)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
  const tmpPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`
  await writeFile(tmpPath, typeof data === 'string' ? data : JSON.stringify(data, null, 2), { mode: 0o600 })
  await rename(tmpPath, filePath)
}

export async function verifyDaemonOwnership(pid) {
  if (!pid || !Number.isInteger(pid) || pid <= 1) return false
  try {
    process.kill(pid, 0)
    const cmd = await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '')
    return cmd.includes('daemon-entry.js')
  } catch {
    return false
  }
}

export async function findDaemonPidFromUserData(userDataPath) {
  try {
    const daemonDir = join(userDataPath, 'daemon')
    const files = await readdir(daemonDir)
    for (const f of files.filter((n) => /^daemon-v\d+\.pid$/.test(n))) {
      const pid = parseDaemonPid(await readFile(join(daemonDir, f), 'utf8'))
      if (pid && (await verifyDaemonOwnership(pid))) return pid
    }
  } catch {}
  return null
}

export async function launchOrcadServer({
  nodeBinary,
  slotDir,
  options = {},
  env,
  timeoutMs = 30000,
  privateStatusPath
}) {
  validateLauncherArgs(options)
  const serverJs = join(slotDir, 'orcad-server.js')
  const args = [serverJs, '--bind', options.bind ?? DEFAULT_BIND, '--port', String(options.port ?? DEFAULT_PORT), '--json']
  if (options.webClientRoot) args.push('--web-client-root', options.webClientRoot)
  if (options.pairingAddress) args.push('--pairing-address', options.pairingAddress)

  const child = spawn(nodeBinary, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let daemonPid = null
  let stopped = false
  const stderrBuffer = []

  child.stderr.on('data', (c) => {
    stderrBuffer.push(c)
    if (stderrBuffer.length > 50) stderrBuffer.shift()
  })

  try {
    const readyPayload = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        rl.close()
        reject(new Error(`Timed out waiting for orca_server_ready after ${timeoutMs}ms`))
      }, timeoutMs)

      const rl = createInterface({ input: child.stdout })
      rl.on('line', (line) => {
        if (line.includes('"orca_server_ready"')) {
          try {
            const payload = JSON.parse(line)
            validateServerReadiness(payload, { expectedChildPid: child.pid })
            clearTimeout(timer)
            resolve(payload)
          } catch (err) {
            clearTimeout(timer); reject(err)
          }
        }
      })
      child.on('error', (err) => { clearTimeout(timer); rl.close(); reject(err) })
      child.on('exit', (code) => {
        clearTimeout(timer); rl.close()
        const errText = Buffer.concat(stderrBuffer).toString('utf8').replace(/token=[^\s"']+/g, 'token=REDACTED')
        reject(new Error(`orcad-server exited prematurely (code ${code}): ${errText}`))
      })
    })

    child.stdout.resume()
    daemonPid = readyPayload.health?.terminalDaemon?.pid ?? (await findDaemonPidFromUserData(env.ORCA_USER_DATA))
    if (privateStatusPath) await writePrivateStatusFile(privateStatusPath, readyPayload)

    return {
      child,
      readyPayload,
      redacted: redactServerReadiness(readyPayload),
      daemonPid,
      stop: async ({ cleanDaemon = true, timeout = 5000 } = {}) => {
        if (stopped) return
        stopped = true
        try { child.kill('SIGTERM') } catch {}
        if (cleanDaemon && daemonPid && (await verifyDaemonOwnership(daemonPid))) {
          try { process.kill(daemonPid, 'SIGTERM') } catch {}
        }
        const start = Date.now()
        while (Date.now() - start < timeout) {
          let alive = false
          try { if (child.exitCode === null) { process.kill(child.pid, 0); alive = true } } catch {}
          try { if (cleanDaemon && daemonPid) { process.kill(daemonPid, 0); daemonAlive = true } } catch {}
          if (!alive) return
          await new Promise((r) => setTimeout(r, 100))
        }
        try { child.kill('SIGKILL') } catch {}
        if (cleanDaemon && daemonPid) { try { process.kill(daemonPid, 'SIGKILL') } catch {} }
      }
    }
  } catch (err) {
    try { child.kill('SIGKILL') } catch {}
    throw err
  }
}
