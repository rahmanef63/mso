import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseArgs, main } from './cli.mjs'
import { assertConfiguredAdvertisedEndpoint, assertPersistentPort } from './supervision.mjs'

const argv = (...rest) => ['node', 'cli.mjs', ...rest]

describe('strict CLI argument parsing', () => {
  it('parses every supported flag and defaults to help', () => {
    const res = parseArgs(argv(
      'smoke', '--managed-root', '/srv/orca', '--port', '6769', '--bind', '127.0.0.1',
      '--advertised-endpoint', 'wss://orca.example.test', '--deb', '/tmp/orca.deb',
      '--allow-download'
    ))
    assert.equal(res.command, 'smoke')
    assert.equal(res.managedRoot, '/srv/orca')
    assert.equal(res.port, 6769)
    assert.equal(res.bind, '127.0.0.1')
    assert.equal(res.advertisedEndpoint, 'wss://orca.example.test')
    assert.equal(res.deb, '/tmp/orca.deb')
    assert.equal(res.allowDownload, true)
    assert.equal(parseArgs(['node', 'cli.mjs']).command, 'help')
  })

  it('rejects unknown, duplicate, positional, and valueless flags', () => {
    assert.throws(() => parseArgs(argv('smoke', '--managed-root', '/srv', '--nope')), /unknown flag/i)
    assert.throws(() => parseArgs(argv('smoke', '--managed-root', '/srv', '--port', '1', '--port', '2')), /duplicate flag/i)
    assert.throws(() => parseArgs(argv('smoke', '--managed-root', '/srv', 'stray')), /unexpected argument/i)
    assert.throws(() => parseArgs(argv('smoke', '--managed-root')), /missing value/i)
    assert.throws(() => parseArgs(argv('smoke', '--managed-root', '--port', '6769')), /missing value/i)
    assert.throws(() => parseArgs(argv('smoke', '--managed-root', '/srv', '--port', '6769x')), /port must be an integer/i)
    assert.throws(() => parseArgs(argv('launch')), /unknown command/i)
    assert.throws(() => parseArgs(['node', 'cli.mjs', '--managed-root', '/srv']), /missing command/i)
  })

  it('has no unchecked template/web acquisition bypass', () => {
    for (const flag of ['--template', '--web']) {
      assert.throws(
        () => parseArgs(argv('materialize', '--managed-root', '/srv', flag, '/tmp/upstream')),
        /unknown flag/i
      )
    }
  })

  it('requires --managed-root before running a command', async () => {
    await assert.rejects(() => main(argv('materialize')), /requires --managed-root/i)
  })

  it('prints usage without preparing a release', async () => {
    const lines = []
    const result = await main(argv('help'), { log: { log: (line) => lines.push(line) } })
    assert.equal(result.command, 'help')
    assert.match(lines.join('\n'), /Usage: node scripts\/orca\/cli.mjs/)
  })
})

describe('persistent run configuration', () => {
  it('accepts only a non-loopback wss advertised endpoint', () => {
    assert.equal(assertConfiguredAdvertisedEndpoint('wss://orca.example.test'), 'wss://orca.example.test')
    assert.equal(
      assertConfiguredAdvertisedEndpoint('wss://orca.example.test/runtime/'),
      'wss://orca.example.test/runtime'
    )
    assert.throws(() => assertConfiguredAdvertisedEndpoint('ws://orca.example.test'), /wss/i)
    assert.throws(() => assertConfiguredAdvertisedEndpoint('wss://127.0.0.1:6769'), /loopback/i)
    assert.throws(() => assertConfiguredAdvertisedEndpoint('wss://localhost:6769'), /loopback/i)
    assert.throws(() => assertConfiguredAdvertisedEndpoint('wss://orca.example.test/?token=x'), /credentials|query/i)
    assert.throws(() => assertConfiguredAdvertisedEndpoint('not a url'), /valid URL/i)
    assert.throws(() => assertConfiguredAdvertisedEndpoint(''), /requires/i)
  })

  it('rejects dynamic and out-of-range persistent ports', () => {
    assert.equal(assertPersistentPort(6769), 6769)
    assert.throws(() => assertPersistentPort(0), /fixed port/i)
    assert.throws(() => assertPersistentPort(65536), /fixed port/i)
    assert.throws(() => assertPersistentPort('6769x'), /fixed port/i)
  })
})
