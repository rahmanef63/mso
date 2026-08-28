---
name: mso-mcp-feature-engineering
description: "Implement or repair MSO MCP tools, trusted skills, project function capabilities, scopes, audits, and client refresh behavior by reverse-engineering the live path, changing one reversible layer at a time, and proving parity plus runtime behavior."
metadata:
  mso:
    risk: medium
    policy: observe-map-bound-reverse-engineer-verify
---

# /mso-mcp-feature-engineering — MCP Feature Engineering

Use this skill for a durable MSO MCP implementation or repair. The detailed checklist lives in
[`docs/MCP-FEATURE-IMPLEMENTATION.md`](../../docs/MCP-FEATURE-IMPLEMENTATION.md).

## Trigger and boundaries

- **Use when:** adding, removing, renaming, debugging, or extending an MCP tool; changing
  OAuth/scope/audit/toolset behavior; adding trusted skill discovery/routing; or adding an
  opt-in project function capability.
- **Do not use when:** answering a one-off MCP question, performing one direct bounded read, or
  changing an unrelated product feature that does not alter MCP/skill contracts.
- **Required context:** canonical repository and branch, running service/container and version,
  current toolset descriptor, affected state owner, working analogue, and exact user-visible
  failure or desired contract.

## Non-negotiable pattern

1. **Resolve the target.** Distinguish source checkout, generated bundle, installed package,
   running service/container, state volume, reverse proxy and external client snapshot. Never
   edit a temporary audit clone or first search match.
2. **Observe.** Reproduce and preserve the first concrete error or behavioral evidence.
3. **Map.** Trace client/descriptor → route → schema → dispatcher → shared host guard/state →
   response → UI/client. For skills, trace root → trust → id → search/read → model context.
4. **Bound.** List scope, trust, audit, limits, cursors, client cache, cross-repo names, process
   lifetime, persistence, domain/port and release constraints. Separate fact/inference/unknown.
5. **Reverse-engineer.** Find the nearest working sibling and reuse its authoritative seam.
6. **Experiment.** Run the smallest test that can reject one hypothesis; do not stack guesses or
   retry unchanged inputs.
7. **Change.** Make one reversible mutation in the authoritative layer and preserve state.
8. **Prove.** Verify targeted contract, build, runtime and external-client behavior before
   finishing.

## Tool contract

For a public MCP tool, inspect and update all affected surfaces:

- stable public name and input schema;
- scope tier plus list-time and call-time enforcement;
- thin delegation to `lib/host` or another existing guarded capability;
- audit action/target for mutation or exec;
- rate, size, timeout, path, pagination and continuation limits;
- Alfa/MCP parity or an explicit documented MCP-only reason;
- toolset version/hash/count and public descriptor;
- connectors-gateway literals and other external action mappings;
- current docs, progress rationale and client-rescan instructions.

Never create a parallel raw `fs`/`child_process` path inside a tool. Never rename a public tool
without checking the external mapping contract.

## Skill contract

For a trusted workflow skill:

- generate with `bun run skill:new` and keep it under 200 lines;
- make use/do-not-use triggers and required context precise enough for semantic routing;
- prefer bounded direct tools; use one `workflow_start` for multi-step work and carry its exact
  `workflow_id` on every operational call;
- define expected state, targeted checks, runtime/visual proof, diff boundary and rollback;
- keep volatile project facts and every secret out of the skill;
- validate with `bun run skill:check` and confirm `skills_search` routes intended prompts;
- remember that trust is derived from root/provenance/ownership, never frontmatter.

## Project function contract

Keep project function names as data behind the stable `project_capabilities` and
`project_function_call` pair. Validate `.mso/functions.json`, declared arguments, working
directory, scope and refusal behavior. Do not add one global MCP tool per project function.

## Fast route

- One direct operation: use the exact bounded tool and verify it.
- Multi-step task: call `workflow_start` once with complete intent/project/constraints; do not
  call `skills_search` first for the same task.
- Repository search, Git, tests, build, or three or more related reads: use one narrow
  `exec_run` batch when exec scope is available.
- Long-running MSO release: use the repository handoff path and poll its owner unit/log; replacing
  `mso.service` terminates the MCP request that initiated it.

## Verification contract

- **Expected state:** source, descriptor, scope, audit, skill/tool routing and live behavior agree.
- **Targeted checks:** schema/helper tests; list/call scope tests; audit/limit tests; skill check;
  parity and external mapping checks.
- **Runtime proof:** live `GET /mcp` toolset signature, service health/version, state ownership,
  and a real call through the changed path.
- **Visual proof:** required for UI/mobile/auth changes; test actual scroll/viewport/session close
  and reopen rather than inferring from CSS or cookie source.
- **Diff boundary:** MCP/skill/doc surfaces required by the contract only; no provider, runtime,
  domain or unrelated refactor changes without separate justification.

## Failure and rollback

- Preserve the first error before retrying.
- Stop on ambiguous project/runtime identity, missing scope, or truncated discovery without a
  continuation cursor.
- Roll back the smallest changed layer while preserving state and configured domains.
- Never force-push, delete user data, expose credentials, or claim live success from source/build
  evidence alone.

## Recipe memory

Save only redacted, replayable steps and the pattern that worked. Do not store file bodies,
tokens, cookies, private URLs, auth callbacks, secrets, or volatile PIDs. A failed attempt is
evidence, not the replacement for a verified recipe.
