import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createIsolatedEnv } from './env.mjs'

describe('isolated environment', () => {
  it('creates minimal isolated environment and strips secrets/DISPLAY', () => {
    const parentEnv = {
      PATH: '/usr/local/bin:/usr/bin:/bin',
      HOME: '/home/antinrml',
      USER: 'antinrml',
      DISPLAY: ':0',
      WAYLAND_DISPLAY: 'wayland-0',
      OPENAI_API_KEY: 'sk-secret123',
      ANTHROPIC_API_KEY: 'sk-ant-secret456',
      GITHUB_TOKEN: 'ghp_secret789',
      MSO_SECRET: 'mso-token',
      CLERK_SECRET_KEY: 'clerk-secret'
    }

    const scratchDir = '/home/antinrml/.hermes/cache/scratch/orca-runtime-proof-20261019'
    const env = createIsolatedEnv({ scratchDir, baseEnv: parentEnv })

    // Secrets & display stripped
    assert.equal(env.DISPLAY, undefined)
    assert.equal(env.WAYLAND_DISPLAY, undefined)
    assert.equal(env.OPENAI_API_KEY, undefined)
    assert.equal(env.ANTHROPIC_API_KEY, undefined)
    assert.equal(env.GITHUB_TOKEN, undefined)
    assert.equal(env.MSO_SECRET, undefined)
    assert.equal(env.CLERK_SECRET_KEY, undefined)

    // Isolated home & XDG dirs set under scratch
    assert.equal(env.HOME, `${scratchDir}/home`)
    assert.equal(env.ORCA_USER_DATA, `${scratchDir}/user-data`)
    assert.equal(env.ORCA_USER_DATA_PATH, `${scratchDir}/user-data`)
    assert.equal(env.TMPDIR, `${scratchDir}/tmp`)
    assert.equal(env.XDG_CONFIG_HOME, `${scratchDir}/home/.config`)
    assert.equal(env.XDG_DATA_HOME, `${scratchDir}/home/.local/share`)
    assert.equal(env.XDG_CACHE_HOME, `${scratchDir}/home/.cache`)
    assert.equal(env.XDG_STATE_HOME, `${scratchDir}/home/.local/state`)

    // Telemetry and auto-updates disabled
    assert.equal(env.DO_NOT_TRACK, '1')
    assert.equal(env.ORCA_TELEMETRY_DISABLED, '1')
    assert.equal(env.ORCA_DIAGNOSTICS_DISABLED, '1')
  })
})
