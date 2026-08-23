# OpenClaw integration

> **Current reference.** OpenClaw is one of MSO's two managed applications. MSO presents
> the vendor dashboard as one surface and no longer turns OpenClaw's internal routes into
> MSO launcher features.

## Runtime identity

| Property | Current MSO value |
|---|---|
| Managed id | `openclaw` |
| Preferred service | `openclaw-gateway.service` |
| Other recognized service | `openclaw.service` |
| Dashboard upstream | `http://127.0.0.1:18789` by default |
| State | `~/.openclaw` |

## What MSO can do

- detect install/runtime/version/health;
- install OpenClaw non-interactively;
- start, stop and restart the gateway;
- read logs;
- snapshot state;
- check, dry-run and apply updates;
- switch supported update channels/tags;
- restore a snapshot and optionally use a validated package-version pin;
- conservatively uninstall service + local state;
- optionally proxy the Control UI from its own managed-app hostname.

## Install

The one-click flow runs `scripts/managed-app-install openclaw` as a managed-app job and uses
OpenClaw's non-interactive onboarding with its required risk acknowledgement. MSO defaults
the gateway bind to loopback unless the deployment explicitly needs another supported bind.

A model-provider key is optional. When supplied it travels in the request body and child
environment, never the persisted argv or job log.

## Update semantics

OpenClaw supports a real dry run, so the UI exposes it. MSO validates channel/tag/version
inputs before they become separate argv values. Package specs or arbitrary git sources are
not accepted as rollback pins; the permitted shape is a known dist-tag or an exact version.

Every real update starts with an MSO snapshot of `~/.openclaw`. A failed backup aborts the
update. Normal updates allow the upstream restart/verification path to run; leaving new
package bytes on disk behind an old process is deliberately not the default.

## Backup and restore

Snapshots are stored under `~/.mso/backups/openclaw/<timestamp>/`. Symlinks are skipped and
reinstallable/cache trees such as `node_modules`, `.cache`, `.git`, virtualenv directories
and nested backups are excluded.

Restore requires OpenClaw to be stopped (and that state to be provable). MSO validates the
snapshot manifest and target, checks symlink collisions, takes a `pre-restore` safety
snapshot, then overwrites snapshot files. Files created since the snapshot remain in place;
excluded directories are not reconstructed.

If the desired rollback also requires a previous OpenClaw package release, the update
adapter can apply a validated exact version/tag separately from the restored state.

## Uninstall

MSO uses the upstream non-interactive uninstall scoped to the gateway service and local
state. It does not add OpenClaw's workspace-removal scope. A preview is available when the
installed CLI still advertises its dry-run contract. A real uninstall requires explicit
confirmation and an MSO backup first.

## Dashboard and origin

When split-origin embedding is enabled, a hostname such as
`openclaw.mso.example.com` is rewritten only into OpenClaw's authenticated dashboard proxy
and forwarded to loopback `:18789`. Without the two split-origin environment settings, the
Control UI is not embedded and MSO's Details surface remains usable.

The origin boundary protects the cockpit browser realm, not the host from OpenClaw itself.
An OpenClaw plugin has the privileges of the OpenClaw daemon and can run host code according
to OpenClaw's own trust model.

## Troubleshooting

- **Gateway installed but stopped:** use Start from the MSO surface; the vendor iframe is
  intentionally not mounted while nothing is serving it.
- **Dry run works but update fails:** inspect the mandatory snapshot and then the job
  transcript; the real run also restarts/verifies the service.
- **Control UI cannot connect after a new install:** check the app-origin allowlist/bind
  values created by the installer and the split-origin hostname.
- **Restore refused:** stop OpenClaw first and fix the reported state-path/symlink problem.
- **Need to remove the workspace too:** MSO intentionally does not expose that destructive
  uninstall scope; review and run the upstream operation yourself if you truly need it.
