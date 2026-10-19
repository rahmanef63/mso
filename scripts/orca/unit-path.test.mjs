import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectExistingUnit, renderOrcaServiceUnit } from './systemd-unit.mjs'

/**
 * Ancestor guard coverage for `inspectExistingUnit`.
 *
 * `assertNoSymlinkUnitPath` used to return at the FIRST existing path component,
 * so an existing unit — or a missing leaf — reached through a symlinked parent was
 * accepted. These fixtures reproduce that and pin the corrected behaviour: every
 * ancestor from the unit up to the filesystem root is checked.
 */

const OWNED = renderOrcaServiceUnit({
  hostNode: '/usr/bin/node',
  cliScript: '/opt/mso/scripts/orca/cli.mjs',
  managedRoot: '/home/operator/.local/share/mso/orca',
  port: 6769,
  advertisedEndpoint: 'wss://orca.mso.example.com'
})
const FOREIGN = '[Service]\nExecStart=/usr/bin/orca --port 6768\n'

// Canonicalise the base so the temp tree has no incidental symlinked ancestor.
async function makeBase() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'up-')))
  return { base, cleanup: () => rm(base, { recursive: true, force: true }) }
}

async function writeUnit(dir, text) {
  await mkdir(dir, { recursive: true })
  const unitPath = join(dir, 'mso-orca.service')
  await writeFile(unitPath, text, { mode: 0o644 })
  return unitPath
}

describe('Orca unit ancestor guard', () => {
  it('refuses an existing owned unit reached through a symlinked parent', async () => {
    const d = await makeBase()
    try {
      await writeUnit(join(d.base, 'real', 'systemd', 'user'), OWNED)
      await symlink(join(d.base, 'real'), join(d.base, 'link'))
      const unitPath = join(d.base, 'link', 'systemd', 'user', 'mso-orca.service')
      await assert.rejects(() => inspectExistingUnit({ unitPath }), /symlink/i)
    } finally {
      await d.cleanup()
    }
  })

  it('refuses a missing unit leaf under a symlinked parent', async () => {
    const d = await makeBase()
    try {
      await mkdir(join(d.base, 'real', 'systemd', 'user'), { recursive: true })
      await symlink(join(d.base, 'real'), join(d.base, 'link'))
      const unitPath = join(d.base, 'link', 'systemd', 'user', 'mso-orca.service')
      await assert.rejects(() => inspectExistingUnit({ unitPath }), /symlink/i)
    } finally {
      await d.cleanup()
    }
  })

  it('accepts a legitimate owned unit and reports an absent one', async () => {
    const d = await makeBase()
    try {
      const dir = join(d.base, 'home', '.config', 'systemd', 'user')
      const unitPath = await writeUnit(dir, OWNED)
      const found = await inspectExistingUnit({ unitPath })
      assert.equal(found.state, 'managed')
      assert.equal(found.text, OWNED)
      assert.equal((await inspectExistingUnit({ unitPath: join(dir, 'absent.service') })).state, 'absent')
    } finally {
      await d.cleanup()
    }
  })

  it('refuses a foreign unit and leaves it untouched', async () => {
    const d = await makeBase()
    try {
      const unitPath = await writeUnit(join(d.base, 'home', '.config', 'systemd', 'user'), FOREIGN)
      await assert.rejects(() => inspectExistingUnit({ unitPath }), /foreign unit/i)
      assert.equal(await readFile(unitPath, 'utf8'), FOREIGN)
    } finally {
      await d.cleanup()
    }
  })
})
