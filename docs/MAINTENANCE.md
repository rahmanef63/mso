# Reset and uninstall

MSO has separate controls for browser data, server configuration, and installation removal.
None of the server maintenance commands performs a write by default. Run them as the normal
installation owner on Linux, from an independent local/SSH terminal—not inside the MSO web terminal.

## Choose a scope

| Action | Removes from active use | Preserves |
|---|---|---|
| Settings → About → Appearance only | This browser's appearance cache | Identity, drafts, server data |
| Settings → About → All MSO browser data | MSO layouts, Playbooks, drafts and owned local storage | Device approval, unrelated browser storage, server files |
| `mso reset` | Managed server preferences and model/infrastructure configuration | Authentication, history, `.env.local`, source, external apps |
| `mso reset --scope all` | Known MSO configuration, identity/token stores, memory, sessions/history, `.env.local` | Source, unknown files, other projects and external providers |
| `mso uninstall` | Verified service registrations and CLI/skill symlinks belonging to this checkout | Source, all server data, browser storage |
| `mso uninstall --purge` | Above plus known MSO state and reset archives | Source, unknown files, external/shared resources |
| `mso uninstall --purge --remove-code` | Above plus a verified clean standalone clone | Other projects and resources not owned by the installation |

Browser appearance and Quicklinks can be restored from the server on the next sign-in.
Use the server configuration reset too when clearing those synchronized preferences.
Export a browser backup in Settings → Backup before clearing local drafts: the server reset
archive does not contain browser-only data.

The default server state is per Unix user and can be shared by multiple MSO checkouts.
Server reset or `--purge` affects that user's selected MSO state, not just one browser or Git branch.
All MSO instances sharing the state must be stopped first.

## Preview first

```bash
mso reset
mso reset --scope all --json
mso uninstall
mso uninstall --purge --remove-code
```

The preview lists exact archive/removal targets, retained paths and blockers. It does not source
`.env.local`, create an authentication cookie, stop a process, or mutate a service.
`--base` and `--env` are rejected for these local commands so a remote URL cannot silently cause
maintenance on the wrong machine. A custom service name can be selected with `--service name.service`.

## Apply the reviewed plan

Stop MSO and its owned fallback/gateway runtimes first, through an independent SSH terminal.
For a standard systemd installation, the main service is `mso.service`; the optional browser
service is the user unit `camoufox-vnc.service`. Stop only the units/tunnels belonging to this
installation. Do not stop another project's services to make a check pass.

Run the preview again after stopping the runtime. Copy the exact token it prints, then repeat
**the same scope/options** with both flags:

```bash
mso reset --apply --confirm <token-from-current-preview>
```

The placeholder is not a usable token. A changed file, scope or unit changes the plan token;
inspect a fresh preview rather than reusing an old confirmation. `--yes` is intentionally unsupported.

Apply checks ownership, symlinks, target identity and offline runtime state, then coordinates
with the checkout's existing runtime-exclusion lock. It refuses when started inside the live MSO
service. It does not silently stop production or approve its own destructive action.

## Reset recovery archive

Reset **moves**, rather than destroys, selected data into an owner-only archive:

```text
~/.mso/maintenance-backups/<unique-id>/
├── manifest.json                # original paths and reviewed scope; mode 0600
└── files/                       # preserved data; private parent directories
    ├── .mso/...
    └── <checkout>/.env.local    # only for --scope all
```

Archive directories are `0700`. They can contain valid credentials and private conversations;
do not commit, upload, email, or publish them. A reset does not revoke provider credentials.
`uninstall --purge` permanently deletes these archives along with the selected known state.
File deletion is not a guarantee of secure erasure from SSDs, snapshots or third-party backups.

To recover, keep MSO stopped, inspect `manifest.json`, and move only the intended archived items
back to their recorded locations after verifying that those destinations are absent. Do not
blindly overwrite new configuration. For a full reset without restoration, re-run the official
installer to create new local authentication configuration, then onboard and pair devices again.

An interruption is reported as a failure, with the count of completed steps and recovery path.
The operation does not claim transaction-wide rollback; completed archive moves remain recoverable.

## Clean uninstall boundaries

Source removal is refused for a dirty checkout, a linked worktree, a clone with additional
worktrees, or unrecognized ignored files. This prevents a cleanup command from deleting unpushed
work, sibling projects or files that Git does not describe. Preserve those items independently
before requesting source removal. No force option bypasses these checks.

Only verified symlinks into this checkout and verified service files are removed. A third-party
command named `mso`, a manually installed skill, or a service belonging to another checkout is
retained. If service removal requires elevated permission, the operation uses noninteractive
`sudo` for the exact system operation and fails when permission is unavailable.

Unrecognized `.mso` entries—including old worktrees, operator artifacts and coordination state—are
retained and reported, not recursively swept away. Empty parent directories or lock metadata may
remain. Review the retained list before calling the host completely cleaned.

These are intentionally **not** removed: other projects, shared Node/Bun/system packages,
external managed applications and their data, SC/CR/provider stores, cloud deployments,
DNS/TLS configuration, browser profiles/cookies, and browser-local storage on other devices.
Remove or revoke external resources separately through their owning tools.

Configured or inherited custom storage overrides block automatic reset/purge. Their values are
not printed and their targets are not traversed. Reconcile those paths manually; the command
never claims a customized installation was completely reset while quietly leaving a secret store behind.

## Verification

`bun run test -- scripts/maintenance.test.ts` exercises isolated synthetic homes only, including
preview immutability, stale confirmation, identity/symlink checks, private archives, normal uninstall,
explicit purge, clean standalone source removal and failure-before-data-removal on service errors.
Browser ownership is tested separately in `frontend/slices/os-settings/lib/browser-reset.test.ts`.
The maintenance feature is not tested by resetting or uninstalling the maintainer's production host.
