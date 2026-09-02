# AGENTS.md — MSO agent instructions

`CLAUDE.md` is the full repository/operator contract and remains authoritative. Read it
before changing MSO. This file gives non-Claude agents the minimum routing needed to avoid
re-discovering the same failure patterns.

## Systematic implementation default

For debugging, integrations, refactors, deployments, and MCP work, use this loop:

1. **Resolve the real target** — identify the canonical repository, active branch, running
   process/container, deployed version, state directory, and public route. Never edit the
   first matching clone, package cache, generated build, or `/tmp` checkout.
2. **Observe before changing** — reproduce the behavior and preserve the first concrete
   error, response, screenshot, cookie, process state, or diff that proves it.
3. **Map the pattern end to end** — trace entry point → adapter/schema → handler → shared
   guard/state → UI/client → deploy/runtime. Find a working sibling implementation before
   inventing a new architecture.
4. **Name the limits** — record scope, permissions, trust, client caches, pagination/cursors,
   process lifetime, ports/domains, persistence, cross-repo contracts, and deployment
   boundaries. Separate facts, inferences, and unknowns.
5. **Run the smallest discriminating experiment** — test one hypothesis at a time. Do not
   stack several speculative fixes or retry an unchanged command without new information.
6. **Make one reversible change** — preserve current configuration and data, keep a rollback,
   and change the smallest authoritative layer rather than patching symptoms in every caller.
7. **Verify in layers** — targeted test → contract/parity check → build → runtime health →
   browser/mobile/session-restart proof when applicable. A zero exit code is not proof of the
   requested behavior.
8. **Record the reusable pattern** — durable workflow policy belongs in `AGENTS.md`,
   `CLAUDE.md`, or a trusted `SKILL.md`; implementation contracts belong in current docs;
   volatile host facts stay in project/runbook notes.

## Architecture ownership

Before adding another adapter/facade/barrel, read [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) and run `node scripts/check-architecture.mjs`. The architecture policy is ratcheted: transports share `lib/capabilities`, cross-layer DTOs live in `lib/contracts`, host calls use narrow `lib/host/*-api.ts`, generic apps use AppShell directly, and workflow persistence belongs to `lib/workflow`. Do not raise a ratchet just to make a change pass. Exact MCP catalog facts are generated with `node scripts/gen-mcp-catalog.mjs`; never hand-copy the current tool list into reference docs.

## Repository and worktree policy

- `/home/rahman/projects/mso` on `main` is the **only canonical MSO checkout and release SSOT**.
  Do not create task-specific `mso-*` sibling directories under `~/projects`.
- Parallel coding/review tasks may use isolated Git worktrees only under
  `~/.cache/mso-worktrees/mso-<task>`. Never let two sessions share one worktree, HEAD, or index.
- Keep development worktrees out of `~/.mso`: that tree is private runtime/credential state and is
  deliberately denied by MSO host-file guards. `~/.cache/mso-worktrees` is disposable developer isolation.
- A worktree is disposable development isolation, **never an install or release source**.
  Every user-deliverable change must be committed, reconciled into `main`, verified, and present
  on `origin/main` before the task can be called shipped. The installer/updater consumes `main`.
- Never delete or prune a dirty worktree. First preserve its tracked and untracked work in a
  commit/branch or explicit archive, then verify that the deliverable commits are reachable from
  `main` (or intentionally retained as non-release work).
- Demo/review runtimes may have hidden internal checkouts, but they do not become a second source
  of truth and must not be presented as another MSO project.

## Install and update requests

When a user asks an agent to "install MSO from this repo" or "update MSO", do not invent a parallel
setup flow. Read `README.md` + `docs/INSTALL.md` and use the repository-owned entry points:

- fresh install or legacy install without `mso update`: run the official `scripts/install.sh` bootstrap;
- current install: prefer `mso update` or the equivalent Settings → About action;
- never create a second checkout when `mso.service` already owns one; preserve `.env.local`, `~/.mso`,
  and any dirty/diverged source rather than resetting it;
- finish with `mso doctor` plus runtime health, and report only the remaining action the user must take;
- when a provider credential is required, name the official place/endpoint to create it and where MSO
  stores it, then use hidden/STDIN input. Never place a secret in argv, Git, documentation, or agent logs.

## MCP feature work

Use [`docs/MCP-FEATURE-IMPLEMENTATION.md`](./docs/MCP-FEATURE-IMPLEMENTATION.md) and the
official [`mso-mcp-feature-engineering`](./claude-skills/mso-mcp-feature-engineering/SKILL.md)
skill. Public MCP tool names, schemas, scope, audit metadata, parity, toolset signature,
external mappings, skill trust/routing, and client action refresh are one release contract.
Do not declare an MCP change complete until that full contract is verified.


## Cognitive-runtime work

- The LLM provider is replaceable. Do not solve MSO agent quality by hard-coding one vendor's hidden
  reasoning/session behavior when the same invariant can live in the provider-neutral harness.
- Preserve the three identity boundaries: authenticated client principal → durable conversation session →
  exact workflow/job. Active work is session-scoped; verified recipes may be client-scoped.
- Public MCP remains capability-complete. MSO-owned model harnesses may defer/select schemas, compact
  history, or bound tool output only when capability recall and permissions remain unchanged.
- Any context/tool optimization must run `bun run bench:cognitive`; smaller prompts are not a win if
  required-tool recall, deterministic behavior, verification, or security regresses.
- Competitor claims require comparable measurements. A Hermes prompt-size win is not an overall Hermes
  win; do not claim OpenClaw superiority until an equivalent task/quality benchmark exists.
- The current contract and P1 boundaries live in `docs/COGNITIVE-RUNTIME.md`.

## Comparison and privileged operations

- `docs/comparison-data.json` is the comparison SSOT. Generate README/`docs/COMPARISON.md` with
  `node scripts/gen-comparison.mjs`; never edit those outputs manually or improve an MSO rating
  without existing code evidence. Use SEO-readable words (`Strong`, `Partial`, `Not offered`),
  never icon-only status legends; use official sources and honor the freshness gate.
- Preserve the live Viewer/Operator/Owner route policy. UI filtering is not authorization; unknown
  mutations must fail to Owner. Device roles are not Linux users or SSO.
- System service actions require exact owner allowlisting and fixed argv. Do not add wildcard units,
  raw `systemctl` arguments, or package-update/apply buttons to the Viewer/Operator surface.

## Shipping

Follow `CLAUDE.md`: update `docs/PROGRESS.md`, run the relevant gates, and ship through
`bun run ship "<conventional commit>"`. Do not replace the repository's release path with a
bare push.
