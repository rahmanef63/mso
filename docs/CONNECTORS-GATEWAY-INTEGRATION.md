# mso → Connectors Gateway

**Status:** mso is a registered connector in `rahmanef63/connectors-gateway` as of 2026-08-17. MSO is the provider; the gateway is one consumer alongside ChatGPT, Claude.ai and Cursor. Every client reaches `https://mso.rahmanef.com/mcp` through the same OAuth and scope rules documented in [`MCP.md`](./MCP.md).

## Cross-repo contract

MSO currently exposes **28 tool names** (server `1.6.0`, toolset `2026.08.21.1`). The gateway manifest still maps **15** of them through literal `x-upstream` strings:

```json
{ "id": "mso.fs.delete", "x-upstream": "fs_delete" }
```

Renaming or removing a tool here breaks that action at runtime even when both repositories typecheck. Adding a tool here does not make it appear in the gateway until its manifest is deliberately updated.

The runtime contract is no longer invisible:

- unauthenticated `GET /mcp` returns the current toolset version, hash, count and names;
- MCP `initialize` and `tools/list` return `_meta.toolset` for the token's visible scope;
- Settings → MCP shows the same signature and lets the operator mark the ChatGPT action snapshot as refreshed;
- the signature hashes names, descriptions, schemas, scope, annotations and limits, so a schema-only change is visible too.

A consumer CI should compare the upstream names it pins against this runtime manifest. Source parsing remains useful for review, but it is no longer the only way to detect drift.

## What the gateway exposes

**Removed 2026-08-20 — a gateway that pinned either name must drop it:** `image_generation_status` and `image_generate`. MSO no longer generates images on any surface (a GPT client already carries its own; a second tool for the same job made the model choose wrong). Neither name was in the gateway's 15, so nothing breaks there today. `fs_upload_file` is unchanged and remains how a conversation-generated file reaches the VPS.

The gateway has not yet synchronized the tools added or deliberately withheld from its 15-action manifest:

| Not mapped in gateway | Reason/status |
|---|---|
| `exec_run` | deliberately omitted: arbitrary owner-level shell |
| `browser_power` | deliberately omitted: controls a browser profile holding live sessions |
| `skills_search` | added to MSO after the original gateway manifest |
| `screen_capture` | added later; secure MSO-only visual artifact, requires a product decision in the gateway |
| `workflow_start` | added later; starts the actor-scoped task lease |
| `workflow_cancel` | added later; exact-id recovery for an interrupted run |
| `workflow_finish` | added later; exact-id verified recipe boundary |
| `fs_upload_file` | added later; ChatGPT `openai/fileParams` binding the gateway does not model |
| `projects_list` | added 2026-08-20; enumerates every configured project container |
| `project_capabilities` | added 2026-08-21; detects opt-in project MCP/function manifests without exposing secrets |
| `project_function_call` | added 2026-08-21; exec-scope generic runner for functions declared by a project |
| `skills_list` | added 2026-08-20; global + per-project skill catalog with trust |
| `skills_read` | added 2026-08-20; exact-catalog-id SKILL.md read, trusted tiers only |

`fs_delete` and `apps_power` remain the gateway's highest-risk mapped actions and should keep its human approval policy. The gateway's policy layer supplements, never replaces, MSO's scope checks, path jail, audit trail and per-operation rate limits.

## Change procedure

Before changing the MCP catalog:

1. Read `lib/mcp/tools.ts`, `tools-read.ts`, `tools-learning.ts` and `toolset.ts`.
2. Do not rename a public tool unless migration is intentional.
3. Run MSO parity, dispatch and toolset tests.
4. Compare the new `GET /mcp` signature and names with the gateway manifest.
5. Update the gateway mapping or explicitly document why a capability stays absent.
6. Refresh affected custom-app action snapshots after deployment.

The Alfa ↔ MCP axis is guarded by `lib/mcp/parity.test.ts`; this document and the runtime toolset signature cover the cross-repo axis until the gateway adds an automated parity check.

## Scope ceiling

The running MSO instance currently allows tokens up to:

```text
OS_MCP_MAX_SCOPE=exec
```

The gateway's mapped actions do not require `exec`, so narrowing the gateway token to `write` costs it nothing. The server-wide ceiling remains an owner decision because it also governs separately minted ChatGPT, Claude or Cursor tokens.

## Operator checks

```bash
curl -s https://mso.rahmanef.com/mcp | jq '.toolset'
mso mcp list
mso mcp activity 100
mso audit 50 mcp.
```

The gateway strategy and its user-facing OAuth are maintained in the gateway repository. This file owns only the provider-side contract and drift procedure.
