---
name: mso-agent-fleet
description: Drive Orca worktrees and OpenCode sessions through MSO tool calls, fan out bounded subagents per session, supervise progress, and expose the whole loop to HTTPS webhook triggers.
metadata:
  mso:
    risk: medium
    policy: orchestrate-supervise-verify
---

# /mso-agent-fleet — Orca + OpenCode fleet from MSO tool calls

MSO stays the control plane. Orca is the visible surface (worktrees, terminals, board).
OpenCode is a worker CLI. Neither gets new trust: every step is an existing bounded tool.

## Trigger and boundaries

- **Use when:** one request must become several parallel coding sessions, must stay visible on a board, or must be startable from an HTTPS call instead of a chat.
- **Do not use when:** one bounded edit answers the request, or the task needs no second agent. Do not build a fleet for a single file change.
- **Required context:** repo/project identity, how many workers, target host (`local` or `ssh:...`), and whether a human must approve each worker.

## Two control surfaces

| Need | Use | Why |
|---|---|---|
| Visible worktree/terminal/board | `orca_*` MCP tools from `bin/orca-mcp.mjs` | thin argv onto `orca <cmd> --json`, no shell |
| Isolated reasoning worker, no UI | `agent_subagent_run` | isolated context, foreground, non-recursive |
| OpenCode session as a process | `exec_run` / `exec_job_start` around `opencode run` | bounded, jailed, cancellable |
| Server-side automation + webhook | Workflow Graph `webhook` → `tool`/`agent` nodes | token auth, receipts, idempotency |

`orca` is `orca-ide` on this laptop (WSL launcher → PowerShell bridge). Never call bare `orca`.

## Fast route

1. `orca_status` — stop if `runtime.state` is not `not_running`/ready. Every orca call fails otherwise.
2. `orca_host_list` — learn the exact host label. Handles belong to the host that issued them; never move a handle across hosts.
3. `orca_worktree_list` → `orca_worktree_create` — one worktree per workstream. `agent`/`prompt` launch a worker immediately; omit both to only create the checkout.
4. Fan out with `agent_subagent_run` when workers need isolation but no UI; use `orca_agent_launch` or `orca_terminal_create` when a human must watch.
5. Supervise with `orca_worktree_ps` (cheapest board read), then `orca_terminal_wait` instead of polling `orca_terminal_read`.
6. Finish: `orca_terminal_close`, then one summary. Never leave orphan terminals behind.

## Fan-out patterns

**Board-visible fan-out**

```text
orca_worktree_create  name:<stream> repo:name:<repo> agent:opencode prompt:<task>
orca_agent_launch     agent:opencode worktree:name:<stream> prompt:<follow-up>
orca_worktree_ps      limit:50
```

**Invisible reasoning fan-out** — one `agent_subagent_run` per workstream, `max_scope` no higher than the caller holds, `max_turns` ≤ 12 for a review pass. Subagents cannot spawn subagents and cannot touch session/memory/A2A tools.

**OpenCode as a worker** — `exec_job_start` with `opencode run --format json -m <provider/model> "<task>"`, then `exec_job_status`. Use `exec_run` only when the task fits the 30s budget. Add `--session <id>` to continue, `--fork` to branch an existing session.

## Webhook trigger

```text
graph: webhook(POST, authVariable=secret var ≥16 chars)
   → project  (resolve canonical path at runtime)
   → tool     (exec_job_start: opencode run … or orca agent launch …)
   → wait     (bounded)
   → tool     (exec_job_status / orca_worktree_ps)
   → output
```

Endpoint `/api/v1/workflows/webhook/<graphId>/<nodeId>`, bearer from a private secret variable. `responseMode=onReceived` returns a run id immediately — correct for fleets. `lastNode` waits under a bounded budget; do not use it for long agent work. Send `idempotency-key` so a retried webhook does not create a second fleet.

## Tool routing

| Need | Preferred | Avoid |
|---|---|---|
| Board state | `orca_worktree_ps` | listing every terminal |
| Wait for a worker | `orca_terminal_wait` (`for:"tui-idle"`) | fixed `sleep` loops |
| Isolated research | `agent_subagent_run` | spawning a whole worktree |
| Long process | `exec_job_start` + `exec_job_status` | `exec_run` near 30s |
| Repeatable trigger | Workflow Graph webhook | hand-rolled HTTP server |
| Human approval gate | Orca terminal + board comment | silent `--auto` agents |

## Execution flow

1. **Preflight** — `orca_status`, confirm host, confirm repo identity. Refuse to guess a repo.
2. **Shape** — pick worker count from real independent workstreams, not from a round number.
3. **Launch** — create worktrees first, then launch, then record the mapping `stream → worktree → handle`.
4. **Supervise** — wait on idle/exit; read bounded output only when a wait returns a change.
5. **Verify** — the worker's claim is not evidence. Run the narrow test or read the diff yourself.
6. **Converge** — close terminals, set board status via `orca_worktree_set`, report per-stream outcome.
7. **Persist** — only when the loop must repeat: encode it as a Workflow Graph, activate it, and store the bearer in a secret variable.

## Verification contract

- **Expected state:** each requested stream has one worktree, one known terminal/agent, and one recorded outcome.
- **Targeted checks:** diff or test output per stream; `orca_worktree_ps` shows no stuck agent.
- **Runtime proof:** `exec_job_status` reaches `succeeded`/`failed`, or `orca_status` stays ready with zero leaked terminals.
- **Webhook proof:** one authenticated `POST` returns a `runId`, and the run receipt shows the expected nodes.
- **Diff boundary:** worker edits stay inside their own worktree; the MSO checkout is never a worktree target.

## Failure and rollback

- Orca `not_running` → `orca open`, then re-check `orca_status`. Do not retry the failed call blindly.
- Wrong-host handle → the handle belongs to another runtime; re-list on the correct host instead of forcing it.
- Runaway fleet → `orca_terminal_close` per worktree, `exec_job_cancel` per job, keep the worktrees for inspection.
- Webhook unauthenticated → an active webhook without a secret variable fails closed by design; fix configuration, never disable the check.
- Never force-push, delete a worktree with uncommitted work, or point a worker at the live MSO checkout.

## Recipe memory

Save the mapping and the exact argv shapes, never prompts containing secrets, tokens, pairing codes, or terminal contents. A successful fan-out recipe is only reusable when the host label, repo identity and node list are all still observed live.
