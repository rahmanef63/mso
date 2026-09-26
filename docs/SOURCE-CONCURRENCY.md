# Source concurrency and integration contract

> **Launch target.** Repository policy already requires isolated worktrees for parallel source work. Public-beta readiness requires the rule to be enforced by tooling and remote protection, not only by agent instructions.

## Invariant

`main` is the release/integration authority. It is never a shared agent scratchpad.

```text
user request
  → workflow ownership
  → isolated task worktree
  → scoped commit(s)
  → exact-SHA verification
  → integration queue on latest main
  → changed-base verification
  → release
  → live SHA verification
```

## Required behaviour

1. Every source-changing automated workflow owns exactly one isolated hidden worktree.
2. Two active workflows never share a Git index, worktree or branch.
3. A dirty canonical checkout owned by another workflow is a **hard stop**, not an invitation to stash/reset/commit its work.
4. Integration uses a clean latest `main`; candidate ancestry and remote head are revalidated immediately before integration.
5. Candidate verification does not transfer automatically to a changed integration base. Relevant changed-base tests and the release gate run again.
6. Only the integration/release authority advances canonical `main`.
7. A worktree is removed only after unique tracked/untracked work is proven preserved and accounted for.
8. Release evidence records candidate SHA, integrated SHA, deployed SHA and live SHA separately.

## Remote protection target

GitHub is code storage and a remote policy boundary; MSO/Batonly may remain the CI/CD executor. Protect `main` with a ruleset/branch policy that, where account/repository capabilities allow:

- blocks force pushes and branch deletion;
- requires the project's external status checks before integration;
- requires the branch to be current with the integration head or uses a merge queue equivalent;
- restricts direct updates to the designated integration identity;
- keeps bypass narrow and auditable.

As of the 2026-09-26 launch audit, the public GitHub rulesets collection for `rahmanef63/mso` returned empty. Branch-protection detail could not be read through the installed GitHub App because that integration lacks repository administration permission. Do not claim remote protection from that incomplete evidence.

## Acceptance tests for 10/10

- Simultaneous synthetic workflows attempt to mutate the same canonical project; only task-owned worktrees receive writes.
- A workflow with an isolated-worktree classification cannot silently write source into canonical `main`.
- A dirty canonical tree causes integration to fail without mutation.
- Two independently green candidates are replayed against latest main; stale candidate evidence is not reused as release proof.
- Remote policy rejects unauthorized direct/force update of `main`.
