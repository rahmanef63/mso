/**
 * Real PTY echo proof through the Orca CLI RPC.
 * Every call is bounded, exit-checked, JSON-checked, and the exact created
 * terminal is closed on every path. A token only passes when it appears as its
 * own output line, not as the echoed input command.
 */

import { lstat, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { redactSensitiveText, runBounded } from './bounded-proc.mjs'

const ECHO_TOKEN_RE = /^[A-Za-z0-9._:-]{1,128}$/
const HANDLE_RE = /^[A-Za-z0-9._:-]{1,128}$/

function safeError(parsed) {
  const raw = parsed?.error?.message ?? parsed?.error ?? parsed?.message ?? 'unknown error'
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw)
  return redactSensitiveText(text).slice(0, 500)
}

export async function initScratchGitRepo(repoDir, { timeoutMs = 30000 } = {}) {
  try {
    const info = await lstat(join(repoDir, '.git'))
    if (info.isDirectory()) return repoDir
  } catch {}
  await mkdir(repoDir, { recursive: true, mode: 0o700 })
  await writeFile(join(repoDir, 'README.md'), '# Scratch Repo\n', { mode: 0o600 })
  const git = async (args) => {
    const res = await runBounded({
      cmd: 'git',
      args,
      timeoutMs,
      maxStdoutBytes: 256 * 1024,
      maxStderrBytes: 64 * 1024
    })
    if (res.code !== 0) {
      throw new Error(`git ${args[0]} failed (exit ${res.code}): ${redactSensitiveText(res.stderr).slice(-500)}`)
    }
  }
  await git(['init', '-b', 'main', repoDir])
  await git(['-C', repoDir, 'config', 'user.name', 'Orca Tester'])
  await git(['-C', repoDir, 'config', 'user.email', 'tester@example.com'])
  await git(['-C', repoDir, 'add', '.'])
  await git(['-C', repoDir, 'commit', '-m', 'Initial commit'])
  return repoDir
}

export async function verifyRealTerminalEcho({
  nodeBinary,
  cliPath,
  cliEnv,
  testRepo,
  echoToken,
  callTimeoutMs = 20000,
  echoDeadlineMs = 15000,
  pollMs = 250
} = {}) {
  if (typeof nodeBinary !== 'string' || typeof cliPath !== 'string') {
    throw new Error('nodeBinary and cliPath are required')
  }
  if (typeof testRepo !== 'string' || testRepo.length === 0) throw new Error('testRepo is required')
  if (typeof echoToken !== 'string' || !ECHO_TOKEN_RE.test(echoToken)) {
    throw new Error('echoToken must be a short alphanumeric marker')
  }

  const call = async (args, label) => {
    const res = await runBounded({
      cmd: nodeBinary,
      args: [cliPath, ...args],
      env: cliEnv,
      timeoutMs: callTimeoutMs,
      maxStdoutBytes: 1024 * 1024,
      maxStderrBytes: 64 * 1024
    })
    if (res.code !== 0) {
      throw new Error(
        `${label} exited ${res.code}: ${redactSensitiveText(res.stderr).slice(-500)}`
      )
    }
    let parsed
    try {
      parsed = JSON.parse(res.stdout.trim())
    } catch {
      throw new Error(`${label} returned invalid JSON`)
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} returned non-object JSON`)
    }
    if (parsed.ok !== true) throw new Error(`${label} was not ok: ${safeError(parsed)}`)
    return parsed
  }

  let termHandle = null
  let primary = null
  try {
    await call(['repo', 'add', '--path', testRepo, '--json'], 'repo add')

    const created = await call(
      ['terminal', 'create', '--worktree', `path:${testRepo}`, '--command', `echo ${echoToken}`, '--json'],
      'terminal create'
    )
    termHandle = created.result?.terminal?.handle
    if (typeof termHandle !== 'string' || !HANDLE_RE.test(termHandle)) {
      throw new Error('terminal create returned no valid terminal handle')
    }

    const deadline = Date.now() + echoDeadlineMs
    let observed = false
    while (Date.now() < deadline) {
      const read = await call(['terminal', 'read', '--terminal', termHandle, '--json'], 'terminal read')
      const tail = read.result?.terminal?.tail
      if (!Array.isArray(tail)) throw new Error('terminal read returned no tail array')
      if (tail.some((line) => typeof line === 'string' && line.trim() === echoToken)) {
        observed = true
        break
      }
      await new Promise((r) => setTimeout(r, pollMs))
    }
    if (!observed) throw new Error(`echo token was not observed as an output line: ${echoToken}`)
  } catch (err) {
    primary = err
  } finally {
    if (termHandle) {
      try {
        await call(['terminal', 'close', '--terminal', termHandle, '--json'], 'terminal close')
      } catch (err) {
        if (primary) primary.message = `${primary.message}; additionally failed to close ${termHandle}: ${err.message}`
        else primary = err
      }
    }
  }

  if (primary) throw primary
  return { ok: true, termHandle, echoObserved: true }
}
