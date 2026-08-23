---
name: mso-deploy
description: Ship MSO safely using its verified release path: preflight, out-of-tree verification, commit and push gates, build then restart, health and chunk checks, and visual proof.
metadata:
  mso:
    risk: high
    policy: verify-ship-prove
---

# /mso-deploy — production release recipe

Call `workflow_start` with the complete change and deployment intent, then carry its exact `workflow_id` on every operational call. Confirm the resolved project is the production MSO checkout and inspect `CLAUDE.md` plus the top of `docs/PROGRESS.md` before shipping.

## Required order

1. Run the smallest targeted tests, then `bun run verify` (which includes documentation/skill checks).
2. Review `git diff --check`, the final diff/stat, and append shipped reasoning to `docs/PROGRESS.md`.
3. Run `bun run ship "<conventional commit>"`. Its pre-push gate performs the authoritative out-of-tree build for the committed SHA; do not run a redundant production build first.
4. From MCP, `ship` hands the in-place build/replacement to `mso-self-update.service`; that handoff means **scheduled**, not deployed.
5. Poll `systemctl --user is-active mso-self-update.service` and `~/.mso/self-update.log` until the unit is inactive and the log ends in `UPDATE OK`. Never use fixed sleeps as proof.
6. Verify `mso.service` is active, `/api/health` reports the new build, and CSS/JS chunks referenced by live HTML have the expected MIME types.
7. Run the live smoke test and `screen_capture` when UI changed.
8. Call `workflow_finish(success=true)` only after all requested runtime proof passes.

`git push` alone is not deployment. The production checkout's `.next` is live: build then restart immediately, never restart before build, and never leave an in-place build without the matching restart. `nohup` is not a detach boundary inside `mso.service`; the service manager terminates the whole cgroup. The owner transient user unit is the supported long-running release boundary.
