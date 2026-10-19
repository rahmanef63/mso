import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getReleaseContentId, getReleaseIdentity } from './release-identity.mjs'
import {
  assertPortFree,
  installManagedOrca,
  toWssEndpoint
} from './managed-install.mjs'
import { orcaServiceUnitPath, UNIT_IDENTITY_MARKER } from './managed-paths.mjs'

const RELEASE_ID = getReleaseContentId()
const NODE_REL = getReleaseIdentity().node.executablePath
async function makeDirs() {
  // Short root: the runtime's Unix socket path is capped at 108 bytes on Linux.
  const base = await mkdtemp(join(tmpdir(), 'oi-'))
  const root = join(base, 'root')
  const home = join(base, 'home')
  await mkdir(home, { recursive: true, mode: 0o700 })
  return { base, root, home, cleanup: () => rm(base, { recursive: true, force: true }) }
}

function fakeRelease(root) {
  const releaseRoot = join(root, 'releases', `1.4.230+${RELEASE_ID}`)
  return {
    releaseRoot,
    slotDir: join(releaseRoot, 'slot'),
    nodeBinary: join(releaseRoot, NODE_REL),
    webDir: join(releaseRoot, 'web'),
    receiptPath: join(releaseRoot, 'receipt.json'),
    version: '1.4.230',
    receipt: { release: { contentId: RELEASE_ID } }
  }
}

const status = {
  available: true,
  runtimeId: 'runtime-fixture',
  boundEndpoint: 'ws://127.0.0.1:6769',
  advertisedEndpoint: 'wss://orca.mso.example.com',
  readyAt: '2026-10-19T10:00:00.000Z'
}
const web = { available: true, url: 'http://127.0.0.1:6769/web-index.html', status: 200 }

describe('Orca split-origin endpoint derivation', () => {
  it('maps the configured app origin to WSS and refuses same-origin/loopback fallbacks', () => {
    assert.equal(toWssEndpoint('https://orca.mso.example.com'), 'wss://orca.mso.example.com')
    assert.throws(() => toWssEndpoint(''), /MSO_INSTALL_APP_ORIGIN/)
    assert.throws(() => toWssEndpoint('https://127.0.0.1:6769'), /loopback/i)
    assert.throws(() => toWssEndpoint('https://orca.example.com/?token=x'), /credentials|query/i)
    assert.throws(() => toWssEndpoint('wss://orca.example.com'), /http/i)
  })
})

