import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyRealTerminalEcho } from './terminal-proof.mjs'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
const FAKE_CLI = join(FIXTURES, 'fake-orca-cli.mjs')
const NODE = process.execPath
const TOKEN = 'ORCA_ECHO_TEST_123'

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitGone(pid, timeoutMs = 3000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (!alive(pid)) return true
    await new Promise((r) => setTimeout(r, 25))
  }
  return !alive(pid)
}

async function setup(mode) {
  const dir = await mkdtemp(join(tmpdir(), 'orca-terminal-'))
  const logPath = join(dir, 'cli.log')
  const env = {
    PATH: '/usr/local/bin:/usr/bin:/bin',
    FAKE_CLI_MODE: mode,
    FAKE_CLI_TOKEN: TOKEN,
    FAKE_CLI_LOG: logPath
  }
  return { dir, logPath, env }
}

const readLog = (p) => readFile(p, 'utf8').catch(() => '')

describe('strict terminal echo proof', () => {
  it('requires one owned terminal, observes its output line, and closes it', async () => {
    const { dir, logPath, env } = await setup('normal')
    try {
      const result = await verifyRealTerminalEcho({
        nodeBinary: NODE,
        cliPath: FAKE_CLI,
        cliEnv: env,
        testRepo: dir,
        echoToken: TOKEN,
        echoDeadlineMs: 2000,
        pollMs: 20
      })
      assert.equal(result.ok, true)
      assert.equal(result.termHandle, 'term-abc')
      const log = await readLog(logPath)
      assert.match(log, /terminal create --worktree path:/)
      assert.match(log, /terminal read --terminal term-abc/)
      assert.match(log, /terminal close --terminal term-abc/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects when only the echoed input command is visible, not its output', async () => {
    const { dir, logPath, env } = await setup('no-echo')
    try {
      await assert.rejects(
        () =>
          verifyRealTerminalEcho({
            nodeBinary: NODE,
            cliPath: FAKE_CLI,
            cliEnv: env,
            testRepo: dir,
            echoToken: TOKEN,
            echoDeadlineMs: 400,
            pollMs: 20
          }),
        /not observed as an output line/i
      )
      assert.match(await readLog(logPath), /terminal close --terminal term-abc/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('fails before closing when terminal creation is not ok', async () => {
    const { dir, logPath, env } = await setup('create-fail')
    try {
      await assert.rejects(
        () =>
          verifyRealTerminalEcho({
            nodeBinary: NODE,
            cliPath: FAKE_CLI,
            cliEnv: env,
            testRepo: dir,
            echoToken: TOKEN,
            echoDeadlineMs: 400,
            pollMs: 20
          }),
        /terminal create was not ok: create denied/
      )
      assert.doesNotMatch(await readLog(logPath), /terminal close/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('surfaces a close failure after a successful echo', async () => {
    const { dir, env } = await setup('close-fail')
    try {
      await assert.rejects(
        () =>
          verifyRealTerminalEcho({
            nodeBinary: NODE,
            cliPath: FAKE_CLI,
            cliEnv: env,
            testRepo: dir,
            echoToken: TOKEN,
            echoDeadlineMs: 2000,
            pollMs: 20
          }),
        /terminal close was not ok: close denied/
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects a nonzero CLI exit instead of parsing stdout', async () => {
    const { dir, env } = await setup('exit-nonzero')
    try {
      await assert.rejects(
        () =>
          verifyRealTerminalEcho({
            nodeBinary: NODE,
            cliPath: FAKE_CLI,
            cliEnv: env,
            testRepo: dir,
            echoToken: TOKEN
          }),
        /repo add exited 4/
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects invalid JSON and non-ok payloads', async () => {
    const { dir: badDir, env: badEnv } = await setup('invalid-json')
    const { dir: failDir, env: failEnv } = await setup('repo-fail')
    try {
      await assert.rejects(
        () =>
          verifyRealTerminalEcho({
            nodeBinary: NODE,
            cliPath: FAKE_CLI,
            cliEnv: badEnv,
            testRepo: badDir,
            echoToken: TOKEN
          }),
        /invalid JSON/
      )
      await assert.rejects(
        () =>
          verifyRealTerminalEcho({
            nodeBinary: NODE,
            cliPath: FAKE_CLI,
            cliEnv: failEnv,
            testRepo: failDir,
            echoToken: TOKEN
          }),
        /repo add was not ok: repo denied/
      )
    } finally {
      await rm(badDir, { recursive: true, force: true })
      await rm(failDir, { recursive: true, force: true })
    }
  })

  it('times out and reaps the owned CLI child', async () => {
    const { dir, logPath, env } = await setup('hang')
    try {
      await assert.rejects(
        () =>
          verifyRealTerminalEcho({
            nodeBinary: NODE,
            cliPath: FAKE_CLI,
            cliEnv: env,
            testRepo: dir,
            echoToken: TOKEN,
            callTimeoutMs: 300
          }),
        /timed out/i
      )
      const pidLine = (await readLog(logPath)).split('\n')[0] || ''
      const pid = Number(/^pid:(\d+)/.exec(pidLine)?.[1])
      assert.ok(Number.isInteger(pid) && pid > 1, 'fixture pid was not recorded')
      assert.equal(await waitGone(pid), true, 'timed-out CLI child survived')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
