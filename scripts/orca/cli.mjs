#!/usr/bin/env node
/**
 * Hardened Orca runtime CLI: strict argument parsing, pinned-release
 * preparation, disposable smoke proof (PTY echo), and a real persistent
 * supervised run. There is no unchecked `--template`/`--web` bypass.
 */

import { prepareRelease } from './lifecycle-release.mjs'
import { runSmokeProof } from './smoke.mjs'
import { runSupervisedRuntime } from './supervision.mjs'
import { assertConfiguredAdvertisedEndpoint, assertPersistentPort } from './supervision.mjs'
import { redactSensitiveText } from './bounded-proc.mjs'

const COMMANDS = new Set(['materialize', 'smoke', 'run', 'help'])

const VALUE_FLAGS = new Map([
  ['--managed-root', 'managedRoot'],
  ['--port', 'port'],
  ['--bind', 'bind'],
  ['--advertised-endpoint', 'advertisedEndpoint'],
  ['--deb', 'deb']
])

const BOOLEAN_FLAGS = new Map([['--allow-download', 'allowDownload']])

const USAGE = `Usage: node scripts/orca/cli.mjs <command> --managed-root <dir> [flags]

Commands:
  materialize  Prepare and verify the pinned release slot + Node runtime.
  smoke        Disposable loopback launch, web probe, and real PTY echo proof.
               Cleans the task-owned server and terminal daemon.
  run          Persistent supervised server on a fixed port; stays alive until
               the server dies or SIGINT/SIGTERM, then preserves the daemon.
  help         Show this message.

Flags:
  --managed-root <dir>          Absolute MSO-owned state root (required).
  --port <n>                    Port 1-65535 for run; 0 is smoke-only.
  --bind <ip>                   Loopback bind address (default 127.0.0.1).
  --advertised-endpoint <url>   Configured public wss URL (required for run).
  --deb <path>                  Already-verified Orca .deb for acquisition.
  --allow-download              Permit the pinned deb/Node download.
`

export function parseArgs(argv) {
  if (!Array.isArray(argv) || argv.length < 2) throw new Error('invalid argv')
  const command = argv[2] ?? 'help'
  if (command.startsWith('-')) throw new Error(`missing command before ${command}`)
  if (!COMMANDS.has(command)) throw new Error(`unknown command: ${command}`)

  const args = { command }
  const seen = new Set()
  for (let i = 3; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`)
    if (seen.has(token)) throw new Error(`duplicate flag: ${token}`)
    seen.add(token)

    if (BOOLEAN_FLAGS.has(token)) {
      args[BOOLEAN_FLAGS.get(token)] = true
      continue
    }
    if (!VALUE_FLAGS.has(token)) throw new Error(`unknown flag: ${token}`)
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`missing value for ${token}`)
    i += 1
    if (token === '--port') {
      if (!/^\d+$/.test(value)) throw new Error(`port must be an integer, got: ${value}`)
      args.port = Number(value)
    } else {
      args[VALUE_FLAGS.get(token)] = value
    }
  }
  return args
}

function requireManagedRoot(args) {
  if (!args.managedRoot) throw new Error(`${args.command} requires --managed-root <dir>`)
  return args.managedRoot
}

export async function main(argv, { log = console } = {}) {
  const args = parseArgs(argv)
  if (args.command === 'help') {
    log.log(USAGE.trimEnd())
    return { command: 'help' }
  }

  const managedRoot = requireManagedRoot(args)
  // Validate the run-only configuration BEFORE acquisition: a bad advertised
  // endpoint must not trigger a download or rehash first.
  if (args.command === 'run') {
    assertPersistentPort(args.port)
    assertConfiguredAdvertisedEndpoint(args.advertisedEndpoint)
  }

  const release = await prepareRelease({
    managedRoot,
    debPath: args.deb,
    allowDownload: args.allowDownload === true
  })

  if (args.command === 'materialize') {
    log.log(JSON.stringify({
      version: release.version,
      releaseRoot: release.releaseRoot,
      slotDir: release.slotDir,
      nodeBinary: release.nodeBinary,
      webDir: release.webDir
    }, null, 2))
    return { command: 'materialize', release }
  }

  if (args.command === 'smoke') {
    const result = await runSmokeProof({
      release,
      managedRoot,
      port: args.port ?? 0,
      bind: args.bind,
      advertisedEndpoint: args.advertisedEndpoint,
      log
    })
    log.log(`[orca-cli] Smoke proof PASSED (${result.version})`)
    return { command: 'smoke', release, result }
  }

  const result = await runSupervisedRuntime({
    release,
    managedRoot,
    port: args.port,
    bind: args.bind,
    advertisedEndpoint: args.advertisedEndpoint,
    log
  })
  return { command: 'run', release, result }
}

if (process.argv[1] && process.argv[1].endsWith('cli.mjs')) {
  main(process.argv).catch((err) => {
    console.error(`[orca-cli] Fatal error: ${redactSensitiveText(err.message)}`)
    process.exitCode = 1
  })
}
