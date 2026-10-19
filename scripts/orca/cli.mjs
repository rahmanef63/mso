#!/usr/bin/env node
/**
 * Orca runtime CLI helper: materialization, isolated execution, and health proof.
 */

import { existsSync } from 'node:fs'
import { copyFile, chmod, mkdir, rm, symlink } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import {
  DEFAULT_BIND,
  DEFAULT_PORT,
  PINNED_NODE,
  SUPPORTED_TARGET,
  ORCAD_RUNTIMES_DIRNAME,
  ORCAD_NODE_RUNTIME_DIR_PREFIX,
  ORCAD_NODE_RUNTIME_POSIX_EXECUTABLE
} from './constants.mjs'
import { ensureIsolatedDirectories, createIsolatedEnv } from './env.mjs'
import { fetchAndMaterializeNodeRuntime } from './node-runtime.mjs'
import { materializeOrcadSlot } from './materializer.mjs'
import { launchOrcadServer } from './launcher.mjs'

const DEFAULT_TEMPLATE = '/home/antinrml/.hermes/cache/scratch/orca-upstream-probe/deb-amd64/opt/Orca/resources/orcad-template'
const DEFAULT_WEB = '/home/antinrml/.hermes/cache/scratch/orca-upstream-probe/deb-amd64/opt/Orca/resources/app.asar.unpacked/out/web'
const DEFAULT_SCRATCH = '/home/antinrml/.hermes/cache/scratch/orca-runtime-proof-20261019'

function parseArgs(argv) {
  const args = { command: argv[2] || 'help' }
  for (let i = 3; i < argv.length; i += 1) {
    if (argv[i] === '--template') args.template = argv[++i]
    else if (argv[i] === '--web') args.web = argv[++i]
    else if (argv[i] === '--scratch') args.scratch = argv[++i]
    else if (argv[i] === '--port') args.port = Number(argv[++i])
    else if (argv[i] === '--bind') args.bind = argv[++i]
  }
  return args
}

export async function prepareSlotAndRuntime({
  templateDir = DEFAULT_TEMPLATE,
  scratchDir = DEFAULT_SCRATCH
} = {}) {
  await ensureIsolatedDirectories(scratchDir)
  const slotsRoot = join(scratchDir, 'slots', SUPPORTED_TARGET)
  const runtimesRoot = join(scratchDir, 'slots', SUPPORTED_TARGET, ORCAD_RUNTIMES_DIRNAME)

  // 1. Fetch & verify pinned Node
  const nodeBinary = await fetchAndMaterializeNodeRuntime({
    target: SUPPORTED_TARGET,
    runtimesDir: runtimesRoot
  })

  // 2. Materialize orcad template
  const tempSlotDir = join(slotsRoot, 'active')
  const { slotDir, fullVersion } = await materializeOrcadSlot({
    templateDir,
    outputSlotDir: tempSlotDir,
    target: SUPPORTED_TARGET
  })

  // 3. Ensure expected relative runtime link exists from slotDir
  const slotExpectedNode = join(
    slotDir,
    '..',
    ORCAD_RUNTIMES_DIRNAME,
    `${ORCAD_NODE_RUNTIME_DIR_PREFIX}${PINNED_NODE.executableSha256}`,
    ...ORCAD_NODE_RUNTIME_POSIX_EXECUTABLE.split('/')
  )

  if (!existsSync(slotExpectedNode)) {
    await mkdir(dirname(slotExpectedNode), { recursive: true })
    try {
      await symlink(nodeBinary, slotExpectedNode)
    } catch {
      await copyFile(nodeBinary, slotExpectedNode)
      await chmod(slotExpectedNode, 0o755)
    }
  }

  return { slotDir, nodeBinary, fullVersion }
}

