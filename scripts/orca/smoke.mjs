/**
 * Disposable smoke proof: launch on a scratch loopback port, probe the real web
 * bundle, then create/read/close one real PTY via the Orca CLI. Always cleans the
 * task-owned server and daemon.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_BIND } from './constants.mjs'
import { createIsolatedEnv } from './env.mjs'
import { launchOrcadServer } from './lifecycle.mjs'
import { initScratchGitRepo, verifyRealTerminalEcho } from './terminal-proof.mjs'

const WEB_TITLE = '<title>Orca Web</title>'

function actualPort(boundEndpoint) {
  try {
    const port = Number(new URL(boundEndpoint).port)
    return Number.isInteger(port) && port > 0 ? port : null
  } catch {
    return null
  }
}

export async function probeWebClient(boundEndpoint, { timeoutMs = 5000 } = {}) {
  const port = actualPort(boundEndpoint)
  if (!port) throw new Error(`bound endpoint has no usable port: ${boundEndpoint}`)
  const url = new URL(`http://127.0.0.1:${port}/web-index.html`)
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`web client probe failed: HTTP ${res.status}`)
  const html = await res.text()
  if (!html.includes(WEB_TITLE)) throw new Error(`web client HTML did not contain ${WEB_TITLE}`)
  return { url: url.href, status: res.status }
}

export async function runSmokeProof({
  release,
  managedRoot,
  port = 0,
  bind = DEFAULT_BIND,
  advertisedEndpoint,
  timeoutMs = 30000,
  log = console
} = {}) {
  if (!release?.slotDir || !release?.nodeBinary || !release?.webDir) {
    throw new Error('runSmokeProof requires a prepared release')
  }
  const cliPath = join(release.slotDir, 'out', 'cli', 'index.js')
  if (!existsSync(cliPath)) throw new Error(`Orca CLI entry is missing: ${cliPath}`)

  const env = createIsolatedEnv({ scratchDir: managedRoot })
  const instance = await launchOrcadServer({
    nodeBinary: release.nodeBinary,
    slotDir: release.slotDir,
    options: {
      bind,
      port,
      webClientRoot: release.webDir,
      ...(advertisedEndpoint
        ? { advertisedEndpoint, pairingAddress: advertisedEndpoint }
        : { allowLoopbackAdvertised: true })
    },
    env,
    managedRoot,
    timeoutMs,
    privateStatusPath: join(managedRoot, 'private-status.json'),
    runtimeIdentityPath: join(managedRoot, 'runtime-identity.json')
  })

  try {
    log.log(`[orca-cli] Ready: ${instance.redacted.boundEndpoint}`)
    log.log(`[orca-cli] Safe metadata: ${JSON.stringify(instance.redacted)}`)

    const web = await probeWebClient(instance.readyPayload.boundEndpoint)
    log.log(`[orca-cli] Web client probe passed: ${web.url} (HTTP ${web.status})`)

    const pairingUrl = instance.readyPayload.pairing?.url
    if (typeof pairingUrl !== 'string' || pairingUrl.length === 0) {
      throw new Error('readiness payload has no pairing URL')
    }
    const proofRepo = await initScratchGitRepo(join(managedRoot, 'proof-repo'))
    const echoToken = `ORCA_ECHO_PASSED_${Date.now()}`
    log.log(`[orca-cli] Running PTY echo proof with token ${echoToken}...`)
    const echo = await verifyRealTerminalEcho({
      nodeBinary: release.nodeBinary,
      cliPath,
      cliEnv: { ...env, ORCA_PAIRING_CODE: pairingUrl },
      testRepo: proofRepo,
      echoToken
    })
    log.log('[orca-cli] PTY echo proof passed; closing terminal.')

    return {
      version: release.version,
      redacted: instance.redacted,
      web,
      echo: { observed: echo.echoObserved, termHandle: echo.termHandle }
    }
  } finally {
    log.log('[orca-cli] Stopping server and task-owned terminal daemon...')
    await instance.stop({ cleanDaemon: true })
  }
}
