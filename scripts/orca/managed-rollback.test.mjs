import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { getReleaseContentId, getReleaseIdentity } from './release-identity.mjs'
import { installManagedOrca } from './managed-install.mjs'
import { writeUnitAtomic } from './managed-unit-write.mjs'
import { UNIT_IDENTITY_MARKER, orcaServiceUnitPath } from './managed-paths.mjs'

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

const managedText = (root) =>
  `${UNIT_IDENTITY_MARKER}\n[Service]\nExecStart="/usr/bin/node" "/repo/scripts/orca/cli.mjs" "run" --managed-root ${root} --port 6769\n`

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

  it('records an explicit partial marker and refuses a rerun when rollback cannot finish', async () => {
    const d = await makeDirs()
    try {
      await assert.rejects(
        () =>
          installManagedOrca({
            managedRoot: d.root,
            home: d.home,
            advertisedEndpoint: 'wss://orca.mso.example.com',
            prepare: async () => fakeRelease(d.root),
            userBus: async () => ({ XDG_RUNTIME_DIR: '/run/user/1000' }),
            portProbe: async () => {},
            systemctl: async ({ args }) => {
              if (args[0] === 'disable') throw new Error('stop refused')
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
      const marker = join(d.root, 'partial-install.json')
      assert.equal(await exists(marker), true)
      const parsed = JSON.parse(await readFile(marker, 'utf8'))
      assert.match(parsed.failures.join('\n'), /stop created unit/)

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
})

describe('atomic absent-unit publish', () => {
  it('refuses to clobber a foreign unit that appears at the last instant', async () => {
    const d = await makeDirs()
    try {
      const unitPath = orcaServiceUnitPath({ home: d.home })
      await mkdir(dirname(unitPath), { recursive: true })
      await assert.rejects(
        () =>
          writeUnitAtomic(unitPath, managedText(d.root), {
            inspect: async () => {
              await writeFile(unitPath, FOREIGN)
              return { state: 'absent', text: null }
            }
          }),
        /appeared during install/
      )
      assert.equal(await readFile(unitPath, 'utf8'), FOREIGN)
    } finally {
      await d.cleanup()
    }
  })

  it('publishes an absent unit at 0644 and replaces only its own managed unit', async () => {
    const d = await makeDirs()
    try {
      const unitPath = orcaServiceUnitPath({ home: d.home })
      await writeUnitAtomic(unitPath, managedText(d.root))
      assert.equal((await lstat(unitPath)).mode & 0o777, 0o644)
      assert.equal(await readFile(unitPath, 'utf8'), managedText(d.root))

      const updated = managedText(d.root).replace('--port 6769', '--port 6770')
      await writeUnitAtomic(unitPath, updated)
      assert.equal(await readFile(unitPath, 'utf8'), updated)
    } finally {
      await d.cleanup()
    }
  })
})
