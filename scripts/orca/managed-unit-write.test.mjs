import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { constants } from 'node:fs'
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { writeUnitAtomic } from './managed-unit-write.mjs'
import { UNIT_IDENTITY_MARKER, orcaServiceUnitPath } from './managed-paths.mjs'

const FOREIGN = '[Service]\nExecStart=/usr/bin/orca --port 6768\n'
const managedText = (root) =>
  `${UNIT_IDENTITY_MARKER}\n[Service]\nExecStart="/usr/bin/node" "/repo/scripts/orca/cli.mjs" "run" --managed-root ${root} --port 6769\n`

// Stat the descriptor, not the path: the mode and the bytes both come from the
// same inode, so a swap between check and read cannot influence the assertion.
async function readUnitState(unitPath) {
  const handle = await open(unitPath, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat()
    return { mode: info.mode & 0o777, text: await handle.readFile('utf8') }
  } finally {
    await handle.close()
  }
}

async function makeHome() {
  const home = await mkdtemp(join(tmpdir(), 'oi-'))
  return { home, cleanup: () => rm(home, { recursive: true, force: true }) }
}

describe('atomic absent-unit publish', () => {
  it('refuses to clobber a foreign unit that appears at the last instant', async () => {
    const d = await makeHome()
    try {
      const unitPath = orcaServiceUnitPath({ home: d.home })
      await assert.rejects(
        () =>
          writeUnitAtomic(unitPath, managedText('/tmp/root'), {
            inspect: async () => {
              await writeFile(unitPath, FOREIGN)
              return { state: 'absent', text: null }
            }
          }),
        /appeared during install/
      )
      assert.equal((await readUnitState(unitPath)).text, FOREIGN)
    } finally {
      await d.cleanup()
    }
  })

  it('publishes an absent unit at 0644 and replaces only its own managed unit', async () => {
    const d = await makeHome()
    try {
      const unitPath = orcaServiceUnitPath({ home: d.home })
      await writeUnitAtomic(unitPath, managedText('/tmp/root'))
      const published = await readUnitState(unitPath)
      assert.equal(published.mode, 0o644)
      assert.equal(published.text, managedText('/tmp/root'))

      const updated = managedText('/tmp/root').replace('--port 6769', '--port 6770')
      await writeUnitAtomic(unitPath, updated)
      assert.equal((await readUnitState(unitPath)).text, updated)
    } finally {
      await d.cleanup()
    }
  })
})
