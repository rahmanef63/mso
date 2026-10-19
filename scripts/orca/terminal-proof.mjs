/**
 * Helper to run a real PTY session echo roundtrip via Orca CLI RPC.
 */

import { lstat, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

export async function runCmd(cmd, args) {
  const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  await new Promise((resolve, reject) => {
    proc.on('error', reject)
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`))))
  })
}

export async function runJsonRpc(nodeBinary, args, env) {
  const proc = spawn(nodeBinary, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
  const stdoutChunks = []
  proc.stdout.on('data', (d) => stdoutChunks.push(d))
  await new Promise((resolve) => proc.on('close', resolve))
  const out = Buffer.concat(stdoutChunks).toString('utf8').trim()
  return JSON.parse(out)
}

export async function initScratchGitRepo(repoDir) {
  try {
    const s = await lstat(join(repoDir, '.git'))
    if (s.isDirectory()) return repoDir
  } catch {}
  await mkdir(repoDir, { recursive: true, mode: 0o700 })
  await writeFile(join(repoDir, 'README.md'), '# Scratch Repo\n')
  await runCmd('git', ['init', '-b', 'main', repoDir])
  await runCmd('git', ['-C', repoDir, 'config', 'user.name', 'Orca Tester'])
  await runCmd('git', ['-C', repoDir, 'config', 'user.email', 'tester@example.com'])
  await runCmd('git', ['-C', repoDir, 'add', '.'])
  await runCmd('git', ['-C', repoDir, 'commit', '-m', 'Initial commit'])
  return repoDir
}

export async function verifyRealTerminalEcho({ nodeBinary, cliPath, cliEnv, testRepo, echoToken }) {
  const repoRes = await runJsonRpc(nodeBinary, [cliPath, 'repo', 'add', '--path', testRepo, '--json'], cliEnv)
  if (!repoRes.ok) throw new Error(`repo add failed: ${JSON.stringify(repoRes)}`)

  const termCreateRes = await runJsonRpc(nodeBinary, [
    cliPath, 'terminal', 'create',
    '--worktree', `path:${testRepo}`,
    '--command', `echo ${echoToken}`,
    '--json'
  ], cliEnv)

  if (!termCreateRes.ok) throw new Error(`terminal create failed: ${JSON.stringify(termCreateRes)}`)
  const termHandle = termCreateRes.result?.terminal?.handle || termCreateRes.result?.handle
  if (!termHandle) throw new Error(`terminal create returned no handle: ${JSON.stringify(termCreateRes)}`)

  let tokenObserved = false
  for (let i = 0; i < 10; i += 1) {
    await new Promise((r) => setTimeout(r, 500))
    const readRes = await runJsonRpc(nodeBinary, [
      cliPath, 'terminal', 'read',
      '--terminal', termHandle,
      '--json'
    ], cliEnv)
    const tail = readRes.result?.terminal?.tail || []
    if (tail.some((l) => l.includes(echoToken))) {
      tokenObserved = true
      break
    }
  }

  if (!tokenObserved) throw new Error(`Failed to observe echo token ${echoToken}`)
  await runJsonRpc(nodeBinary, [cliPath, 'terminal', 'close', '--terminal', termHandle, '--json'], cliEnv)
  return { ok: true, termHandle }
}
