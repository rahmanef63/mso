# Integration Bundle v1

SC and MSO intentionally keep separate credential stores. Copying a repository,
sharing a private store file, or cloning a Git branch is not a migration. Use an
explicit, reviewed JSON transfer instead. This is a snapshot, not live sync.

## Supported workflows

SI-Coder provides `sc data export`, `sc data import`, and **Import / export JSON**
in its temporary browser manager. MSO provides the same browser workflow at
`/integrations?transfer=1`, opened from the native manager or
`mso integrations transfer`. Both use their own independent bundled codec and
native store adapter. Neither imports application code from the other product.

**Metadata is the default.** It carries user IDs/labels, named connections,
provider/source/auth identity, scope, and field names/presence. It carries **no
field values**, including public configuration values. After importing metadata,
users/connections appear but credentials still need to be configured.

**Encrypted export** carries direct credential and configuration values. It uses
AES-256-GCM with a random 12-byte IV and 16-byte authentication tag, and a 32-byte
key derived by scrypt (N=32768, r=8, p=1; random 16-byte salt). Passphrases must be
at least 12 UTF-8 bytes; the UI requires 12 characters. No passphrase CLI argument,
MCP field, browser storage, or unencrypted full export is provided. Share the
passphrase separately from the file. A forgotten passphrase cannot be recovered.

The encrypted bundle protects the transferred file; it does not add encryption
at rest to either application's existing private credential store. Metadata names
can still be confidential. Exported local files use 0600 and must not be committed.

## SC terminal

```sh
sc data export --out profiles.integration-bundle.json
sc data export --user my-user --include-secrets --out profiles.integration-bundle.enc.json
sc data import --file profiles.integration-bundle.enc.json --prefix imported-
```

The last command previews only. Review the plan, then rerun with
`--apply --confirm PREVIEW_ID`. Encrypted imports prompt for the passphrase again.
Use `--accept-warnings` only after reviewing skipped connections, unmapped fields,
and external-authorization warnings. `--policy error` makes conflicts block the
import; the default `skip` preserves existing connections. A prefix creates a
separately named copy instead of replacing the original identity.

The safe machine functions `sc.data.export` and `sc.data.import` use this same
core, but handle **metadata-only** files. Export requires `confirm: true`; import
applies only with explicit confirmation and the preview's `planId`. They do not
accept a passphrase or decrypt a credential bundle.

## Import policy

The preview hash covers the bundle, options, and destination state. Changes
require another preview. IDs, sources, methods, field names, size and protocol
version are validated before any mutation. Imports are create-only: existing
connection IDs or labels are skipped, never overwritten. An encrypted import
will not fill a pre-existing empty connection by surprise; use a distinct prefix
or explicitly remove the intended empty connection before importing again.

Imported values are **not marked verified** and are not sent to a provider during
import. Test the selected connection afterward. Defaults and folder bindings are
not transferred or automatically activated. Selecting a credential profile does
not grant an MSO Owner/Operator role.

Composio/provider-MCP accounts are imported as metadata needing fresh
authorization. OAuth access/refresh tokens, active connected-account IDs,
broker links and session capabilities are not copied across applications.

MSO applies the accepted changes under its existing atomic store transaction.
SC serializes its state writes and rolls back newly created users/connections on
ordinary write failures. SC's multi-file store is not a transactional database:
a forced process termination may leave a partial create-only import and a stale
write lock. Review that state before clearing the lock or retrying. The import
never overwrites existing credential files; symlinked/orphan destinations fail
closed or appear as skipped targets.

## Mapping and unsupported data

The wire provider ID is `cloudflare` (SC's `cf` alias maps to it). Wire field names
are stable environment identifiers, for example `GITHUB_TOKEN` maps to MSO's
`apiKey`, and `CONVEX_DEPLOY_KEY` maps to `deployKey`. Account and deployment auth
methods remain separate. Optional owner/team/domain configuration is preserved
where supported. Legacy SC profile values are exported as explicit virtual
`legacy-*` connections without changing their source store.

Unsupported providers, methods or fields appear in the preview. Their omission
requires explicit acceptance. For example, SC's `git`/`sync` local configuration
has no native MSO provider adapter. Custom provider definitions are not executed
or installed from an import. This is an **integration identity/data transfer**,
not a full backup of SC skills, project files, agent memory, logs or global settings.

## Other receiving projects

`schemas/integration-bundle-v1.schema.json` defines the public file envelope;
`schemas/integration-bundle-example.json` is a synthetic metadata example. The
bundled reference codec additionally checks aggregate limits and authenticated
encryption. Limits: 2 MiB input, 100 users, 1000 total connections, 64 fields per
connection, 4096 characters per value. Unsupported schema/KDF versions fail closed.

This is a project-owned versioned contract, **not a universal import standard**.
Baton or a connector gateway must add a receiver that validates the file, maps
identities to its own workspace/tenant, presents conflicts, and performs its own
role checks. Those services are not modified by the SC/MSO release. Do not assume
that uploading this JSON to an arbitrary endpoint imports accounts safely.

The standalone codec is bundled identically in the two repos so no runtime
cross-product dependency is required. Protocol changes require a new version and
SC↔MSO interoperability tests. Native store adapters and all conflict decisions
remain application-owned.

References: Node.js `node:crypto` documentation and the OWASP Cryptographic Storage
Cheat Sheet. The protocol uses authenticated encryption and OS randomness rather
than reversible obfuscation or an application-owned hardcoded encryption key.
