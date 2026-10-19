import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseArgs } from './cli.mjs'

describe('cli argument parsing and validation', () => {
  it('parses cli args correctly with defaults and overrides', () => {
    const res = parseArgs([
      'node',
      'cli.mjs',
      'smoke',
      '--scratch',
      '/tmp/scratch',
      '--port',
      '6769',
      '--bind',
      '127.0.0.1',
      '--deb',
      '/tmp/orca.deb',
      '--allow-download'
    ])

    assert.equal(res.command, 'smoke')
    assert.equal(res.scratch, '/tmp/scratch')
    assert.equal(res.port, 6769)
    assert.equal(res.bind, '127.0.0.1')
    assert.equal(res.deb, '/tmp/orca.deb')
    assert.equal(res.allowDownload, true)
  })

  it('defaults to help command when no command is provided', () => {
    const res = parseArgs(['node', 'cli.mjs'])
    assert.equal(res.command, 'help')
  })
})
