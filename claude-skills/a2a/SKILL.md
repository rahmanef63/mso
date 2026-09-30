---
name: a2a
description: "Keep work from external AI CLI sessions inside one durable MSO workflow using safe progress and evidence summaries."
metadata:
  mso:
    risk: medium
    policy: trace-resume-verify
---

# /a2a — provider-neutral MSO workflow trace

Use this skill when work performed by Codex CLI, Claude/Cloud CLI, Antigravity, or another Agent Skills-capable runtime must remain visible and resumable in MSO by another agent.

## Trigger and boundaries

- **Use when:** a multi-step external-agent task should share one durable MSO session/workflow, progress trace, evidence trail, or handoff context.
- **Do not use when:** the task is a trivial single call, or the user only wants standard remote A2A peer delegation; use the normal `a2a_*` tools for that protocol.
- **Required context:** task intent, project when known, a short agent/provider label, and authenticated access to the same MSO owner/device identity through MCP or the `mso` CLI.

This skill records **observable progress, not private reasoning**. Never send chain-of-thought, hidden reasoning, system/developer prompts, complete private transcripts, credentials, cookies, tokens, or secret-bearing commands.

## Fast route

### Native MSO/MCP

1. Call `workflow_start` once with the complete intent/project/constraints.
2. Keep its exact `workflow_id` on every later MSO call.
3. If source isolation is returned, do all source-changing work in that exact workspace.
4. At meaningful milestones, call `agent_session_note` with a concise safe note and the same `workflow_id`.
5. Use `agent_session_flow` when another agent needs the semantic context.
6. Finish with `workflow_finish` only after independent verification; otherwise use `workflow_cancel`.

### CLI fallback

When the AI can run shell commands but does not have direct MSO MCP tools, run the bundled `scripts/a2a.mjs` from this skill directory. It forwards to the installed MSO CLI:

```bash
node scripts/a2a.mjs start --intent "Implement the requested change" --project my-project --agent codex
node scripts/a2a.mjs progress --run <run-id> --stage implement --message "Updated the bounded feature surface."
node scripts/a2a.mjs evidence --run <run-id> --stage verify --message "Targeted tests passed."
node scripts/a2a.mjs context --run <run-id>
node scripts/a2a.mjs finish --run <run-id> --summary "Implemented and verified." --evidence @evidence.json
```

The bridge returns `run_id`, `session_id`, `workflow_id`, and any task workspace. Keep those identifiers as operational metadata, not user secrets.

## Event policy

Allowed milestone kinds are:

- `plan` — bounded approach or next phase.
- `progress` — meaningful state change.
- `action` — observable operation completed.
- `evidence` — test/build/health/artifact result.
- `blocker` — concrete blocker and what is needed.
- `result` — intermediate or terminal outcome.
- `handoff` — concise continuation packet for the next agent.

Prefer one update when a phase/result changes. For long external operations, a concise update every tens of seconds is enough; do not stream every token, thought, or command. Exact duplicate events are intentionally deduplicated by the CLI bridge.

## Handoff and resume

On handoff, include:

- current goal and completed outcome;
- changed surface or artifact references;
- verification already run;
- remaining blocker/next action;
- the existing `run_id` plus MSO session/workflow identifiers when the next agent uses the same authenticated MSO identity.

On the same host/device, the next agent can continue with `context --run <run-id>`. A local bridge can also `attach --session <id> --workflow <id> --run <new-run>` when it owns that MSO session. Do not bypass MSO's device/principal isolation to attach a session owned by another identity.

## Tool routing

| Need | Preferred capability |
|---|---|
| Start durable work | `workflow_start` |
| Stream safe milestone | `agent_session_note` + exact workflow id |
| Read cross-agent context | `agent_session_flow` |
| Check live workflow | `workflow_status` or CLI `status` |
| Close verified work | `workflow_finish` |
| Abandon safely | `workflow_cancel` |
| Remote A2A peer delegation | standard `a2a_*` tools, not this trace bridge |

## Verification contract

- **Expected state:** one durable MSO session and one exact workflow represent the external task; milestone notes are visible in the semantic session flow.
- **Targeted checks:** CLI/MCP correlation uses the same workflow id; state files are owner-private; duplicate progress is bounded; hidden reasoning is never an accepted event type.
- **Runtime proof:** `status` returns the active workflow and `context` returns the accumulated safe semantic flow.
- **Visual proof:** not required unless the underlying task changes UI.
- **Diff boundary:** this bridge may record summaries and evidence only; it never grants new project permissions or substitutes self-reported progress for verification.

A successful `finish` still uses MSO's Evidence Receipt rules. High-risk work requires explicit verification evidence; a progress note alone is not proof.

## Failure and rollback

If MSO is unreachable or identity/session ownership does not match, stop claiming the task is synchronized. Preserve local work, report the trace as unsynced, and reconnect explicitly. Never fabricate a workflow id, force ownership, or copy private MSO stores between devices.

Cancel only the exact workflow created or attached by this run. Local trace state under `~/.mso/private/a2a-traces` contains correlation metadata only and must remain owner-only.

## Recipe memory

Store only redacted, replayable workflow receipts. Treat bridge events as context, not truth. Durable learning should come from a verified `workflow_finish`, concrete evidence, and sanitized tool receipts.
