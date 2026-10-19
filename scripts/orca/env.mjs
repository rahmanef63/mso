/**
 * Isolated process environment for Orca runtime execution.
 * Enforces strict allowlist of system variables, stripping all injection/preload/credential vectors.
 * Fences HOME, XDG, user-data, and temporary directories to scratch.
 * Note: Scratch directory fencing is process isolation, not an OS sandbox (no container/chroot).
 */

import { lstat, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ORCA_VERSION } from './constants.mjs'

const ALLOWLISTED_PARENT_KEYS = ['LANG', 'LC_ALL', 'LC_CTYPE', 'TERM']

export function createIsolatedEnv({ scratchDir, baseEnv = process.env } = {}) {
  if (!scratchDir) {
    throw new Error('scratchDir is required for isolated environment creation')
  }

  const env = {}

  // Inherit ONLY explicitly allowlisted non-sensitive parent vars
  for (const key of ALLOWLISTED_PARENT_KEYS) {
    if (baseEnv[key] !== undefined) {
      env[key] = baseEnv[key]
    }
  }

  // Fenced directories under scratch
  const isolatedHome = join(scratchDir, 'home')
  const isolatedUserData = join(scratchDir, 'user-data')
  const isolatedTmp = join(scratchDir, 'tmp')

  env.PATH = '/usr/local/bin:/usr/bin:/bin'
  env.SHELL = '/bin/bash'
  env.HISTFILE = join(isolatedHome, '.bash_history')
  env.HOME = isolatedHome
  env.ORCA_USER_DATA = isolatedUserData
  env.ORCA_USER_DATA_PATH = isolatedUserData
  env.TMPDIR = isolatedTmp
  env.XDG_CONFIG_HOME = join(isolatedHome, '.config')
  env.XDG_DATA_HOME = join(isolatedHome, '.local', 'share')
  env.XDG_CACHE_HOME = join(isolatedHome, '.cache')
  env.XDG_STATE_HOME = join(isolatedHome, '.local', 'state')

  // Upstream-supported telemetry & diagnostic disablement
  env.DO_NOT_TRACK = '1'
  env.ORCA_TELEMETRY_DISABLED = '1'
  env.ORCA_DIAGNOSTICS_DISABLED = '1'
  env.ORCA_VERSION = ORCA_VERSION

  return env
}

export async function ensureIsolatedDirectories(scratchDir) {
  try {
    const s = await lstat(scratchDir)
    if (s.isSymbolicLink()) {
      throw new Error(`Refusing symlink scratch directory: ${scratchDir}`)
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }

  const dirs = [
    scratchDir,
    join(scratchDir, 'home'),
    join(scratchDir, 'home', '.config'),
    join(scratchDir, 'home', '.local', 'share'),
    join(scratchDir, 'home', '.local', 'state'),
    join(scratchDir, 'home', '.cache'),
    join(scratchDir, 'user-data'),
    join(scratchDir, 'tmp'),
    join(scratchDir, 'slots'),
    join(scratchDir, 'runtimes')
  ]

  for (const d of dirs) {
    try {
      const s = await lstat(d)
      if (s.isSymbolicLink()) throw new Error(`Refusing symlink directory: ${d}`)
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }
    await mkdir(d, { recursive: true, mode: 0o700 })
  }
}
