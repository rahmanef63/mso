import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { runBoundedProcess } from './bounded-process.mjs'

describe('bounded child process', () => {
  it('returns exit code and bounded stderr for a normal command', async () => {
    const res = await runBoundedProcess({
      command: process.execPath,
      args: ['-e', 'process.stderr.write("warning\\n")'],
      maxStderrBytes: 1024
    })
    assert.equal(res.code, 0)
    assert.equal(res.stderr, 'warning\n')
    assert.equal(res.stderrTruncated, false)
  })

  it('caps retained stderr while still draining the pipe', async () => {
    const res = await runBoundedProcess({
      command: process.execPath,
      args: ['-e', 'process.stderr.write("x".repeat(4096))'],
      maxStderrBytes: 64
    })
    assert.equal(res.code, 0)
    assert.equal(res.stderrTruncated, true)
    assert.ok(res.stderr.length <= 64)
  })

  it('streams stdout through the sink', async () => {
    const chunks = []
    const res = await runBoundedProcess({
      command: process.execPath,
      args: ['-e', 'process.stdout.write("abc");process.stdout.write("def")'],
      onStdout: (chunk) => chunks.push(Buffer.from(chunk))
    })
    assert.equal(res.code, 0)
    assert.equal(Buffer.concat(chunks).toString('utf8'), 'abcdef')
  })

  it('kills a hung child on timeout and rejects', async () => {
    await assert.rejects(
      runBoundedProcess({
        command: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1000)'],
        timeoutMs: 60,
        graceMs: 50
      }),
      { name: 'TimeoutError' }
    )
  })

  it('kills a child when the stdout cap is exceeded', async () => {
    await assert.rejects(
      runBoundedProcess({
        command: process.execPath,
        args: ['-e', 'process.stdout.write("x".repeat(4096))'],
        maxStdoutBytes: 32
      }),
      /stdout exceeded/i
    )
  })

  it('supports a pre-aborted signal without spawning', async () => {
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      runBoundedProcess({ command: process.execPath, args: ['-e', ''], signal: controller.signal }),
      { name: 'AbortError' }
    )
  })
})
