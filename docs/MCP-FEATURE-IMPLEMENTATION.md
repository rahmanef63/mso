# MCP feature implementation — reverse-engineering playbook

> **Current implementation note.** This document describes how to add or repair MSO MCP
> tools, trusted skills, project function capabilities, OAuth/scope behavior, and client
> action definitions without guessing. Protocol and security authority remains
> [`MCP.md`](./MCP.md); Alfa/Tool/Skill/Playbook semantics remain
> [`frontend/slices/assistant/CONTRACT.md`](../frontend/slices/assistant/CONTRACT.md).

## 1. Default loop: observe → map → bound → reverse-engineer → change → prove

Large integration failures are rarely one missing line. They usually cross a runtime owner,
transport contract, client cache, persistence boundary, and deployment path. Work in explicit
stages:

1. **Resolve the canonical target.** Record the real repository/worktree, branch and SHA,
   running service/container, image/package version, state directory, public origin, and
   ownership model. A package cache, generated bundle, npm global install, temporary clone,
   and live container are different targets.
2. **Capture the current behavior.** Reproduce it with the smallest request or viewport.
   Preserve the first error and the evidence needed to compare after the fix.
3. **Draw the execution path.** Follow public descriptor/client → MCP route → tool schema →
   dispatcher → shared host capability → state/audit → response. For skills, follow discovery
   root → trust calculation → catalog id → search/read → model context.
4. **List contracts and limits.** Include scope tier, token/client identity, path jail,
   approval/audit behavior, scan caps and cursors, external action mappings, client-side tool
   snapshot, process lifetime, release handoff, state persistence, and domain/port behavior.
5. **Find the working analogue.** Compare with a sibling tool, Hermes/OpenClaw managed app,
   existing skill, or the in-app Alfa surface. Reuse the established seam; do not create a
   parallel implementation just because it looks faster.
6. **State hypotheses.** Label each as fact, inference, or unknown. Run the smallest experiment
   that can reject one hypothesis. Do not retry the same failed operation unless the inputs or
   environment changed.
7. **Change one authoritative layer.** Prefer a small reversible mutation with preserved state
   and an explicit rollback. Do not patch generated output, every caller, or a temporary copy.
8. **Prove the user-visible outcome.** Targeted tests and build are necessary but not sufficient;
   verify the running route, mobile geometry, cookie/session restart, external client refresh,
   or other exact behavior the request concerns.

## 2. Reverse-engineering map

Before implementation, fill this map:

| Question | Required evidence |
|---|---|
| What owns the runtime? | systemd unit, container, package launcher, or Next service plus exact version/SHA |
| What owns persistent state? | canonical directory/database/cookie and its mount/domain/lifetime |
| What is the public contract? | tool name/schema, OAuth discovery, scope, annotations, response shape |
| What is cached elsewhere? | ChatGPT/Claude/Cursor tool snapshot, browser state, reverse proxy, image tag |
| What is the working analogue? | exact sibling files and why their lifecycle matches |
| What is optional? | domain, provider, UI shell, CLI, external mapping, or project capability |
| What is the rollback? | previous commit/image/config and state-preserving restore path |
| What proves completion? | test, descriptor/hash, runtime health, browser/action refresh, and live result |

If any row is unknown and materially affects the change, inspect it before writing code.

## 3. MCP tool implementation pattern

A public tool is not only a function. Its release contract spans all of these surfaces:

| Surface | Rule |
|---|---|
| Public name | Stable snake_case name; renames/removals require external mapping review |
| Description/schema | Exact input contract, bounded values, required fields, and file annotations |
| Scope | `read`, `write`, or `exec`; list filtering and call-time enforcement must agree |
| Handler | Thin tool descriptor/adapter; shared execution policy lives in `lib/capabilities`, host effects in the narrow guarded `lib/host/*-api.ts` facade |
| Audit | Mutating/exec operations declare action and target; dispatcher records MCP actor |
| Limits | Timeouts, rate/size caps, allowed roots, pagination, and continuation semantics |
| Parity | Alfa/MCP coverage or an explicit documented reason for MCP-only behavior |
| Toolset | Schema-derived version/hash/count visible in descriptor, initialize, list, and Settings |
| External clients | cached ChatGPT/Claude/Cursor/downstream client actions |
| Documentation | `MCP.md`, relevant runbook, progress rationale, and refresh instructions |

Implementation sequence:

1. Inspect the closest existing tool, the transport-neutral capability policy it inherits, and the narrow host/domain facade it delegates to.
2. Add or adjust the schema and scope in the authoritative MCP catalog; do not bypass `executeCapabilityCall()` or call raw `fs`/`child_process` from the tool.
3. Add audit metadata for mutations/exec; the capability kernel records the transport actor consistently and keeps reads unlogged unless policy deliberately changes.
4. Test schema validation, scope visibility, call-time refusal, limits, handler response, audit,
   and failure shape.
5. Run Alfa/MCP parity tests and treat every public MSO tool name/schema as a compatibility contract before changing it.
6. Advance toolset metadata when the public schema/description/scope/annotation changes. Verify
   the live `GET /mcp` signature rather than relying on a source constant alone.
