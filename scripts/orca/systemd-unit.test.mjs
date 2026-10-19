import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, symlink, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  inspectExistingUnit,
  isManagedOrcaUnit,
  renderOrcaServiceUnit,
  systemdQuote
} from './systemd-unit.mjs'

const BASE = {
  hostNode: '/usr/bin/node',
  cliScript: '/opt/mso/scripts/orca/cli.mjs',
  managedRoot: '/home/operator/.local/share/mso/orca',
  port: 6769,
  advertisedEndpoint: 'wss://orca.mso.example.com'
}

describe('Orca user unit rendering', () => {
  it('renders one fixed run argv on the canonical CLI path', () => {
    const unit = renderOrcaServiceUnit(BASE)
    assert.match(unit, /^\# mso-managed-app: orca$/m)
    assert.match(unit, /ExecStart="\/usr\/bin\/node" "\/opt\/mso\/scripts\/orca\/cli\.mjs" "run"/)
    assert.match(unit, /"--managed-root" "\/home\/operator\/\.local\/share\/mso\/orca"/)
    assert.match(unit, /"--port" "6769"/)
    assert.match(unit, /"--advertised-endpoint" "wss:\/\/orca\.mso\.example\.com"/)
    assert.match(unit, /^KillMode=process$/m)
    assert.match(unit, /^Restart=on-failure$/m)
    assert.match(unit, /^StartLimitBurst=3$/m)
    assert.match(unit, /^TimeoutStartSec=90$/m)
    assert.equal(isManagedOrcaUnit(unit), true)
    assert.doesNotMatch(unit, /pairing|token|ticket|secret/i)
  })

  it('escapes spaces, quotes, backslashes, percent specifiers and dollars', () => {
    const unit = renderOrcaServiceUnit({
      ...BASE,
      hostNode: '/opt/Node 24/bin/node',
      managedRoot: '/srv/mso/orca %h "quoted" \\ $HOME'
    })
    assert.match(unit, /"\/opt\/Node 24\/bin\/node"/)
    assert.match(unit, /orca %%h \\"quoted\\" \\\\ \$\$HOME/)
    // The specifier/env syntaxes the unit must never expand are escaped.
    assert.ok(unit.includes('%%h'))
    assert.ok(unit.includes('$$HOME'))
  })

  it('quotes a single argument as one systemd token', () => {
    assert.equal(systemdQuote('plain'), '"plain"')
    assert.equal(systemdQuote('a b'), '"a b"')
    assert.equal(systemdQuote('a"b'), '"a\\"b"')
    assert.equal(systemdQuote('100%'), '"100%%"')
    assert.throws(() => systemdQuote('a\nb'), /control/)
  })

  it('refuses non-absolute, dynamic, loopback and malformed configuration', () => {
    assert.throws(() => renderOrcaServiceUnit({ ...BASE, hostNode: 'node' }), /absolute/)
    assert.throws(() => renderOrcaServiceUnit({ ...BASE, managedRoot: 'relative' }), /absolute/)
    assert.throws(() => renderOrcaServiceUnit({ ...BASE, port: 0 }), /fixed port/)
    assert.throws(() => renderOrcaServiceUnit({ ...BASE, port: 70000 }), /fixed port/)
    assert.throws(() => renderOrcaServiceUnit({ ...BASE, advertisedEndpoint: 'ws://orca.example' }), /wss/i)
    assert.throws(() => renderOrcaServiceUnit({ ...BASE, advertisedEndpoint: 'wss://127.0.0.1:6769' }), /loopback/i)
    assert.throws(() => renderOrcaServiceUnit({ ...BASE, cliScript: '/x/y\nExecStart=/bin/evil' }), /control/)
  })

  it('detects a foreign unit and refuses to overwrite it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ou-'))
    try {
      const foreign = join(dir, 'mso-orca.service')
      await writeFile(foreign, '[Service]\nExecStart=/usr/bin/orca --port 6768\n')
      await assert.rejects(() => inspectExistingUnit({ unitPath: foreign }), /foreign unit/)
      await writeFile(foreign, renderOrcaServiceUnit(BASE))
      assert.equal((await inspectExistingUnit({ unitPath: foreign })).state, 'managed')
      assert.equal((await inspectExistingUnit({ unitPath: join(dir, 'absent.service') })).state, 'absent')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses a symlinked unit path before reading it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ou-'))
    try {
      const real = join(dir, 'real.service')
      await writeFile(real, renderOrcaServiceUnit(BASE))
      const link = join(dir, 'mso-orca.service')
      await symlink(real, link)
      await assert.rejects(() => inspectExistingUnit({ unitPath: link }), /symlink/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
