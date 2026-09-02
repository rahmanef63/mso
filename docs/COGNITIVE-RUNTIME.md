# MSO Cognitive Runtime

MSO treats the LLM as a replaceable reasoning engine. The durable product advantage lives in the
**provider-neutral harness** around it: conversation identity, context budgeting, memory, tool discovery,
permissions, verification, learned workflows, and reproducible evaluation.

This document is the current contract for the MCP-first Cognitive Runtime through P1. Provider-specific features may be
used when available, but correctness must not depend on OpenAI-, Anthropic-, Google-, Qwen-, GLM-,
DeepSeek-, or other vendor-specific hidden state.

## Invariants

1. **Authentication is not conversation state.** OAuth/client identity owns durable user state and learned
   recipes; one ChatGPT conversation owns one active MSO session/workflow namespace.
2. **Transport is not application state.** `Mcp-Session-Id` is compatibility transport state. When ChatGPT
   supplies `_meta["openai/session"]`, MSO hashes it with the stable client principal and never persists the
   raw opaque conversation id.
3. **Capabilities never bypass scopes.** Routing, programmatic selection, learned recipes, Skills, and
   project functions may reduce what is shown to a model; they never elevate `read → write → exec`.
4. **Context is a budget, not a transcript dump.** Large history/tool output must be projected, compacted,
   or retrieved just in time. A bigger context window is headroom, not a reason to fill it.
5. **Experience is reusable only after proof.** `workflow_finish(success=true)` follows independent
   verification. The learned recipe is redacted, client-scoped, and does not grant access to another
   conversation's active workflow.
6. **Optimization is benchmark-gated.** A smaller prompt is not a win if tool recall or task success drops.

## Identity and workflow hierarchy

```text
OAuth / MCP client principal
│
├─ conversation A → durable MSO session A → workflow A1 / jobs A1
├─ conversation B → durable MSO session B → workflow B1 / jobs B1
└─ learned verified recipes shared at the client-principal boundary
```

The audit actor remains token-specific for forensics. Active workflows and asynchronous job handles use a
session owner derived from `principal + durable session id`; recipes use the stable principal. Therefore a
second conversation can learn from a successful route without being able to status/finish/cancel the first
conversation's live run.

Conversation correlation is indexed durably under the private agent-session root. MSO backfills legacy P0
conversation hashes once at Node startup, then resolves normal MCP calls through an O(1) owner+conversation
reference. Creation is locked per conversation and record mutation is locked per durable session; unrelated
chats no longer queue behind one global session-store lock. The index stores only the already-hashed
conversation key and internal MSO session id, never the raw ChatGPT conversation id.

## Context lifecycle

MSO keeps **durable session context** separate from the **model-active context** sent on one turn.

- Durable session estimate defaults to a **700,000 token** compaction threshold.
- Before compaction, MSO writes a recursively redacted gzip archive with owner-only permissions.
- Compaction retains a structured summary plus approximately **140,000 recent tokens** by default.
- Archive retention defaults to **30 days** and is enforced after archival and at MSO boot.
- CLI continuation is copy-on-resume across surfaces, so ChatGPT/MCP and a terminal do not mutate one
  session file concurrently.
- The model receives recent history up to roughly 55% of its advertised context window, capped at 120k
  history tokens, leaving headroom for system policy, memory, selected Skills/tools, reasoning, and output.
- Assistant tool-use + matching tool-result rows are projected as one group so context trimming cannot
  leave an invalid orphaned tool turn.

Environment overrides are documented in `.env.example`:
`OS_AGENT_SESSION_COMPACT_TOKENS`, `OS_AGENT_SESSION_RECENT_TOKENS`,
`OS_AGENT_SESSION_ARCHIVE_DIR`, and `OS_AGENT_SESSION_ARCHIVE_DAYS`.

## Deferred capability selection

The external MCP server keeps a stable, complete scope-filtered catalog for standards interoperability.
MSO's own terminal model harness uses a provider-neutral **per-turn capability router** instead of sending
all schemas on every call.

The router always retains a small control/discovery core (workflow lifecycle, `skills_search`, project and
session discovery), scores the current request plus recent evidence, preserves recently used tools, and
adds required companions such as `exec_job_status`/`exec_job_cancel` when a long job is selected.
The normal target is at most 14 selected schemas before mandatory companions.

If a missing capability is needed, `skills_search` searches the unified catalog of tools, Skills, and
learned recipes. A tool named by discovery/tool output becomes eligible on the next round. The full local
catalog still performs invocation validation, so hiding a schema from one turn neither deletes the tool nor
changes its permission.

## Tool-result budget

Generic MCP text fallbacks are bounded before they enter model context:

- default: **32 KiB**;
- `exec_run`: 48 KiB;
- file/job outputs that legitimately need more headroom: 64 KiB;
- hard policy ceiling: 128 KiB.

Oversized results return a parseable `msoTruncated` envelope containing original byte count, bounded
preview, and a narrowing hint. Explicit MCP Apps structured projections remain separate. The correct
recovery is a narrower read/search/grep/tail, not silently increasing the context flood.

## Memory planes in P1

P1 keeps the two proven planes but upgrades stable agent memory from untyped Markdown into a structured, backward-compatible ledger:

- **Agent memory ledger** — private `records-v1.json` claims keyed by client principal, with semantic/episodic/procedural kind, confidence, sensitivity, temporal validity, provenance authority/channel, supersession/retraction and conflict evidence.
- **Markdown compatibility projection** — `USER.md` / `MEMORY.md` remain the resolved materialized view consumed by older CLI/session code. Existing installations are read unchanged; the first structured mutation seeds the ledger from legacy `## key` sections instead of deleting or rewriting history.
- **Experience memory** — verified workflow trajectories remain client-scoped and now accumulate P1 quality telemetry: completed/failed/denied/rate-limited/invalid-argument steps, retries, rollback/restore evidence and timed-step latency.

