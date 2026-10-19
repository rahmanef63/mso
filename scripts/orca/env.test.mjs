import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdir, symlink, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { createIsolatedEnv, ensureIsolatedDirectories, assertSafeScratchRoot } from './env.mjs'

describe('isolated environment with strict allowlist', () => {
  it('inherits only locale/terminal vars and fences every writable path', () => {
    const parentEnv = {
      PATH: '/custom/bin:/usr/local/bin:/usr/bin:/bin',
      HOME: '/home/antinrml',
      USER: 'antinrml',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      TERM: 'xterm-256color',
      DISPLAY: ':0',
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
      OPENAI_API_KEY: 'sk-secret123',
      LANG_EVIL: 'nope'
    }

    const scratchDir = '/tmp/scratch-test'
    const env = createIsolatedEnv({ scratchDir, baseEnv: parentEnv })

    assert.equal(env.LANG, 'en_US.UTF-8')
    assert.equal(env.LC_ALL, 'en_US.UTF-8')
    assert.equal(env.TERM, 'xterm-256color')

    for (const key of [
      'NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'BASH_ENV', 'ENV',
      'PYTHONPATH', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'SSH_AUTH_SOCK',
      'ORCA_SECRET_INHERITED', 'DISPLAY', 'OPENAI_API_KEY', 'LANG_EVIL'
    ]) {
      assert.equal(env[key], undefined, `${key} leaked into the isolated env`)
    }

    assert.equal(env.PATH, '/usr/local/bin:/usr/bin:/bin')
    assert.equal(env.HOME, '/tmp/scratch-test/runtime/home')
    assert.equal(env.ORCA_USER_DATA, '/tmp/scratch-test/runtime/user-data')
    assert.equal(env.TMPDIR, '/tmp/scratch-test/runtime/tmp')
    assert.equal(env.HISTFILE, '/tmp/scratch-test/runtime/home/.bash_history')
    assert.equal(env.ORCA_VERSION, '1.4.230')
    assert.equal(env.DO_NOT_TRACK, '1')
  })

  it('rejects symlinked scratch roots and symlinked ancestors', async () => {
    const testDir = join(tmpdir(), `orca-scratch-${randomUUID()}`)
    await mkdir(testDir, { recursive: true })
    const realDir = join(testDir, 'real')
    await mkdir(realDir, { mode: 0o700 })
    const link = join(testDir, 'link-scratch')
    await symlink(realDir, link)
    await assert.rejects(() => ensureIsolatedDirectories(link), /symlink/i)

    const nested = join(link, 'nested')
    await assert.rejects(() => ensureIsolatedDirectories(nested), /symlink/i)

    await rm(testDir, { recursive: true, force: true })
  })

  it('refuses git worktree roots and credential/user-state paths', async () => {
    const testDir = join(tmpdir(), `orca-scratch-git-${randomUUID()}`)
    await mkdir(testDir, { recursive: true, mode: 0o700 })
    await mkdir(join(testDir, '.git'))
    assert.throws(() => assertSafeScratchRoot(testDir), /git worktree/i)

    assert.throws(() => assertSafeScratchRoot('/'), /filesystem root/i)
    assert.throws(() => assertSafeScratchRoot(join(process.env.HOME, '.orca')), /credential|user-state/i)
    assert.throws(() => assertSafeScratchRoot(join(process.env.HOME, '.hermes')), /credential/i)
    assert.doesNotThrow(() => assertSafeScratchRoot(join(process.env.HOME, '.hermes', 'cache', 'scratch', 'x')))

    await rm(testDir, { recursive: true, force: true })
  })

  it('creates the private runtime tree at 0700 and tightens loose existing dirs', async () => {
    const root = join(tmpdir(), `orca-scratch-tree-${randomUUID()}`)
    try {
      await ensureIsolatedDirectories(root)
      for (const dir of ['', 'runtime', 'runtime/home', 'runtime/user-data', 'runtime/tmp']) {
        assert.equal((await stat(join(root, dir))).mode & 0o777, 0o700, `${dir || 'root'} is not 0700`)
      }

      const loose = join(root, 'runtime', 'tmp')
      await import('node:fs/promises').then((fs) => fs.chmod(loose, 0o755))
      await ensureIsolatedDirectories(root)
      assert.equal((await stat(loose)).mode & 0o777, 0o700)
      await writeFile(join(loose, 'probe.txt'), 'ok')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
