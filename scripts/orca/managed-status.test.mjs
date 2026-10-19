import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { probeOrcaWebClient, readManagedOrcaStatus } from './managed-status.mjs'
import { writePrivateFile } from './private-store.mjs'

const HOLD = fileURLToPath(new URL('./fixtures/hold-child.mjs', import.meta.url))
const PORT = 6769
const ADVERTISED = 'wss://orca.mso.example.com'

function spawnHolding(args = []) {
  const child = spawn(process.execPath, [HOLD, ...args], { stdio: ['ignore', 'pipe', 'ignore'] })
  return new Promise((resolve) => {
    child.stdout.once('data', () => resolve(child))
  })
}

const waitGone = (pid) => new Promise((resolve) => {
  const started = Date.now()
  const poll = () => {
    try { process.kill(pid, 0) } catch { return resolve(true) }
    if (Date.now() - started > 3000) return resolve(false)
    setTimeout(poll, 25)
  }
  poll()
})

async function fixture() {
  const root = await mkdtemp('/home/antinrml/.hermes/cache/scratch/opencode/orca-status-')
  const nodeLink = join(root, 'node')
  await symlink(process.execPath, nodeLink)
  const serverEntry = join(root, 'releases', 'r1', 'slot', 'orcad-server.js')
  const daemonEntry = join(root, 'releases', 'r1', 'slot', 'daemon-entry.js')
  const server = await spawnHolding([serverEntry])
  const daemon = await spawnHolding([daemonEntry])
  const status = {
    type: 'orca_server_ready',
    schemaVersion: 1,
    runtimeId: 'runtime-abc',
    boundEndpoint: `ws://127.0.0.1:${PORT}`,
    advertisedEndpoint: ADVERTISED,
    pairing: { available: true, scope: 'runtime', url: 'orca://pair?code=PRIVATE_TOKEN' },
    health: {
      buildVersion: '1.4.230',
      pid: server.pid,
      terminalDaemon: {
        state: 'live',
        ownsFreshSessions: true,
        pid: daemon.pid,
        entryPath: daemonEntry,
        selfTest: { ok: true, verdict: 'healthy' }
      }
    }
  }
  const identity = {
    schemaVersion: 1,
    runtimeId: 'runtime-abc',
    version: '1.4.230',
    serverPid: server.pid,
    serverStartTicks: '0',
    nodeBinary: nodeLink,
    serverEntry,
    userData: join(root, 'runtime', 'user-data'),
    boundEndpoint: status.boundEndpoint,
    advertisedEndpoint: ADVERTISED,
    readyAt: '2026-10-19T00:00:00.000Z'
  }
  const { readProcessIdentity } = await import('./proc-identity.mjs')
  identity.serverStartTicks = (await readProcessIdentity(server.pid)).startTicks
  await writePrivateFile(join(root, 'private-status.json'), status, { root })
  await writePrivateFile(join(root, 'runtime-identity.json'), identity, { root })
  return {
    root,
    status,
    identity,
    server,
    daemon,
    cleanup: async () => {
      for (const child of [server, daemon]) {
        try { child.kill('SIGKILL') } catch {}
        await waitGone(child.pid)
      }
      await rm(root, { recursive: true, force: true })
    }
  }
}

describe('verified managed Orca status', () => {
  it('accepts only matching private receipts and live kernel identities, without leaking pairing', async () => {
    const fx = await fixture()
    try {
      const result = await readManagedOrcaStatus({
        managedRoot: fx.root,
        expectedPort: PORT,
        expectedAdvertisedEndpoint: ADVERTISED
      })
      assert.equal(result.available, true)
      assert.equal(result.version, '1.4.230')
      assert.equal(result.runtimeId, 'runtime-abc')
      assert.equal(result.serverPid, fx.server.pid)
      assert.equal(result.daemonPid, fx.daemon.pid)
      assert.equal(JSON.stringify(result).includes('PRIVATE_TOKEN'), false)
      assert.equal(JSON.stringify(result).includes('orca://'), false)
    } finally {
      await fx.cleanup()
    }
  })

  it('reports unavailable for missing evidence, a dead/reused PID, or an origin mismatch', async () => {
    const fx = await fixture()
    try {
      assert.equal((await readManagedOrcaStatus({ managedRoot: join(fx.root, 'absent') })).reason, 'receipts_missing')
      assert.equal((await readManagedOrcaStatus({
        managedRoot: fx.root, expectedPort: PORT, expectedAdvertisedEndpoint: 'wss://other.example.com'
      })).reason, 'advertised_endpoint_mismatch')

      const changed = { ...fx.identity, serverStartTicks: '1' }
      await writePrivateFile(join(fx.root, 'runtime-identity.json'), changed, { root: fx.root })
      assert.equal((await readManagedOrcaStatus({ managedRoot: fx.root, expectedPort: PORT })).reason, 'server_process_reused')

      fx.server.kill('SIGKILL')
      await waitGone(fx.server.pid)
      await writePrivateFile(join(fx.root, 'runtime-identity.json'), fx.identity, { root: fx.root })
      assert.equal((await readManagedOrcaStatus({ managedRoot: fx.root, expectedPort: PORT })).reason, 'server_process_dead')
    } finally {
      await fx.cleanup()
    }
  })

  it('rejects a receipt outside the managed root or a non-private receipt', async () => {
    const fx = await fixture()
    try {
      await writePrivateFile(join(fx.root, 'runtime-identity.json'), { ...fx.identity, serverEntry: '/etc/passwd' }, { root: fx.root })
      assert.equal((await readManagedOrcaStatus({ managedRoot: fx.root, expectedPort: PORT })).reason, 'runtime_identity_serverEntry_outside_root')
    } finally {
      await fx.cleanup()
    }
  })

  it('treats static web reachability as a separate proof', async () => {
    const ok = await probeOrcaWebClient({
      port: PORT,
      fetchImpl: async () => new Response('<html><title>Orca Web</title></html>', { status: 200 })
    })
    assert.equal(ok.available, true)
    const broken = await probeOrcaWebClient({
      port: PORT,
      fetchImpl: async () => new Response('<html>not orca</html>', { status: 200 })
    })
    assert.equal(broken.available, false)
    assert.equal(broken.reason, 'web_client_unhealthy')
  })
})