7. Refresh or recreate the external MCP client action snapshot. Marking MSO's local
   acknowledgement does not mutate ChatGPT remotely.

## 4. Trusted skill implementation pattern

A `SKILL.md` is routing and reusable workflow policy, not executable code and not project state.

1. Generate official skills with `bun run skill:new`; never promote copied untrusted
   instructions directly into an official/operator root.
2. Write precise **use**, **do-not-use**, and required-context boundaries. The description is a
   semantic router, so vague descriptions steal unrelated prompts.
3. Route direct work to bounded tools and multi-step work to one `workflow_start`. Carry the
   exact `workflow_id`; do not start a second workflow or run `skills_search` immediately before
   startup for the same task.
4. Define concrete expected state, targeted checks, runtime/visual proof, diff boundary,
   failure behavior, and rollback.
5. Keep volatile hostnames, current PIDs, temporary branches, and credentials out of the skill.
   Put current project facts in repository docs or runtime inspection.
6. Validate with `bun run skill:check`, search for the skill semantically, and confirm it does
   not displace a more specific skill.
7. Trust is derived from root/provenance/ownership. A skill cannot declare itself trusted.
   Exact catalog ids must be used when names are ambiguous.

## 5. Project-specific function capabilities

Project function and project MCP tool names remain **data**, not dynamic additions to the MSO global catalog. Preserve the stable generic seams:

- `project_capabilities` discovers safe function schemas and project MCP server aliases;
- `project_function_call` executes one declared fixed-argv function at `exec` scope;
- `project_mcp_tools` initializes one explicitly selected project MCP and discovers its dynamic tools at `exec` scope;
- `project_mcp_call` executes one exact dynamic project MCP tool at `exec` scope.

Never expose `.mcp.json` contents/env/headers/credentials or synthesize one MSO global tool per project MCP tool.

When adding a project capability, validate the project's `.mso/functions.json`, keep execution
inside its declared working directory/argument contract, and test discovery plus refusal. Do not create one global MCP tool per project function or project MCP tool; that destabilizes cached client catalogs and tool
prefix for every client.

## 6. Limits that commonly masquerade as code bugs

- **Wrong target:** editing a `/tmp` clone, npm cache, global CLI package, or source tree that is
  not the running container/service.
- **Cached action definitions:** source and production are correct but ChatGPT/Claude/Cursor is
  still calling an old schema until tools are rescanned.
- **Truncated discovery:** `maxProjects`, `maxProjectSkills`, deadline, and entry caps produce a
  partial catalog. Continue only with the returned cursor; no cursor means stop paging.
- **Ambiguous skill names:** a bare id must be refused when several projects expose it.
- **Scope mismatch:** a tool may exist globally but be hidden/refused for the bearer tier.
- **Long-running release:** replacing `mso.service` terminates the MCP caller; release handoff
  must be polled through the owner update unit/log until final verification.
- **Optional domains:** a port-capable app must not treat DNS as an install dependency; preserve
  configured domains and retain public-IP/localhost fallback according to the app contract.
- **Session persistence:** a valid JWT without persistent cookie attributes is still a browser
  session cookie. Verify expiry, Secure behavior, host/domain scope, and browser restart.
- **Mobile viewport:** `100vh` can describe the layout viewport while the software keyboard
  changes the visual viewport. Verify real geometry, scroll ownership, safe areas, and focus.
- **Secrets:** never persist tokens, cookies, auth callback URLs, private keys, or raw secret-
  bearing command arguments in skills, recipes, logs, or progress notes.

## 7. Verification ladder

Use the lowest layer that can reject the current hypothesis, then climb:

1. Pure helper/schema test.
2. Tool list/call scope and validation test.
3. Handler/shared-host integration test.
4. Parity, docs, skill, link, and toolset-signature gates.
5. Production build from a clean/writable temporary state.
6. Runtime descriptor, health, version, state mount, and route verification.
7. Browser/mobile/action test, including close/reopen for persisted sessions.
8. External MCP client rescan and a real tool call when the public contract changed.

Compare a patched run against an unchanged control when the upstream suite has known failures.
A passing targeted suite plus an identical control/patched failure set is stronger evidence than
claiming a historically red full suite is green.

## 8. Reusable implementation note template

Copy this structure into the task's issue, progress entry, or handoff—not into a second permanent
progress log:

```text
Feature / symptom:
Expected user-visible behavior:
Observed evidence:
Canonical repository + branch/SHA:
Running owner + version/image:
Persistent state owner:
Working analogue:
Public contracts affected:
Known limits and optional dependencies:
Facts / inferences / unknowns:
Smallest discriminating experiment:
Chosen authoritative change:
Rollback:
Targeted checks:
Build/contract checks:
Runtime/browser proof:
External client refresh required:
Durable docs/skill updated:
```

## 9. Definition of done

An MCP feature is complete only when:

- the canonical source and running target are identified;
- the public schema, scope, audit, limits, parity and external-name contracts agree;
- targeted tests, docs/skill gates and the required build pass;
- state and rollback are preserved;
- the exact live behavior is verified;
- affected external clients have refreshed their cached actions;
- the reusable pattern is captured without storing secrets or volatile host facts.
