# AppDeck: Unified Lifecycle Engine for External Open-Source Apps

> **Current reference.** **AppDeck** is MSO's transactional install, update, backup, rollback, and uninstall engine for every external open-source runtime managed outside MSO core (`n8n`, `openclaw`, `9router`, `orca`, `t3`, `hermes`, and future open-source apps).

MSO stays a pure gateway and orchestration shell: no external open-source repository is copied into MSO. AppDeck provides one safe, non-technical experience across heterogeneous runtimes (Docker containers, user systemd services, standalone binaries, and CLI-managed runtimes) using digest-pinned artifacts.

## 1. Non-Tech User Flows

### Install (1-Click Setup)
1. User opens an app window (e.g., n8n, OpenClaw, 9Router, Orca, T3 Code, Hermes).
2. **AppDeck Preflight** (`GET /api/v1/managed-apps/[id]/preflight`) checks host runtime (Docker or user systemd), free storage space, verified artifact lock, required split-origin route (for Orca), and loopback port availability, explaining any issue in plain language with a fix hint.
3. User clicks **Install with AppDeck**.
4. AppDeck verifies the SHA-256 / SHA-512 artifact digest, configures loopback-only bindings, starts the service, waits for the live health check (failing fast with clear diagnostics if the runtime crashes), and switches directly to the app dashboard.

### Update (Safe Zero-Surprise Upgrade)
1. User clicks **Check**, then **Update** -> **Back up and update**.
2. **Auto-Quiesce:** If the app is currently running, AppDeck pauses it automatically so databases (SQLite WAL, config files) are consistent before snapshotting.
3. **Automatic Backup:** AppDeck saves a verified state snapshot in `~/.mso/backups/<app>/`. If backup fails, nothing is touched and the app is restarted.
4. **Verified Apply:** AppDeck reconciles the runtime strictly against the reviewed digest/checksum lock in `security/managed-app-artifacts.env` (or `scripts/orca/constants.mjs`).
5. **Auto-Recovery on Failure:** If the update fails after pausing a running app, AppDeck automatically restarts the previous service so the user is never left stranded.

### Uninstall & Rollback
- **Uninstall:** Requires typing the exact app ID (plus optional non-mutating **Preview removal**). AppDeck pauses the running app, creates a `pre-uninstall` backup snapshot, and removes only the runtime/container/unit while keeping MSO backups safe. If an upstream CLI (`hermes` or `openclaw`) is broken or missing, AppDeck falls back cleanly to `scripts/managed-app-install <app> uninstall --yes`.
- **Rollback:** AppDeck pauses the running app, creates a `pre-restore` safety snapshot, restores the chosen snapshot safely (with symlink-escape guards), and resumes the app automatically if it was running.

## 2. Architecture Options Considered

| Option | Approach | Pros | Cons | Decision |
|---|---|---|---|---|
| **A. Ad-hoc per-app scripts** (previous state) | Each app writes custom bash + custom UI checks; backup fails if app is running | Quick to prototype | Update/Uninstall fails on running apps; Orca/Hermes/OpenClaw updates disabled or broken; raw CLI logs overwhelm non-tech users | Rejected |
| **B. Docker-only standardization** | Force all external apps into Docker containers | Uniform runtime | Breaks native systemd apps (`t3`, `orca`, `openclaw`, native `hermes`) and local host integrations | Rejected |
| **C. AppDeck (Unified Transactional Engine + Declarative Driver Contract)** | Shared TS lifecycle core (`appdeck-lifecycle.ts`, `appdeck-preflight.ts`, `job-runner.ts`) + thin digest-pinned runtime adapters (`scripts/managed-app-*`) + 4-step non-tech UI stepper | Works uniformly for Docker, systemd, and hybrid runtimes; auto-quiesce + auto-backup + auto-recovery; 100% immutable supply-chain pinning; reusable for any future OSS app | Requires each new app to implement the small 5-verb adapter contract | **Selected** |

## 3. Supported External Open-Source Apps

| App | Runtime | Install | Update (Pinned) | Backup & Rollback | Uninstall + Preview | Preflight |
|---|---|---|---|---|---|---|
| **n8n** | Docker (`docker.n8n.io/n8nio/n8n@sha256`) | Yes (UID-safe `~/.n8n`) | Yes (auto-quiesce) | Yes | Yes | Yes |
| **OpenClaw** | User systemd (`openclaw-gateway.service`) | Yes (SHA-512 lock) | Yes (pinned tarball) | Yes | Yes (+ fallback) | Yes |
| **9Router** | Docker (`@sha256` + `sudo -n docker` fallback) | Yes | Yes (auto-quiesce) | Yes | Yes | Yes |
| **Orca** | User systemd (`mso-orca.service`) | Yes (pinned release) | Yes (reconcile) | Yes | Yes (owned-only) | Yes |
| **T3 Code** | User systemd (`t3-code.service`, SHA-256 tarball) | Yes | Yes (auto-quiesce) | Yes | Yes | Yes |
| **Hermes** | User systemd or Docker fallback (SHA-256 lock) | Yes | Yes (pinned lock) | Yes | Yes (+ fallback) | Yes |

## 4. Onboarding Any Future External Open-Source App

To add a new open-source app to AppDeck without copying upstream code into MSO:
1. Pin immutable release hashes in `security/managed-app-artifacts.env` and verify them in `lib/security/managed-app-supply-chain.test.ts`.
2. Add the app definition in `lib/managed-apps/catalog.ts`, `lib/managed-apps/types.ts`, and `APPDECK_DRIVERS` in `lib/managed-apps/appdeck-lifecycle.ts`.
3. Provide a reviewed adapter script under `scripts/managed-app-<id>` speaking the fixed grammar:
   - `--version`
   - `check --json` -> `{"currentVersion":"...","latestVersion":"...","hasUpdate":false}`
   - `install`
   - `update --yes`
   - `uninstall --help` and `uninstall --yes [--dry-run]`
   - Emit `[appdeck] step=download|apply|health|ready` milestones for the UI stepper.
4. Register the adapter in `lib/managed-apps/update-cli.ts` (`pinnedAdapter(...)`) and the Managed Apps UI under `frontend/svelte/src/lib/managed-apps/`.
5. Run `bun run gate:smart` and `bun run pr:security` to verify contract, supply-chain, ShellCheck, and Semgrep gates.
