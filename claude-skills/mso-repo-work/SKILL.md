---
name: mso-repo-work
description: Change an MSO-managed code repository efficiently: resolve aliases, inspect Git once, search broadly in one scoped batch, patch safely, and verify only what the change can break.
metadata:
  mso:
    risk: medium
    policy: inspect-batch-patch-verify
---

# /mso-repo-work — fast, bounded repository changes

For multi-step work, call `workflow_start` directly. It already searches skills and prior recipes, resolves aliases such as `os-vps` → `mso`, reports the current toolset, and returns repository context. Carry its exact `workflow_id` on every operational call in that run.

## Canonical checkout and isolation

- `/home/rahman/projects/mso` on `main` is the canonical MSO checkout and the only release SSOT.
- Never create task-specific `mso-*` siblings in `~/projects`. When isolation is genuinely needed,
  create/use one Git worktree per task under `~/.cache/mso-worktrees/mso-<task>`.
  Do not use `~/.mso` for source worktrees; it is MSO private state and host-file guards deny it.
- Never share one worktree, index, or HEAD between concurrent sessions.
- Worktree completion is not release completion. Preserve the work, reconcile the deliverable commits
  into `main`, verify there, and ship through the repository release path. A user installing MSO only
  receives what is committed on `origin/main`.
- Before pruning/removing a worktree, ensure it is clean or explicitly archived and that all intended
  release commits are reachable from `main`.

## Route selection

- One or two direct file operations: bounded `fs_*` tools.
- Repository-wide search, Git inspection, tests, builds, or three or more related checks: one narrow `exec_run` batch.
- Destructive cleanup, history rewrites, force push, credential changes, or deleting user data: require explicit approval.

A useful first batch is:

```bash
set -euo pipefail
git status -sb
git log -1 --oneline --decorate
git worktree list --porcelain
rg -n "<target>" app lib frontend scripts docs
```

Do not perform one tool call per folder. Read the exact files returned by search. When replacing an existing text file through MCP, use `fs_read` first and pass its SHA-256 as `fs_write.expected_sha256`; a changed file must be inspected again rather than overwritten.

## Finish

Run the smallest relevant test first, then typecheck/lint or the project verification command. For MSO itself, a check build must use `scripts/verify-build.sh`; never run `next build` in the live checkout merely to test compilation. Review `git diff --check`, `git diff --stat`, and the final diff before `workflow_finish`. If the task is user-deliverable, do not call it shipped while its commits exist only on a feature/worktree branch.
