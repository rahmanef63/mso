import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installReceiptPath } from './managed-paths.mjs'
import { writePrivateFile } from './private-store.mjs'
import { readInstalledOrcaRelease } from './managed-receipt.mjs'
import { getReleaseContentId } from './release-identity.mjs'

const WRAPPER = fileURLToPath(new URL('../managed-app-orca', import.meta.url))
const SCRATCH = '/home/antinrml/.hermes/cache/scratch/opencode'

function adapter(args, env = {}) {
  return spawnSync(WRAPPER, args, {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 30_000
  })
}

async function makeDirs() {
  const base = await mkdtemp(`${SCRATCH}/orca-adapter-`)
  const root = join(base, 'orca')
  const home = join(base, 'home')
  await mkdir(home, { recursive: true, mode: 0o700 })
  await chmod(WRAPPER, 0o755)
  return { base, root, home, env: { ORCA_HOME: root, HOME: home }, cleanup: () => rm(base, { recursive: true, force: true }) }
}

describe('managed-app-orca adapter grammar', () => {
  it('reports not installed rather than a pinned version from wrapper presence alone', async () => {
    const d = await makeDirs()
    try {
      const result = adapter(['--version'], d.env)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /not installed/)
      assert.equal(result.stdout.trim(), '')
    } finally {
      await d.cleanup()
    }
  })

  it('renders an install dry run without pairing material or a browser-dependent surprise', async () => {
    const d = await makeDirs()
    try {
      const result = adapter(['install', '--dry-run'], {
        ...d.env,
        MSO_INSTALL_GATEWAY_BIND: 'loopback',
        MSO_INSTALL_APP_ORIGIN: 'https://orca.mso.example.com'
      })
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /dry run/)
      assert.match(result.stdout, /mso-orca\.service/)
      assert.equal(/pairing|token|ticket|secret/i.test(result.stdout), false)
    } finally {
      await d.cleanup()
    }
  })

  it('refuses non-loopback binds and a missing split origin explicitly', async () => {
    const d = await makeDirs()
    try {
      const lan = adapter(['install'], { ...d.env, MSO_INSTALL_GATEWAY_BIND: 'lan', MSO_INSTALL_APP_ORIGIN: 'https://orca.mso.example.com' })
      assert.equal(lan.status, 2)
      assert.match(lan.stderr, /loopback only/)

      const noOrigin = adapter(['install'], { ...d.env, MSO_INSTALL_APP_ORIGIN: '' })
      assert.equal(noOrigin.status, 2)
      assert.match(noOrigin.stderr, /MSO_INSTALL_APP_ORIGIN/)

      const unknown = adapter(['install', '--force'], { ...d.env, MSO_INSTALL_APP_ORIGIN: 'https://orca.mso.example.com' })
      assert.equal(unknown.status, 2)
      assert.match(unknown.stderr, /unsupported install option/)
    } finally {
      await d.cleanup()
    }
  })

  it('fails update and uninstall closed, but keeps uninstall --help', async () => {
    const d = await makeDirs()
    try {
      const update = adapter(['update', '--yes'], d.env)
      assert.equal(update.status, 1)
      assert.match(update.stderr, /not implemented/)

      const uninstall = adapter(['uninstall', '--yes'], d.env)
      assert.equal(uninstall.status, 1)
      assert.match(uninstall.stderr, /not implemented/)

      const help = adapter(['uninstall', '--help'], d.env)
      assert.equal(help.status, 0)
      assert.match(help.stdout, /uninstall/)

      const usage = adapter([], d.env)
      assert.equal(usage.status, 2)
      assert.match(usage.stderr, /usage: managed-app-orca/)
    } finally {
      await d.cleanup()
    }
  })
})

describe('installed release receipt gate', () => {
  const identity = { release: { contentId: getReleaseContentId() } }

  it('requires a private receipt and a still-verifying release root', async () => {
    const d = await makeDirs()
    try {
      assert.equal((await readInstalledOrcaRelease({ managedRoot: d.root })).reason, 'not_installed')
      const releaseRoot = join(d.root, 'releases', 'r')
      await writePrivateFile(installReceiptPath(d.root), {
        schemaVersion: 1,
        applicationId: 'orca',
        version: '1.4.230',
        releaseRoot,
        releaseContentId: getReleaseContentId(),
        runtimeId: 'rt'
      }, { root: d.root })

      const good = await readInstalledOrcaRelease({
        managedRoot: d.root,
        verify: async () => ({ version: '1.4.230', releaseRoot, receipt: identity })
      })
      assert.equal(good.installed, true)
      assert.equal(good.version, '1.4.230')

      const tampered = await readInstalledOrcaRelease({
        managedRoot: d.root,
        verify: async () => { throw new Error('rehash failed') }
      })
      assert.equal(tampered.reason, 'installed_release_failed_verification')

      await writePrivateFile(installReceiptPath(d.root), {
        schemaVersion: 1, applicationId: 'orca', version: '1.4.230',
        releaseRoot: '/etc', releaseContentId: getReleaseContentId()
      }, { root: d.root })
      assert.equal((await readInstalledOrcaRelease({ managedRoot: d.root })).reason, 'install_receipt_outside_root')
    } finally {
      await d.cleanup()
    }
  })
})
