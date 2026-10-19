/**
 * Orca server process supervisor, readiness validation, and bearer-safe lifecycle.
 */

import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync } from 'node:fs'
import { lstat, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { DEFAULT_BIND, DEFAULT_PORT, ORCA_VERSION, WEB_CLIENT_INDEX_FILENAME } from './constants.mjs'

export function validateLauncherArgs({ bind = DEFAULT_BIND, port = DEFAULT_PORT, webClientRoot } = {}) {
  const isLoopback = bind === '127.0.0.1' || bind === '::1' || bind.startsWith('127.')
  if (!isLoopback) {
    throw new Error(`bind host must be a loopback address, got: ${bind}`)
  }
  const portNum = Number(port)
  if (!Number.isInteger(portNum) || portNum < 0 || portNum > 65535) {
    throw new Error(`port must be an integer 0-65535, got: ${port}`)
  }
  if (webClientRoot) {
    const indexHtml = join(webClientRoot, WEB_CLIENT_INDEX_FILENAME)
    if (!existsSync(indexHtml)) {
      throw new Error(`webClientRoot must contain ${WEB_CLIENT_INDEX_FILENAME}, not found at ${indexHtml}`)
    }
  }
}

export function validateServerReadiness(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Readiness payload is not an object')
  if (payload.type !== 'orca_server_ready') throw new Error(`Invalid type: ${payload.type}`)
  if (payload.schemaVersion !== 1) throw new Error(`Invalid schemaVersion: ${payload.schemaVersion}`)
  if (!payload.health) throw new Error('Missing health in readiness payload')
  if (payload.health.buildVersion !== ORCA_VERSION && payload.health.buildVersion !== '0.0.0-orcad') {
    throw new Error(`Health buildVersion mismatch: expected ${ORCA_VERSION}, got ${payload.health.buildVersion}`)
  }
  const daemon = payload.health.terminalDaemon
  if (!daemon) throw new Error('Missing terminalDaemon in health')
  if (daemon.state !== 'live') throw new Error(`terminalDaemon state is not live: ${daemon.state}`)
  if (daemon.ownsFreshSessions !== true) throw new Error('terminalDaemon does not own fresh sessions')
  if (!daemon.selfTest || daemon.selfTest.ok !== true) {
    throw new Error(`terminal daemon selfTest failed: ${daemon.selfTest?.verdict ?? 'unknown'}`)
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

export function parseDaemonPid(rawContent) {
  if (!rawContent || typeof rawContent !== 'string') return null
  const trimmed = rawContent.trim()
  if (!trimmed) return null
  const num = Number(trimmed)
  if (Number.isInteger(num) && num > 0) return num
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && Number.isInteger(parsed.pid) && parsed.pid > 0) return parsed.pid
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
  const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  await writeFile(tmpPath, content, { mode: 0o600 })
  await rename(tmpPath, filePath)
}

export async function findDaemonPidFromUserData(userDataPath) {
  try {
    const daemonDir = join(userDataPath, 'daemon')
    const files = await readdir(daemonDir)
    const pidFiles = files.filter((f) => /^daemon-v\d+\.pid$/.test(f))
    for (const f of pidFiles) {
      const content = await readFile(join(daemonDir, f), 'utf8')
      const pid = parseDaemonPid(content)
      if (pid) return pid
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

  const readinessPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for orca_server_ready after ${timeoutMs}ms`))
    }, timeoutMs)
    const rl = createInterface({ input: child.stdout })
    const errChunks = []
    child.stderr.on('data', (c) => errChunks.push(c))
    rl.on('line', (line) => {
      if (line.includes('"orca_server_ready"')) {
        try {
          const payload = JSON.parse(line)
          validateServerReadiness(payload)
          cleanup()
          resolve(payload)
        } catch (err) {
          cleanup()
          reject(err)
        }
      }
    })
    child.on('error', (err) => { cleanup(); reject(err) })
    child.on('exit', (code) => {
      cleanup()
      reject(new Error(`orcad-server exited prematurely with code ${code}. Stderr: ${Buffer.concat(errChunks).toString('utf8')}`))
    })
    function cleanup() { clearTimeout(timer); rl.close() }
  })

  const readyPayload = await readinessPromise
  daemonPid = readyPayload.health?.terminalDaemon?.pid ?? (await findDaemonPidFromUserData(env.ORCA_USER_DATA))
  if (privateStatusPath) await writePrivateStatusFile(privateStatusPath, readyPayload)

  return {
    child,
    readyPayload,
    redacted: redactServerReadiness(readyPayload),
    daemonPid,
    stop: async () => {
      if (stopped) return
      stopped = true
      try { child.kill('SIGTERM') } catch {}
      if (daemonPid) {
        try { process.kill(daemonPid, 'SIGTERM') } catch {}
      }
      await new Promise((r) => {
        if (child.exitCode !== null) return r()
        child.on('exit', r)
        setTimeout(r, 3000)
      })
    }
  }
}
