import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { createBoundedLineReader, createRollingTextSink, drain } from './bounded-stream.mjs'

async function flush() {
  await new Promise((r) => setImmediate(r))
}

describe('bounded stream consumption', () => {
  it('delivers complete lines and caps an oversized line', async () => {
    const stream = new PassThrough()
    const lines = []
    const errors = []
    createBoundedLineReader(stream, {
      maxLineBytes: 16,
      onLine: (line) => lines.push(line),
      onOverflow: (err) => errors.push(err)
    })
    stream.write('ok\r\npartial')
    stream.write(' line\n')
    await flush()
    assert.deepEqual(lines, ['ok', 'partial line'])

    stream.write('x'.repeat(64))
    await flush()
    assert.equal(errors.length, 1)
    assert.match(errors[0].message, /line exceeded/i)
  })

  it('caps total bytes before readiness and stops parsing after detach', async () => {
    const stream = new PassThrough()
    const errors = []
    const lines = []
    const reader = createBoundedLineReader(stream, {
      maxTotalBytes: 16,
      onLine: (line) => lines.push(line),
      onOverflow: (err) => errors.push(err)
    })
    stream.write('y'.repeat(32))
    await flush()
    assert.match(errors[0].message, /stdout exceeded/i)

    const second = new PassThrough()
    const seen = []
    const reader2 = createBoundedLineReader(second, { onLine: (line) => seen.push(line) })
    reader2.detach()
    second.write('ignored\n')
    await flush()
    assert.deepEqual(seen, [])
    reader.detach()
  })

  it('keeps only the rolling tail of stderr and drains without retaining', async () => {
    const stream = new PassThrough()
    const sink = createRollingTextSink(stream, { maxBytes: 8 })
    stream.write('123456')
    stream.write('7890')
    await flush()
    assert.equal(sink.text().endsWith('34567890'), true)
    assert.equal(sink.text().length <= 8, true)
    sink.detach()

    const drained = new PassThrough()
    drain(drained)
    drained.write('discarded')
  })
})
