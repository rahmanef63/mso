/**
 * Isolated process environment for Orca runtime execution.
 * Strict allowlist, private HOME/XDG/TMP/HISTFILE, and safe scratch-root fencing.
 * This is environment isolation (same Unix account), not an OS sandbox.
 */

import { chmod, lstat } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { ORCA_VERSION } from './constants.mjs'
import { ensureManagedRoot } from './private-store.mjs'

const ALLOWLISTED_PARENT_KEYS = ['LANG', 'LANGUAGE', 'TERM', 'TZ']
const ALLOWLISTED_PREFIXES = ['LC_']
const SAFE_PATH = '/usr/local/bin:/usr/bin:/bin'

function allowedKey(key) {
  return ALLOWLISTED_PARENT_KEYS.includes(key) || ALLOWLISTED_PREFIXES.some((p) => key.startsWith(p))
}

function cleanValue(value) {
  if (typeof value !== 'string' || value.length > 128) return null
  if (/[\0\r\n]/.test(value)) return null
  return value
}

export function createIsolatedEnv({ scratchDir, baseEnv = process.env } = {}) {
  if (!scratchDir) throw new Error('scratchDir is required for isolated environment creation')
  const runtimeRoot = join(resolve(scratchDir), 'runtime')
  const env = {}
  for (const key of Object.keys(baseEnv)) {
    if (!allowedKey(key)) continue
    const value = cleanValue(baseEnv[key])
    if (value !== null) env[key] = value
  }
  env.PATH = SAFE_PATH
  env.SHELL = '/bin/bash'
  env.HOME = join(runtimeRoot, 'home')
  env.HISTFILE = join(env.HOME, '.bash_history')
  env.ORCA_USER_DATA = join(runtimeRoot, 'user-data')
  env.ORCA_USER_DATA_PATH = env.ORCA_USER_DATA
  env.TMPDIR = join(runtimeRoot, 'tmp')
  env.XDG_CONFIG_HOME = join(env.HOME, '.config')
  env.XDG_DATA_HOME = join(env.HOME, '.local', 'share')
  env.XDG_CACHE_HOME = join(env.HOME, '.cache')
  env.XDG_STATE_HOME = join(env.HOME, '.local', 'state')
  env.DO_NOT_TRACK = '1'
  env.ORCA_TELEMETRY_DISABLED = '1'
  env.ORCA_DIAGNOSTICS_DISABLED = '1'
  env.ORCA_VERSION = ORCA_VERSION
  return env
}

const DENIED_HOME_PATHS = ['.orca', '.orca-remote', '.codex', '.claude', '.ssh', '.gnupg', '.config']

/** Reject canonical/worktree roots and credential-storage locations. */
export function assertSafeScratchRoot(scratchDir) {
  const abs = resolve(scratchDir)
  if (!isAbsolute(abs)) throw new Error(`scratch root must be absolute: ${scratchDir}`)
  if (abs === sep) throw new Error('refusing filesystem root as scratch root')
  const home = resolve(homedir())
  if (abs === home) throw new Error('refusing home directory as scratch root')
  for (const denied of DENIED_HOME_PATHS) {
    const prefix = join(home, denied)
    if (abs === prefix || abs.startsWith(`${prefix}${sep}`)) {
      throw new Error(`refusing credential/user-state path as scratch root: ${abs}`)
    }
  }
  const hermes = join(home, '.hermes')
  const hermesScratch = join(hermes, 'cache', 'scratch')
  if ((abs === hermes || abs.startsWith(`${hermes}${sep}`)) && abs !== hermesScratch && !abs.startsWith(`${hermesScratch}${sep}`)) {
    throw new Error(`refusing .hermes credential storage as scratch root: ${abs}`)
  }
  // Reject a git checkout/worktree root (canonical or registered).
  let current = abs
  for (;;) {
    if (lstatSync(join(current, '.git'), { throwIfNoEntry: false })) {
      throw new Error(`refusing git worktree/repository path as scratch root: ${abs}`)
    }
    const parent = resolve(current, '..')
    if (parent === current) break
    current = parent
  }
  return abs
}

/** Create the private directory tree: 0700, owned, no symlinked ancestors. */
export async function ensureIsolatedDirectories(scratchDir) {
  const root = assertSafeScratchRoot(scratchDir)
  await ensureManagedRoot(root)
  const dirs = [
    join(root, 'runtime'),
    join(root, 'runtime', 'home'),
    join(root, 'runtime', 'home', '.config'),
    join(root, 'runtime', 'home', '.local', 'share'),
    join(root, 'runtime', 'home', '.local', 'state'),
    join(root, 'runtime', 'home', '.cache'),
    join(root, 'runtime', 'user-data'),
    join(root, 'runtime', 'tmp'),
    join(root, 'slots'),
    join(root, 'runtimes')
  ]
  for (const dir of dirs) {
    await ensureManagedRoot(dir)
    const info = await lstat(dir)
    if (info.isSymbolicLink()) throw new Error(`refusing symlink directory: ${dir}`)
    if (info.uid !== process.getuid()) throw new Error(`directory is not owned by this user: ${dir}`)
    if ((info.mode & 0o077) !== 0) await chmod(dir, 0o700)
  }
  return root
}