describe('managed Orca install adapter', () => {
  it('renders a complete dry-run without downloading, writing, or starting anything', async () => {
    const d = await makeDirs()
    try {
      let prepared = 0
      const result = await installManagedOrca({
        managedRoot: d.root,
        home: d.home,
        advertisedEndpoint: 'wss://orca.mso.example.com',
        dryRun: true,
        prepare: async () => { prepared += 1 }
      })
      assert.equal(result.dryRun, true)
      assert.equal(prepared, 0)
      assert.match(result.unit, new RegExp(`^${UNIT_IDENTITY_MARKER}$`, 'm'))
      assert.match(result.unit, /"--port" "6769"/)
      assert.equal(result.unitPath, orcaServiceUnitPath({ home: d.home }))
      await assert.rejects(() => lstat(d.root), { code: 'ENOENT' })
      await assert.rejects(() => lstat(result.unitPath), { code: 'ENOENT' })
      assert.equal(JSON.stringify(result).includes('pairing'), false)
    } finally {
      await d.cleanup()
    }
  })

  it('writes private config, a fixed-argv unit, and only then a receipt after identity+web readiness', async () => {
    const d = await makeDirs()
    try {
      const calls = []
      const hostNode = join(d.base, 'host-node')
      const result = await installManagedOrca({
        managedRoot: d.root,
        home: d.home,
        advertisedEndpoint: 'wss://orca.mso.example.com',
        hostNode,
        prepare: async (input) => {
          assert.equal(input.installRoot, d.root)
          assert.equal(input.allowDownload, true)
          return fakeRelease(d.root)
        },
        userBus: async () => ({ XDG_RUNTIME_DIR: '/run/user/1000' }),
        portProbe: async ({ port }) => calls.push(['port', port]),
        systemctl: async ({ args }) => calls.push(['systemctl', ...args]),
        readStatus: async () => status,
        probeWeb: async () => web,
        wait: async () => {}
      })
      assert.equal(result.dryRun, false)
      assert.deepEqual(calls, [
        ['port', 6769],
        ['systemctl', 'daemon-reload'],
        ['systemctl', 'enable', '--now', 'mso-orca.service']
      ])

      const configPath = join(d.root, 'managed-service.json')
      const receiptPath = join(d.root, 'managed-install.json')
      for (const file of [configPath, receiptPath]) {
        assert.equal((await lstat(file)).mode & 0o777, 0o600)
        assert.equal((await lstat(file)).uid, process.getuid())
      }
      assert.equal((await lstat(result.unitPath)).mode & 0o777, 0o644)
      const config = JSON.parse(await readFile(configPath, 'utf8'))
      const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
      assert.equal(config.release.contentId, getReleaseContentId())
      assert.equal(config.hostNode, hostNode)
      assert.equal(config.cliScript, fileURLToPath(new URL('./cli.mjs', import.meta.url)))
      assert.notEqual(config.hostNode, config.release.nodeBinary)
      assert.equal(config.advertisedEndpoint, 'wss://orca.mso.example.com')
      assert.equal(config.boundEndpoint, 'ws://127.0.0.1:6769')
      assert.equal(receipt.runtimeId, 'runtime-fixture')
      assert.equal(receipt.readyAt, status.readyAt)
      const all = JSON.stringify({ config, receipt })
      for (const forbidden of ['pairing', 'token', 'ticket', 'secret']) {
        assert.equal(all.toLowerCase().includes(forbidden), false)
      }
    } finally {
      await d.cleanup()
    }
  })

  it('refuses a foreign unit before preparing or writing anything', async () => {
    const d = await makeDirs()
    try {
      const unitPath = orcaServiceUnitPath({ home: d.home })
      await mkdir(join(unitPath, '..'), { recursive: true })
      await writeFile(unitPath, '[Service]\nExecStart=/usr/bin/orca --port 6768\n')
      let prepared = 0
      await assert.rejects(
        () => installManagedOrca({
          managedRoot: d.root,
          home: d.home,
          advertisedEndpoint: 'wss://orca.mso.example.com',
          prepare: async () => { prepared += 1 }
        }),
        /foreign unit/
      )
      assert.equal(prepared, 0)
      assert.equal(await readFile(unitPath, 'utf8'), '[Service]\nExecStart=/usr/bin/orca --port 6768\n')
    } finally {
      await d.cleanup()
    }
  })

  it('fails clearly before any mutation when the user bus or port is unavailable', async () => {
    const d = await makeDirs()
    try {
      let prepared = 0
      await assert.rejects(
        () => installManagedOrca({
          managedRoot: d.root,
          home: d.home,
          advertisedEndpoint: 'wss://orca.mso.example.com',
          prepare: async () => { prepared += 1 },
          userBus: async () => null
        }),
        /systemd user bus/
      )
      assert.equal(prepared, 0)

      await assert.rejects(
        () => installManagedOrca({
          managedRoot: d.root,
          home: d.home,
          advertisedEndpoint: 'wss://orca.mso.example.com',
          prepare: async () => { prepared += 1 },
          userBus: async () => ({ XDG_RUNTIME_DIR: '/run/user/1000' }),
          portProbe: async () => { throw new Error('port 127.0.0.1:6769 is already in use') }
        }),
        /already in use/
      )
      assert.equal(prepared, 0)
      await assert.rejects(() => lstat(join(d.root, 'managed-service.json')), { code: 'ENOENT' })
    } finally {
      await d.cleanup()
    }
  })

  it('rejects a prepared release whose files escape the immutable release root', async () => {
    const d = await makeDirs()
    try {
      await assert.rejects(
        () => installManagedOrca({
          managedRoot: d.root,
          home: d.home,
          advertisedEndpoint: 'wss://orca.mso.example.com',
          prepare: async () => ({ ...fakeRelease(d.root), nodeBinary: '/usr/bin/node' }),
          userBus: async () => ({ XDG_RUNTIME_DIR: '/run/user/1000' }),
          portProbe: async () => {}
        }),
        /outside the immutable release root/
      )
      await assert.rejects(() => lstat(join(d.root, 'managed-service.json')), { code: 'ENOENT' })
    } finally {
      await d.cleanup()
    }
  })

  it('detects a genuinely occupied fixed port without ever touching 6768', async () => {
    const { createServer } = await import('node:net')
    const server = createServer()
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address()
    try {
      await assert.rejects(() => assertPortFree({ port }), /already in use/)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })
})
