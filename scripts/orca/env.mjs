/**
 * Isolated process environment for Orca runtime execution.
 * Fences HOME, XDG, user-data, and temporary directories to scratch.
 * Strips DISPLAY and provider credentials.
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const SECRET_KEY_PATTERN = /(?:KEY|TOKEN|SECRET|AUTH|COOKIE|PASSWORD|CREDENTIAL|PRIVATE)/i
const DISPLAY_VARS = ['DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'MIR_SOCKET']

export function createIsolatedEnv({ scratchDir, baseEnv = process.env } = {}) {
  if (!scratchDir) {
    throw new Error('scratchDir is required for isolated environment creation')
  }

  const env = {}

  // Copy safe base environment variables
  for (const [key, value] of Object.entries(baseEnv)) {
    if (DISPLAY_VARS.includes(key)) continue
    if (SECRET_KEY_PATTERN.test(key)) continue
    // Filter user's specific dotfile or credential configs
    if (key.startsWith('npm_') || key.startsWith('CARGO_')) continue
    env[key] = value
  }

  // Set explicit isolated directories under scratch
  const isolatedHome = join(scratchDir, 'home')
  const isolatedUserData = join(scratchDir, 'user-data')
  const isolatedTmp = join(scratchDir, 'tmp')

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
  env.ORCA_VERSION = '1.4.230'

  // Standard POSIX shell
  if (!env.SHELL) {
    env.SHELL = '/bin/bash'
  }

  return env
}

export async function ensureIsolatedDirectories(scratchDir) {
  const dirs = [
    scratchDir,
    join(scratchDir, 'home'),
    join(scratchDir, 'home', '.config'),
    join(scratchDir, 'home', '.local', 'share'),
    join(scratchDir, 'home', '.local', 'state'),
    join(scratchDir, 'home', '.cache'),
    join(scratchDir, 'user-data'),
    join(scratchDir, 'tmp'),
    join(scratchDir, 'runtimes'),
    join(scratchDir, 'slots')
  ]

  for (const d of dirs) {
    await mkdir(d, { recursive: true, mode: 0o700 })
  }
}