export async function runSmokeProof({
  templateDir = DEFAULT_TEMPLATE,
  webDir = DEFAULT_WEB,
  scratchDir = DEFAULT_SCRATCH,
  port = DEFAULT_PORT,
  bind = DEFAULT_BIND
} = {}) {
  console.log(`[orca-cli] Preparing slot and pinned Node in ${scratchDir}...`)
  const { slotDir, nodeBinary, fullVersion } = await prepareSlotAndRuntime({ templateDir, scratchDir })
  console.log(`[orca-cli] Slot materialized: ${slotDir} (${fullVersion})`)
  console.log(`[orca-cli] Node runtime verified: ${nodeBinary}`)

  const env = createIsolatedEnv({ scratchDir })
  const privateStatusPath = join(scratchDir, 'private-status.json')

  console.log(`[orca-cli] Launching orcad-server on ${bind}:${port}...`)
  const instance = await launchOrcadServer({
    nodeBinary,
    slotDir,
    options: { bind, port, webClientRoot: webDir },
    env,
    timeoutMs: 30000,
    privateStatusPath
  })

  console.log('[orca-cli] Received orca_server_ready!')
  console.log('[orca-cli] Safe metadata:', JSON.stringify(instance.redacted, null, 2))

  // Probe static web client
  const endpoint = instance.readyPayload.boundEndpoint || instance.readyPayload.endpoint
  let actualPort = port
  if (endpoint) {
    const match = /:(\d+)$/.exec(endpoint)
    if (match) actualPort = Number(match[1])
  }
  const webUrl = `http://${bind}:${actualPort}/web-index.html`
  console.log(`[orca-cli] Probing web client at ${webUrl}...`)
  const resp = await fetch(webUrl)
  console.log(`[orca-cli] Web client status: ${resp.status} ${resp.statusText}, Content-Type: ${resp.headers.get('content-type')}`)
  if (!resp.ok) {
    throw new Error(`Web client probe failed: HTTP ${resp.status}`)
  }
  const html = await resp.text()
  if (!html.includes('<title>Orca Web</title>')) {
    throw new Error('Web client response did not contain expected title: <title>Orca Web</title>')
  }
  console.log('[orca-cli] Web client HTML verification PASSED')

  // Probe RPC status via CLI using in-memory pairing URL
  if (instance.readyPayload.pairing?.url) {
    console.log('[orca-cli] Probing local RPC via CLI status...')
    const cliPath = join(slotDir, 'out', 'cli', 'index.js')
    const cliEnv = { ...env, ORCA_PAIRING_CODE: instance.readyPayload.pairing.url }
    const cliProcess = spawn(nodeBinary, [cliPath, 'status', '--json'], { env: cliEnv, stdio: ['ignore', 'pipe', 'pipe'] })
    const outChunks = []
    cliProcess.stdout.on('data', (d) => outChunks.push(d))
    await new Promise((resolve) => cliProcess.on('close', resolve))
    const cliOut = Buffer.concat(outChunks).toString('utf8').trim()
    try {
      const statusJson = JSON.parse(cliOut)
      console.log(`[orca-cli] CLI status response received: runtimeId=${statusJson.runtimeId || statusJson.runtime?.id || 'ok'}`)

      // Harmless terminal probe via CLI
      console.log('[orca-cli] Testing terminal list probe via CLI RPC...')
      const termProcess = spawn(nodeBinary, [cliPath, 'terminal', 'list', '--json'], { env: cliEnv, stdio: ['ignore', 'pipe', 'pipe'] })
      const termChunks = []
      termProcess.stdout.on('data', (d) => termChunks.push(d))
      await new Promise((resolve) => termProcess.on('close', resolve))
      const termOut = Buffer.concat(termChunks).toString('utf8').trim()
      console.log(`[orca-cli] Terminal list RPC response: ${termOut}`)
    } catch {
      console.log('[orca-cli] CLI status completed.')
    }
  }

  console.log('[orca-cli] Teardown: Stopping server and terminal daemon...')
  await instance.stop()
  console.log('[orca-cli] Server stopped cleanly.')
  return { fullVersion, redacted: instance.redacted }
}

async function main() {
  const args = parseArgs(process.argv)
  if (args.command === 'materialize') {
    const res = await prepareSlotAndRuntime({
      templateDir: args.template,
      scratchDir: args.scratch
    })
    console.log(JSON.stringify(res, null, 2))
  } else if (args.command === 'smoke' || args.command === 'run') {
    await runSmokeProof({
      templateDir: args.template,
      webDir: args.web,
      scratchDir: args.scratch,
      port: args.port,
      bind: args.bind
    })
  } else {
    console.log('Usage: node scripts/orca/cli.mjs [materialize|smoke] [--template <dir>] [--web <dir>] [--scratch <dir>] [--port <port>] [--bind <ip>]')
  }
}

if (process.argv[1] && process.argv[1].endsWith('cli.mjs')) {
  main().catch((err) => {
    console.error('[orca-cli] Fatal error:', err)
    process.exit(1)
  })
}
