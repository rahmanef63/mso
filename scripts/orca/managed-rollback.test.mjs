import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getReleaseContentId, getReleaseIdentity } from './release-identity.mjs'
import { installManagedOrca } from './managed-install.mjs'
import { orcaServiceUnitPath } from './managed-paths.mjs'

const RELEASE_ID = getReleaseContentId()
const NODE_REL = getReleaseIdentity().node.executablePath
const FOREIGN = '[Service]\nExecStart=/usr/bin/orca --port 6768\n'

async function makeDirs() {
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

const exists = async (path) => {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}

describe('bounded first-install rollback', () => {
  it('stops the exact created unit and removes every file it wrote when readiness never arrives', async () => {
    const d = await makeDirs()
    try {
      const calls = []
      const unitPath = orcaServiceUnitPath({ home: d.home })
      await assert.rejects(
        () =>
          installManagedOrca({
            managedRoot: d.root,
            home: d.home,
            advertisedEndpoint: 'wss://orca.mso.example.com',
            prepare: async () => fakeRelease(d.root),
            userBus: async () => ({ XDG_RUNTIME_DIR: '/run/user/1000' }),
            portProbe: async () => {},
            systemctl: async (opts) => {
              calls.push(opts)
              return { code: 0, stdout: '', stderr: '' }
            },
            readStatus: async () => ({ available: false, reason: 'server_process_dead' }),
            probeWeb: async () => ({ available: false, reason: 'web_unreachable' }),
            wait: async () => {},
            timeoutMs: 1,
            pollMs: 1
          }),
        /did not become ready/
      )

      // Only ever the created USER unit, best-effort.
      assert.ok(calls.some((c) => c.args.join(' ') === 'enable --now mso-orca.service'))
      const stop = calls.find((c) => c.args.join(' ') === 'disable --now mso-orca.service')
      assert.equal(stop?.allowFailure, true)

      assert.equal(await exists(unitPath), false)
      assert.equal(await exists(join(d.root, 'managed-service.json')), false)
      assert.equal(await exists(join(d.root, 'managed-install.json')), false)
      // A clean rollback leaves NO partial marker.
      assert.equal(await exists(join(d.root, 'partial-install.json')), false)
    } finally {
      await d.cleanup()
    }
  })

  it('does not fabricate success or start anything when the first config write fails', async () => {
    const d = await makeDirs()
    try {
      const calls = []
      await assert.rejects(
        () =>
          installManagedOrca({
            managedRoot: d.root,
            home: d.home,
            advertisedEndpoint: 'wss://orca.mso.example.com',
            prepare: async () => fakeRelease(d.root),
            userBus: async () => ({ XDG_RUNTIME_DIR: '/run/user/1000' }),
            portProbe: async () => {},
            writePrivate: async () => {
              throw new Error('disk full')
            },
            systemctl: async (opts) => {
              calls.push(opts.args.join(' '))
              return { code: 0, stdout: '', stderr: '' }
            }
          }),
        /disk full/
      )
      assert.deepEqual(calls, [])
      assert.equal(await exists(orcaServiceUnitPath({ home: d.home })), false)
      assert.equal(await exists(join(d.root, 'partial-install.json')), false)
    } finally {
      await d.cleanup()
    }
  })

  it('keeps the owned unit and config and records a partial marker when the stop returns a nonzero code', async () => {
    const d = await makeDirs()
    try {
      const unitPath = orcaServiceUnitPath({ home: d.home })
      await assert.rejects(
        () =>
          installManagedOrca({
            managedRoot: d.root,
            home: d.home,
            advertisedEndpoint: 'wss://orca.mso.example.com',
            prepare: async () => fakeRelease(d.root),
            userBus: async () => ({ XDG_RUNTIME_DIR: '/run/user/1000' }),
            portProbe: async () => {},
            // Production `defaultSystemctl` reports the exit code instead of
            // throwing; a refused stop must be a FAILURE, not a silent success.
            systemctl: async ({ args }) => (args[0] === 'disable' ? { code: 1, stdout: '', stderr: 'stop refused' } : { code: 0, stdout: '', stderr: '' }),
            readStatus: async () => ({ available: false, reason: 'server_process_dead' }),
            probeWeb: async () => ({ available: false, reason: 'web_unreachable' }),
            wait: async () => {},
            timeoutMs: 1,
            pollMs: 1
          }),
        /did not become ready/
      )
      // A confirmed-stop failure must NOT remove the unit or its config.
      assert.equal(await exists(unitPath), true)
      assert.equal(await exists(join(d.root, 'managed-service.json')), true)
      const marker = join(d.root, 'partial-install.json')
      assert.equal(await exists(marker), true)
      const parsed = JSON.parse(await readFile(marker, 'utf8'))
      assert.match(parsed.failures.join('\n'), /stop created unit failed \(exit 1\)/)

      // A rerun refuses instead of adopting the half state.
      await assert.rejects(
        () =>
          installManagedOrca({
            managedRoot: d.root,
            home: d.home,
            advertisedEndpoint: 'wss://orca.mso.example.com',
            prepare: async () => fakeRelease(d.root)
          }),
        /partial state/
      )
    } finally {
      await d.cleanup()
    }
  })

  it('preserves a foreign unit that replaced ours before rollback', async () => {
    const d = await makeDirs()
    try {
      const unitPath = orcaServiceUnitPath({ home: d.home })
      const calls = []
      await assert.rejects(
        () =>
          installManagedOrca({
            managedRoot: d.root,
            home: d.home,
            advertisedEndpoint: 'wss://orca.mso.example.com',
            prepare: async () => fakeRelease(d.root),
            userBus: async () => ({ XDG_RUNTIME_DIR: '/run/user/1000' }),
            portProbe: async () => {},
            systemctl: async (opts) => {
              calls.push(opts.args.join(' '))
              return { code: 0, stdout: '', stderr: '' }
            },
            readStatus: async () => {
              // A foreign unit appears where ours was, then readiness never arrives.
              await writeFile(unitPath, FOREIGN)
              return { available: false, reason: 'server_process_dead' }
            },
            probeWeb: async () => ({ available: false, reason: 'web_unreachable' }),
            wait: async () => {},
            timeoutMs: 1,
            pollMs: 1
          }),
        /did not become ready/
      )
      // The foreign unit is preserved and never disabled/removed.
      assert.equal(await readFile(unitPath, 'utf8'), FOREIGN)
      assert.equal(calls.some((c) => c.startsWith('disable')), false)
      assert.equal(await exists(join(d.root, 'partial-install.json')), true)
    } finally {
      await d.cleanup()
    }
  })
})

