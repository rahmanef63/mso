import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectExistingUnit, isManagedOrcaUnit, renderOrcaServiceUnit } from './systemd-unit.mjs'
import { installManagedOrca } from './managed-install.mjs'
import { orcaServiceUnitPath } from './managed-paths.mjs'

const TRUSTED_CONFIG = {
  hostNode: '/usr/bin/node',
  cliScript: '/opt/mso/scripts/orca/cli.mjs',
  managedRoot: '/home/operator/.local/share/mso/orca',
  port: 6769,
  advertisedEndpoint: 'wss://orca.mso.example.com'
}

const TRUSTED_UNIT = renderOrcaServiceUnit(TRUSTED_CONFIG)

const FOREIGN_UNIT = `# mso-managed-app: orca
# --managed-root /tmp/evil
[Unit]
Description=Injected foreign Orca
[Service]
ExecStart=/bin/foreign /opt/mso/scripts/orca/cli.mjs run
ExecStartPre=/bin/evil-hook
`

describe('Orca installer replacement authorization regression', () => {
  it('rejects unit with marker, foreign ExecStart, ExecStartPre, and --managed-root comment while preserving byte identity', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ou-replace-'))
    try {
      const unitPath = join(dir, 'mso-orca.service')
      await writeFile(unitPath, FOREIGN_UNIT, { mode: 0o644 })

      // Predicate check must reject foreign ExecStart and ExecStartPre
      assert.equal(isManagedOrcaUnit(FOREIGN_UNIT, TRUSTED_UNIT), false)

      // Direct inspection with caller's expected unit must reject foreign unit
      await assert.rejects(
        () => inspectExistingUnit({
          unitPath,
          expectedUnit: TRUSTED_UNIT
        }),
        /foreign unit/i
      )

      // File byte identity must be preserved exactly
      const textAfter = await readFile(unitPath, 'utf8')
      assert.equal(textAfter, FOREIGN_UNIT)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('accepts legitimate owned unit matching trusted expected configuration', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ou-replace-'))
    try {
      const unitPath = join(dir, 'mso-orca.service')
      await writeFile(unitPath, TRUSTED_UNIT, { mode: 0o644 })

      const inspected = await inspectExistingUnit({
        unitPath,
        expectedUnit: TRUSTED_UNIT
      })
      assert.equal(inspected.state, 'managed')
      assert.equal(inspected.text, TRUSTED_UNIT)

      // Also accepts with expectedConfig
      const inspectedConfig = await inspectExistingUnit({
        unitPath,
        expectedConfig: TRUSTED_CONFIG
      })
      assert.equal(inspectedConfig.state, 'managed')
      assert.equal(inspectedConfig.text, TRUSTED_UNIT)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects legitimate owned unit if desired expected configuration does not match', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ou-replace-'))
    try {
      const unitPath = join(dir, 'mso-orca.service')
      await writeFile(unitPath, TRUSTED_UNIT, { mode: 0o644 })

      const otherConfig = { ...TRUSTED_CONFIG, port: 6770 }
      const otherUnit = renderOrcaServiceUnit(otherConfig)

      await assert.rejects(
        () => inspectExistingUnit({
          unitPath,
          expectedUnit: otherUnit
        }),
        /foreign unit/i
      )

      // Verify file byte identity preserved
      assert.equal(await readFile(unitPath, 'utf8'), TRUSTED_UNIT)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('installer rejects existing unit with foreign ExecStart or hooks before prepare/download or systemctl', async () => {
    const base = await mkdtemp(join(tmpdir(), 'ou-inst-'))
    try {
      const home = join(base, 'home')
      const root = join(base, 'root')
      const unitPath = orcaServiceUnitPath({ home })
      await mkdir(join(unitPath, '..'), { recursive: true })
      await writeFile(unitPath, FOREIGN_UNIT, { mode: 0o644 })

      let prepared = 0
      let systemctlCalled = 0
      await assert.rejects(
        () => installManagedOrca({
          managedRoot: root,
          home,
          advertisedEndpoint: 'wss://orca.mso.example.com',
          prepare: async () => { prepared += 1 },
          systemctl: async () => { systemctlCalled += 1 }
        }),
        /foreign unit/i
      )

      assert.equal(prepared, 0)
      assert.equal(systemctlCalled, 0)
      assert.equal(await readFile(unitPath, 'utf8'), FOREIGN_UNIT)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})
