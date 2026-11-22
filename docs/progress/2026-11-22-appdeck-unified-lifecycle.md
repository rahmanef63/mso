# AppDeck: Unified Transactional Lifecycle Engine for External Open-Source Apps

- **Date:** 2026-11-22
- **Scope:** `lib/managed-apps/`, `app/api/v1/managed-apps/[id]/preflight/`, `scripts/managed-app-*`, `scripts/orca/`, `scripts/cli/`, `frontend/slices/managed-apps/`, `docs/APPDECK.md`
- **Summary:**
  - Named and implemented **AppDeck**, MSO's unified transactional lifecycle engine for all external open-source apps (`n8n`, `openclaw`, `9router`, `orca`, `t3`, `hermes`, and future OSS apps).
  - Fixed the root failure blocking non-tech Update/Uninstall/Rollback on running apps by adding automatic safe pause (`quiesceManagedApp`) before snapshots and automatic service recovery (`recoverManagedApp`) when a maintenance job fails.
  - Added `GET /api/v1/managed-apps/[id]/preflight` and `mso mapp preflight <id>` with plain-language host/runtime/disk/port/origin checks and fix hints.
  - Fixed `scripts/managed-app-n8n` (host UID/GID container permission compatibility on `~/.n8n`, 90s health wait with crash fast-fail logs), `scripts/managed-app-9router` (`sudo -n docker` fallback + crash fast-fail), `scripts/orca/managed-app-orca.mjs` + `managed-uninstall.mjs` (real pinned `check`, `update --yes`, `uninstall --yes [--dry-run]`), and `scripts/managed-app-install` (verified digest-pinned `update` and fallback `uninstall` for `hermes` and `openclaw`).
  - Upgraded the non-tech UI with `<AppDeckPreflightCard>`, 4-step `<AppDeckStepper>`, collapsible technical output logs, and collapsible terminal commands across all 6 managed apps.
