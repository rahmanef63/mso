# MSO Agent: coding capability plan

Written before implementation. Audited against what MSO already has, not against wishes.

## Audit: what already exists

113 MCP tools are registered. For "agent that can code", most of the substrate is present:

| Capability | MSO today | Verdict |
|---|---|---|
| Read file | `fs_read`, `read_pipeline` (bounded) | exists |
| Write whole file | `fs_write` | exists |
| List dir | `fs_list`, `fs_stat` | exists |
| Shell command | `exec_run` (30s), `exec_job_start`/`status`/`cancel` (bounded async) | exists |
| Subagent | `agent_subagent_run` (foreground, isolated context, server-capped turns) | exists |
| Session/handoff | `agent_session_*`, `local_agent_*`, A2A v1 | exists |
| Skills | `skills_list/read/search` | exists |
| Project awareness | `projects_list`, `project_*` | exists |
| PTY | `mso term open/input/resize/stream/close` (CLI only, not an agent tool) | partial |

## The real gaps, ranked by how much they block coding

### GAP-1 (blocker): no surgical edit tool

There is no `oldString`/`newString` edit. An agent must rewrite a whole file with `fs_write`
to change one line. That is the single biggest difference from Claude Code and opencode,
and it is also the most dangerous: a full rewrite loses everything the agent did not
re-read, and a large file may exceed the bounded write.

### GAP-2 (blocker): search cannot see file contents

`searchFs` returns directories whose NAME matches. There is no content search, no glob, no
"where is this symbol defined". An agent working in a 200k-LOC repo is blind.

### GAP-3 (high): no background/parallel subagents

`agent_subagent_run` is foreground only. Claude Code runs subagents in parallel and the
parent keeps working. MSO blocks on one worker.

### GAP-4 (high): no todo/plan checklist

Nothing tracks multi-step work as a visible list. Long tasks drift.

### GAP-5 (medium): no shell-out PTY or interactive command for the agent

`exec_run` is one-shot, 30s, no interactivity. Long builds need `exec_job_start` (exists) but
an interactive process cannot be driven.

### GAP-6 (medium): the TUI cannot show a diff before writing

`/diff` renders the server's historical artifact diff. There is no preview of a pending edit.

**Closed.** `fs_edit` now returns the diff it applied and accepts `dry_run: true`, and the TUI
renders that diff under the `fs_edit` row. See `docs/AGENT-EDIT-PREVIEW.md`.

## What I will build, in this order

| # | Item | Seam it uses | Why this order |
|---|---|---|---|
| 1 | `fs_edit` tool: exact `oldString` → `newString`, unique-match required, `expected_sha256` to refuse stale writes | existing `fs_write` plumbing + `fs_stat` hash | unblocks all real editing |
| 2 | `fs_grep` tool: content regex over a bounded tree, returns path:line, respects read roots and size caps | new leaf beside `fs_search` | unblocks navigation |
| 3 | `fs_glob` tool: path glob (`**/*.ts`) bounded by root | same leaf | cheap once grep exists |
| 4 | `todo_write` tool: session-scoped checklist the TUI renders | session store | keeps long tasks honest |
| 5 | Background subagent: `agent_subagent_start` + `agent_subagent_status` | existing subagent runner + `exec_job_*` lifecycle pattern | enables parallelism |
| 6 | TUI: render the `fs_edit` diff, and `dry_run` on `fs_edit` itself | returned tool result, no extra round trip | visibility |
| 7 | TUI: render the `todo_write` list | session state on the status row | not started |

## Non-negotiable constraints

- Every new tool is bounded: max bytes, max matches, max depth, abort signal.
- Every write tool keeps the read-root/write-root guard and the credential denylist.
- No tool may read `~/.mso`, `~/.ssh`, or any store path.
- New tools go through the same audit trail as `fs_write`.
- Ratchets hold. No file over the limits; split instead.
- `fs_edit` refuses when the match is not unique, and refuses when `expected_sha256` does
  not match. A silent wrong edit is worse than a failed one.

## Explicitly not in scope

- A new TUI renderer. That is the separate Phase 2 item in `docs/TUI-PARITY-PLAN.md`.
- Auto-commit, auto-push, or any git mutation. The agent may propose; the owner ships.
- Porting opencode's exact UI. The goal is capability parity for coding, not visual cloning.
