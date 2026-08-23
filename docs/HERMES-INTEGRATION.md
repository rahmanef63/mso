# Hermes integration

> **Current reference.** Hermes is one of MSO's two managed applications. MSO no longer
> scrapes Hermes' SPA routes into launcher items; historical feature-discovery details are
> available in Git history, not in this runtime contract.

## Runtime identity

| Property | Current MSO value |
|---|---|
| Managed id | `hermes` |
| Preferred service | `hermes-dashboard.service` |
| Other recognized services | `hermes-gateway.service`, `hermes.service` |
| Dashboard upstream | `http://127.0.0.1:9119` by default |
| State | `HERMES_HOME` when set, otherwise `~/.hermes` |

The dashboard service is intentionally ranked ahead of the messaging gateway because it is
the service that actually answers the framed dashboard port.

## What MSO can do

- detect installation/runtime state and version;
- install Hermes non-interactively;
- start, stop and restart the known service;
- read recent logs;
- create state snapshots;
- check/apply upstream updates;
- restore an MSO snapshot while Hermes is stopped;
- conservatively uninstall Hermes;
- optionally proxy the vendor dashboard from a dedicated managed-app hostname.

The generic architecture and backup/restore rules are in `docs/MANAGED-APPS.md`.

## Install

The one-click flow runs `scripts/managed-app-install hermes` as a long-running managed-app
job. Hermes may fetch a Python toolchain and other prerequisites first, so several minutes
is normal.

A model provider is optional during installation. If supplied, the API key is sent once and
passed to the installer through its environment; MSO does not persist the key in the job
argv or transcript. Installing with no provider is valid—the running Hermes application can
be configured later through its own settings.

## Lifecycle

MSO recognizes the dashboard/gateway systemd units and exposes bounded
start/stop/restart actions rather than asking an AI client to run arbitrary service-manager
commands. When state detection is uncertain because the user bus is unavailable, MSO says
so and refuses install/restore operations that would be unsafe under that uncertainty.

## Update semantics

Hermes supports an upstream read-only update check and a real apply operation. It does not
have a true update dry-run equivalent to OpenClaw's `--dry-run`.

Before an apply, MSO creates a state snapshot. A failed snapshot aborts the update. MSO
leaves Hermes' own backup preference alone rather than overriding it.

Hermes has branch switching upstream, but MSO does not use it as an automatic rollback pin.
A restored `~/.hermes` tree can be dirty relative to Hermes' git checkout; immediately
running the branch updater can stash/reapply/reset exactly those restored files. For that
reason rollback restores state first and leaves code-branch movement as a separate explicit
operator decision.

## Backups and restore

MSO snapshots Hermes state under `~/.mso/backups/hermes/<timestamp>/`. The snapshot skips
symlinks and reinstallable/cache directories including `.git`, `.venv`, `node_modules`,
`.cache`, `__pycache__` and nested `backups` trees.

Restore is available when Hermes is stopped. MSO verifies the backup manifest/path, checks
for symlink collisions, creates a `pre-restore` safety snapshot, then overwrites files from
the selected snapshot. It does not delete files created since that snapshot and does not
recreate directories that were excluded from backups.

This is separate from Hermes' own backup/import features; each system owns its own snapshot
format.

## Uninstall

The MSO-managed uninstall uses Hermes' conservative removal path and keeps `~/.hermes`
state by default. The more destructive upstream full removal flag is not exposed by MSO.
MSO creates a snapshot before invoking the uninstall; a failed snapshot means no uninstall.

## Dashboard

Embedding is opt-in. With split-origin configuration, a host such as
`hermes.mso.example.com` routes only to the authenticated MSO Hermes proxy, which forwards
to the loopback dashboard. Without split-origin configuration, MSO does **not** embed the
vendor dashboard and the Details management surface remains available.

Do not install untrusted Hermes plugins because of the iframe origin separation. A Hermes
plugin executes inside Hermes with Hermes' host privileges; browser-origin isolation only
protects the MSO browser realm.

## Troubleshooting

- **Hermes appears installed but dashboard is absent:** confirm the dashboard service, not
  only the messaging gateway, is actually listening; then check split-origin configuration.
- **Install button refuses because state is uncertain:** repair MSO access to the owner
  systemd user bus before retrying.
- **Update refuses before running:** inspect the mandatory state-snapshot error.
- **Restore refuses:** stop Hermes first and resolve the reported path/symlink mismatch.
- **Need the old branch as well as old state:** restore state in MSO, then move the Hermes
  checkout separately after reviewing the resulting working tree; do not make branch
  switching an automatic continuation of restore.
