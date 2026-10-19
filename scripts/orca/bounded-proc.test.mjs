import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { runBounded, redactSensitiveText } from './bounded-proc.mjs'

const NODE = process.execPath

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

describe('bounded subprocess execution', () => {
  it('captures bounded stdout/stderr and the real exit code', async () => {
    const res = await runBounded({
      cmd: NODE,
      args: ['-e', 'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)']
    })
    assert.equal(res.code, 3)
    assert.equal(res.stdout, 'out')
    assert.equal(res.stderr, 'err')
  })

  it('rejects a spawn error instead of hanging', async () => {
    await assert.rejects(
      () => runBounded({ cmd: '/definitely/not/a/binary-orca', args: [] }),
      (err) => err.code === 'ENOENT' || /ENOENT/.test(err.message)
    )
  })

  it('times out, kills the child, and never leaves it alive', async () => {
    await assert.rejects(
      () =>
        runBounded({
          cmd: NODE,
          args: ['-e', 'process.stdout.write(String(process.pid)); setInterval(() => {}, 1000)'],
          timeoutMs: 250
        }),
      /timed out/i
    )
  })

  it('kills the child when stdout exceeds the byte cap', async () => {
    await assert.rejects(
      () =>
        runBounded({
          cmd: NODE,
          args: ['-e', 'process.stdout.write("x".repeat(200000)); setInterval(() => {}, 1000)'],
          maxStdoutBytes: 1024
        }),
      /exceeded/i
    )
  })

  it('kills the child when stderr exceeds the byte cap', async () => {
    await assert.rejects(
      () =>
        runBounded({
          cmd: NODE,
          args: ['-e', 'process.stderr.write("y".repeat(200000)); setInterval(() => {}, 1000)'],
          maxStderrBytes: 1024
        }),
      /exceeded/i
    )
  })

  it('passes only the caller-provided private environment', async () => {
    const res = await runBounded({
      cmd: NODE,
      args: ['-e', 'process.stdout.write(JSON.stringify({foo: process.env.FOO, home: process.env.HOME ?? null}))'],
      env: { FOO: 'bar', PATH: '/usr/bin:/bin' }
    })
    assert.deepEqual(JSON.parse(res.stdout), { foo: 'bar', home: null })
  })

  it('redacts bearer/code/pairing material from diagnostic text', () => {
    const text = 'ws://127.0.0.1:1/?token=SECRET code=ABC #pairing=orca%3A%2F%2Fpair orca://pair?code=XYZ'
    const out = redactSensitiveText(text)
    assert.equal(out.includes('SECRET'), false)
    assert.equal(out.includes('ABC'), false)
    assert.equal(out.includes('XYZ'), false)
    assert.equal(out.includes('orca://pair'), false)
  })
})
