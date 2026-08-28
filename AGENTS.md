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

## MCP feature work

Use [`docs/MCP-FEATURE-IMPLEMENTATION.md`](./docs/MCP-FEATURE-IMPLEMENTATION.md) and the
official [`mso-mcp-feature-engineering`](./claude-skills/mso-mcp-feature-engineering/SKILL.md)
skill. Public MCP tool names, schemas, scope, audit metadata, parity, toolset signature,
external mappings, skill trust/routing, and client action refresh are one release contract.
Do not declare an MCP change complete until that full contract is verified.


## Comparison and privileged operations

- `docs/comparison-data.json` is the comparison SSOT. Generate README/`docs/COMPARISON.md` with
  `node scripts/gen-comparison.mjs`; never edit those outputs manually or improve an MSO rating
  without existing code evidence. Use official sources and honor the freshness gate.
- Preserve the live Viewer/Operator/Owner route policy. UI filtering is not authorization; unknown
  mutations must fail to Owner. Device roles are not Linux users or SSO.
- System service actions require exact owner allowlisting and fixed argv. Do not add wildcard units,
  raw `systemctl` arguments, or package-update/apply buttons to the Viewer/Operator surface.

## Shipping

Follow `CLAUDE.md`: update `docs/PROGRESS.md`, run the relevant gates, and ship through
`bun run ship "<conventional commit>"`. Do not replace the repository's release path with a
bare push.