Resolution is deterministic at a requested timestamp: only effective claims participate, then authority (`explicit > observed > inferred > migration`), confidence, observation recency, creation recency and stable id break ties. `mode=replace` supersedes the currently resolved claim from its `valid_from`; `mode=claim` keeps parallel evidence so disagreement remains inspectable. A future replacement therefore does **not** erase the fact that is still valid today.

`agent_memory_search` is the model-facing typed retrieval surface. Normal reads return resolved claims plus conflict evidence; `include_history=true` is explicit because superseded/retracted material should not silently bloat context. MCP provenance stores only a short SHA-256 digest of the internal durable session id—not the raw OpenAI conversation id or bearer identity. New sessions still freeze the resolved Markdown snapshot, so memory cannot mutate underneath an active session.

## Benchmark contract

Run:

```bash
bun run bench:cognitive          # routing/schema + typed-memory gates
bun run bench:memory             # deterministic retrieval/temporal/conflict suite
bun run bench:quality -- --live  # learned workflow success + P1 telemetry coverage
bun run bench:agents -- --model gpt-5.6-terra        # dry-run cross-agent plan
bun run bench:agents -- --model gpt-5.6-terra --run # scratch-only external smoke
```

The core benchmark is deterministic and provider-neutral. Its checked scenarios cover application logs,
server health, safe file editing, long/short execution, project functions, Cloudflare/Hostinger/Dokploy,
browser/screenshots, memory, session resume, and Skills.

Release gates require:

- **100% required-tool recall** on the checked scenarios;
- **100% typed-memory retrieval, temporal-resolution and conflict-resolution accuracy** on the deterministic fixture suite;
- deterministic selection for identical input;
- lower active schema bytes than the full MSO catalog;
- when Hermes' installed CLI exposes `hermes prompt-size`, lower active tool-schema bytes than that exact
  comparable metric.

The benchmark reports OpenClaw's installed version but **does not declare an OpenClaw win** from schema
footprint because the installed OpenClaw CLI currently exposes no directly equivalent offline prompt-size
probe. Overall product superiority also cannot be inferred from a prompt-size result. Future comparison
must add equivalent task-success, tool-error, token-per-success, latency-per-success, and policy-compliance
scenarios before making that claim.

## Current P1 + A2A baseline

On the development host after P1 implementation:

| Metric | MSO P1 | Hermes local baseline |
|---|---:|---:|
| Full MSO transport catalog | 56 tools | — |
| Full MSO schema bytes | 37,904 | — |
| Average MSO active tools / turn | 15.5 | — |
| Average active schema bytes / turn | 11,582 | 44,758 tool-schema bytes |
| MSO schema reduction vs full catalog | 69.4% | — |
| Required-tool routing recall | 100% | not the same benchmark |
| Typed-memory fixture accuracy | 100% (8/8) | not implemented in this harness |
| Deterministic routing / memory resolution | yes / yes | not the same benchmark |

The existing learned-recipe store currently reports **179 successful / 186 total workflows (96.2%)**, but those recipes predate the P1 quality schema, so step-level telemetry coverage correctly starts at **0%** rather than fabricating historical tool-error/retry data. New or re-learned recipes carry `qualityVersion: 1`; coverage grows naturally from real post-P1 executions.

A non-interactive full MSO tool loop is now available as `mso agent --oneshot <prompt> --json`. It defaults to read-only autonomous approval; write/exec require explicit `--approve-scope write|exec`. The cross-agent harness uses a private scratch read task whose nonce and values exist only in a file. A first smoke proved MSO on `openai-codex/gpt-5.6-terra`; Hermes failed because its local configuration does not expose an `openai` provider and OpenClaw rejected that model override for agent `main`, so the harness correctly returned **`comparable=false`**. That is connectivity/configuration evidence, not a ranking.

These numbers are reproducible harness baselines, not an overall quality leaderboard. Cross-agent ranking is permitted only when at least two runners complete the same task with matching model-family evidence; one-task latency order is explicitly not an overall-agent claim.

## P1 status and next direction

P1 now implements the first three planned runtime layers: typed/provenance-aware temporal memory, deterministic retrieval evaluation, and workflow/tool quality telemetry. It also adds the non-interactive MSO Agent runner and a fail-closed cross-agent scratch harness.

The next phase should build on those measured primitives rather than add opaque autonomy:

1. **Eval-gated Tool Forge** — repeated verified workflows may propose project functions/Skills, but generated code stays untrusted until static checks, sandboxed fixture tests, scope review and explicit promotion pass.
2. **Programmatic read-only orchestration** — bulk filtering/aggregation may reduce model round-trips while remaining constrained by caller scope and normal host guards.
3. **Benchmark corpus expansion** — add multiple read/write/recovery/security task classes and configure Hermes/OpenClaw with an actually equivalent model/provider path before any overall comparison.
4. **Memory calibration** — grow post-P1 quality telemetry and test confidence/authority policy against real corrections before introducing graph-memory complexity.
5. **Cost-per-success accounting** — normalize provider usage reports only where token/cost semantics are comparable; missing usage must remain unknown, never zero.

## Security notes

- Session archives are private backups, not secret vaults; recursive redaction happens before compression.
- Persistent memory is data, never an instruction or permission source.
- A discovered Skill or recipe cannot grant a tool the caller's token does not already permit.
- Untrusted Skills keep their instructions withheld until promoted through the existing trust process.
- `exec_run` remains full service-user shell power at `exec` scope; cognitive routing is not a sandbox.
- Never expose raw ChatGPT conversation ids, tokens, credentials, hidden chain-of-thought, or unrestricted
  tool output in memory/recipes/archives.
