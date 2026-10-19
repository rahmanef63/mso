import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdir, symlink, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { createIsolatedEnv, ensureIsolatedDirectories } from './env.mjs'

describe('isolated environment with strict allowlist', () => {
  it('enforces strict allowlist and excludes unsafe env vars', () => {
    const parentEnv = {
      PATH: '/custom/bin:/usr/local/bin:/usr/bin:/bin',
      HOME: '/home/antinrml',
      USER: 'antinrml',
      LANG: 'en_US.UTF-8',
      TERM: 'xterm-256color',
      DISPLAY: ':0',
      WAYLAND_DISPLAY: 'wayland-0',
      NODE_OPTIONS: '--inspect=0.0.0.0',
      NODE_PATH: '/malicious/node_modules',
      LD_PRELOAD: '/malicious/lib.so',
      LD_LIBRARY_PATH: '/malicious/lib',
      BASH_ENV: '/malicious/bashrc',
      ENV: '/malicious/env',
      PYTHONPATH: '/malicious/python',
      CODEX_HOME: '/home/antinrml/.codex',
      CLAUDE_CONFIG_DIR: '/home/antinrml/.claude',
      SSH_AUTH_SOCK: '/tmp/ssh-agent.sock',
      ORCA_SECRET_INHERITED: 'leak',
      OPENAI_API_KEY: 'sk-secret123'
    }

    const scratchDir = '/tmp/scratch-test'
    const env = createIsolatedEnv({ scratchDir, baseEnv: parentEnv })

    // Only allowlisted inherited vars
    assert.equal(env.LANG, 'en_US.UTF-8')
    assert.equal(env.TERM, 'xterm-256color')

    // Dangerous vars stripped
    assert.equal(env.NODE_OPTIONS, undefined)
    assert.equal(env.NODE_PATH, undefined)
    assert.equal(env.LD_PRELOAD, undefined)
    assert.equal(env.LD_LIBRARY_PATH, undefined)
    assert.equal(env.BASH_ENV, undefined)
    assert.equal(env.ENV, undefined)
    assert.equal(env.PYTHONPATH, undefined)
    assert.equal(env.CODEX_HOME, undefined)
    assert.equal(env.CLAUDE_CONFIG_DIR, undefined)
    assert.equal(env.SSH_AUTH_SOCK, undefined)
    assert.equal(env.ORCA_SECRET_INHERITED, undefined)
    assert.equal(env.DISPLAY, undefined)
    assert.equal(env.OPENAI_API_KEY, undefined)

    // Controlled isolated dirs
    assert.equal(env.HOME, '/tmp/scratch-test/home')
    assert.equal(env.ORCA_USER_DATA, '/tmp/scratch-test/user-data')
    assert.equal(env.ORCA_VERSION, '1.4.230')
    assert.equal(env.DO_NOT_TRACK, '1')
    assert.equal(env.HISTFILE, '/tmp/scratch-test/home/.bash_history')
  })

  it('rejects symlink directories in ensureIsolatedDirectories', async () => {
    const testDir = join(tmpdir(), `test-scratch-symlink-${randomUUID()}`)
    await mkdir(testDir, { recursive: true })
    const realDir = join(testDir, 'real')
    await mkdir(realDir)
    const symlinkDir = join(testDir, 'symlink-scratch')
    await symlink(realDir, symlinkDir)

    await assert.rejects(
      async () => {
        await ensureIsolatedDirectories(symlinkDir)
      },
      { message: /symlink/i }
    )

    await rm(testDir, { recursive: true, force: true })
  })
})
