import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
  MANAGED_ROOT_RELATIVE_TO_HOME,
  UNIT_IDENTITY_MARKER,
  assertManagedRootFitsUnixSocket,
  defaultManagedRoot,
  installReceiptPath,
  orcaServiceUnitPath,
  resolveManagedRoot,
  serviceConfigPath
} from './managed-paths.mjs'

const HOME = '/home/operator'

describe('managed Orca root resolution', () => {
  it('defaults to the portable MSO-owned state directory, never ~/.orca', () => {
    assert.equal(defaultManagedRoot({ home: HOME }), join(HOME, ...MANAGED_ROOT_RELATIVE_TO_HOME))
    assert.equal(resolveManagedRoot({ env: {}, home: HOME }), join(HOME, '.local', 'share', 'mso', 'orca'))
  })

  it('accepts only a canonical absolute ORCA_HOME and rejects dirty spellings', () => {
    assert.equal(resolveManagedRoot({ env: { ORCA_HOME: '/srv/mso/orca' }, home: HOME }), '/srv/mso/orca')
    for (const dirty of ['/srv/mso/orca/', '/srv//mso/orca', '/srv/mso/./orca', '', '   ']) {
      assert.throws(() => resolveManagedRoot({ env: { ORCA_HOME: dirty }, home: HOME }), /ORCA_HOME/)
    }
    assert.equal(resolveManagedRoot({ env: {}, home: HOME }), join(HOME, '.local', 'share', 'mso', 'orca'))
    assert.equal(resolveManagedRoot({ env: { ORCA_HOME: undefined }, home: HOME }), defaultManagedRoot({ home: HOME }))
  })

  it('refuses relative, traversing, root, home, and personal Orca roots', () => {
    for (const bad of ['relative/orca', '/srv/../etc', '/', HOME, `${HOME}/.orca`, `${HOME}/.orca-remote/x`]) {
      assert.throws(() => resolveManagedRoot({ env: { ORCA_HOME: bad }, home: HOME }), /ORCA_HOME/)
    }
    assert.throws(() => resolveManagedRoot({ env: { ORCA_HOME: '/srv/orca\n' }, home: HOME }), /control/)
  })

  it('keeps service config and receipts inside the managed root', () => {
    const root = '/srv/mso/orca'
    assert.equal(serviceConfigPath(root), '/srv/mso/orca/managed-service.json')
    assert.equal(installReceiptPath(root), '/srv/mso/orca/managed-install.json')
    assert.equal(
      orcaServiceUnitPath({ home: HOME }),
      join(HOME, '.config', 'systemd', 'user', 'mso-orca.service')
    )
  })

  it('pins the unit marker used by the collision guard', () => {
    assert.equal(UNIT_IDENTITY_MARKER, '# mso-managed-app: orca')
  })

  it('refuses a managed root too deep for the runtime Unix socket', () => {
    assert.equal(assertManagedRootFitsUnixSocket('/srv/mso/orca'), '/srv/mso/orca')
    assert.throws(() => assertManagedRootFitsUnixSocket(`/${'a'.repeat(80)}`), /too deep for the Orca runtime/)
  })
})
