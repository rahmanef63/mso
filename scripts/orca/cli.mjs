#!/usr/bin/env node
/**
 * Hardened Orca runtime CLI helper: materialization, isolated execution, and health proof.
 */

import { existsSync } from 'node:fs'
import { copyFile, chmod, mkdir, symlink } from 'node:fs/promises'
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
import { acquireAndExtractDeb } from './artifact-source.mjs'
import { initScratchGitRepo, verifyRealTerminalEcho } from './terminal-proof.mjs'

export function parseArgs(argv) {
  const args = { command: argv[2] || 'help' }
  for (let i = 3; i < argv.length; i += 1) {
    if (argv[i] === '--deb') args.deb = argv[++i]
    else if (argv[i] === '--template') args.template = argv[++i]
    else if (argv[i] === '--web') args.web = argv[++i]
    else if (argv[i] === '--scratch') args.scratch = argv[++i]
    else if (argv[i] === '--port') args.port = Number(argv[++i])
    else if (argv[i] === '--bind') args.bind = argv[++i]
    else if (argv[i] === '--allow-download') args.allowDownload = true
  }
  return args
}

export async function prepareSlotAndRuntime({
  debPath,
  templateDir,
  webDir,
  scratchDir,
  allowDownload = false
} = {}) {
  if (!scratchDir) throw new Error('--scratch directory is required')
  await ensureIsolatedDirectories(scratchDir)

  let resolvedTemplate = templateDir
  let resolvedWeb = webDir

  if (!resolvedTemplate || !resolvedWeb) {
    const extractDir = join(scratchDir, 'upstream-extracted')
    const extracted = await acquireAndExtractDeb({ debPath, extractDir, allowDownload })
    resolvedTemplate = extracted.templateDir
    resolvedWeb = extracted.webDir
  }

  const slotsRoot = join(scratchDir, 'slots', SUPPORTED_TARGET)
  const runtimesRoot = join(scratchDir, 'slots', SUPPORTED_TARGET, ORCAD_RUNTIMES_DIRNAME)

  const nodeBinary = await fetchAndMaterializeNodeRuntime({
    target: SUPPORTED_TARGET,
    runtimesDir: runtimesRoot,
    allowDownload
  })

  const tempSlotDir = join(slotsRoot, 'active')
  const { slotDir, fullVersion } = await materializeOrcadSlot({
    templateDir: resolvedTemplate,
    outputSlotDir: tempSlotDir,
    target: SUPPORTED_TARGET
  })

  const slotExpectedNode = join(
    slotDir,
    '..',
    ORCAD_RUNTIMES_DIRNAME,
    `${ORCAD_NODE_RUNTIME_DIR_PREFIX}${PINNED_NODE.executableSha256}`,
    ...ORCAD_NODE_RUNTIME_POSIX_EXECUTABLE.split('/')
  )

  if (!existsSync(slotExpectedNode)) {
    await mkdir(dirname(slotExpectedNode), { recursive: true, mode: 0o700 })
    try {
      await symlink(nodeBinary, slotExpectedNode)
    } catch {
      await copyFile(nodeBinary, slotExpectedNode)
      await chmod(slotExpectedNode, 0o755)
    }
  }

  return { slotDir, nodeBinary, fullVersion, templateDir: resolvedTemplate, webDir: resolvedWeb }
}

export async function runSmokeProof({
  debPath,
  templateDir,
  webDir,
  scratchDir,
  port = DEFAULT_PORT,
  bind = DEFAULT_BIND,
  allowDownload = false
} = {}) {
  if (!scratchDir) throw new Error('--scratch directory is required')
  console.log(`[orca-cli] Preparing slot and pinned Node in ${scratchDir}...`)
  const prepared = await prepareSlotAndRuntime({ debPath, templateDir, webDir, scratchDir, allowDownload })
  const { slotDir, nodeBinary, fullVersion, webDir: actualWebDir } = prepared
  console.log(`[orca-cli] Slot materialized: ${slotDir} (${fullVersion})`)
  console.log(`[orca-cli] Node runtime verified: ${nodeBinary}`)

  const env = createIsolatedEnv({ scratchDir })
  const privateStatusPath = join(scratchDir, 'private-status.json')

  console.log(`[orca-cli] Launching orcad-server on ${bind}:${port}...`)
  const instance = await launchOrcadServer({
    nodeBinary,
    slotDir,
    options: { bind, port, webClientRoot: actualWebDir },
    env,
    timeoutMs: 30000,
    privateStatusPath
  })

  try {
    console.log('[orca-cli] Received orca_server_ready!')
    console.log('[orca-cli] Safe metadata:', JSON.stringify(instance.redacted, null, 2))

    const endpoint = instance.readyPayload.boundEndpoint || instance.readyPayload.endpoint
    let actualPort = port
    if (endpoint) {
      const match = /:(\d+)$/.exec(endpoint)
      if (match) actualPort = Number(match[1])
    }
    const webUrl = `http://${bind}:${actualPort}/web-index.html`
    console.log(`[orca-cli] Probing web client at ${webUrl}...`)
    const resp = await fetch(webUrl)
    console.log(`[orca-cli] Web client status: ${resp.status} ${resp.statusText}`)
    if (!resp.ok) throw new Error(`Web client probe failed: HTTP ${resp.status}`)
    const html = await resp.text()
    if (!html.includes('<title>Orca Web</title>')) {
      throw new Error('Web client HTML did not contain <title>Orca Web</title>')
    }
    console.log('[orca-cli] Web client probe PASSED')

    if (!instance.readyPayload.pairing?.url) throw new Error('Missing pairing URL in readiness payload')

    const cliPath = join(slotDir, 'out', 'cli', 'index.js')
    const cliEnv = { ...env, ORCA_PAIRING_CODE: instance.readyPayload.pairing.url }
    const testRepo = await initScratchGitRepo(join(scratchDir, 'proof-repo'))
    const echoToken = `ORCA_ECHO_PASSED_${Date.now()}`

    console.log(`[orca-cli] Executing real PTY terminal echo roundtrip with token: ${echoToken}...`)
    await verifyRealTerminalEcho({ nodeBinary, cliPath, cliEnv, testRepo, echoToken })
    console.log('[orca-cli] Real PTY echo verification PASSED')

    return { fullVersion, redacted: instance.redacted, echoTokenVerified: true }
  } finally {
    console.log('[orca-cli] Stopping server and terminal daemon...')
    await instance.stop()
    console.log('[orca-cli] Server stopped cleanly.')
  }
}

async function main() {
  const args = parseArgs(process.argv)
  if (args.command === 'materialize') {
    const res = await prepareSlotAndRuntime({
      debPath: args.deb,
      templateDir: args.template,
      webDir: args.web,
      scratchDir: args.scratch,
      allowDownload: args.allowDownload
    })
    console.log(JSON.stringify(res, null, 2))
  } else if (args.command === 'smoke' || args.command === 'run') {
    await runSmokeProof({
      debPath: args.deb,
      templateDir: args.template,
      webDir: args.web,
      scratchDir: args.scratch,
      port: args.port,
      bind: args.bind,
      allowDownload: args.allowDownload
    })
  } else {
    console.log('Usage: node scripts/orca/cli.mjs [materialize|smoke] --scratch <dir> [--deb <path>] [--template <dir>] [--web <dir>] [--port <port>] [--bind <ip>] [--allow-download]')
  }
}

if (process.argv[1] && process.argv[1].endsWith('cli.mjs')) {
  main().catch((err) => {
    console.error('[orca-cli] Fatal error:', err)
    process.exit(1)
  })
}
