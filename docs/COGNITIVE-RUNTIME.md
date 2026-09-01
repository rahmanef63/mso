# MSO Cognitive Runtime

MSO treats the LLM as a replaceable reasoning engine. The durable product advantage lives in the
**provider-neutral harness** around it: conversation identity, context budgeting, memory, tool discovery,
permissions, verification, learned workflows, and reproducible evaluation.

This document is the current contract for the MCP-first P0 runtime. Provider-specific features may be
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

## Memory planes in P0

P0 intentionally keeps two proven memory layers rather than inventing one universal store:

- **Agent memory** (`USER.md` / `MEMORY.md`) — stable client-principal facts, frozen into each new session.
- **Experience memory** — successful/failed workflow trajectories, redacted replayable step shape,
  semantic embedding, success rate, fastest/average duration, and last-use evidence.

The next memory revision may introduce typed semantic/episodic/procedural records with provenance,
confidence, temporal validity, supersession, and conflict resolution. That is P1/P2 work and must beat the
P0 retrieval/evaluation baseline before becoming the default.

## Benchmark contract

Run:

```bash
bun run bench:cognitive
bun scripts/bench-cognitive-runtime.mjs --json
```

The P0 benchmark is deterministic and provider-neutral. Its checked scenarios cover application logs,
server health, safe file editing, long/short execution, project functions, Cloudflare/Hostinger/Dokploy,
browser/screenshots, memory, session resume, and Skills.

Release gates require:

- **100% required-tool recall** on the checked scenarios;
- deterministic selection for identical input;
- lower active schema bytes than the full MSO catalog;
- when Hermes' installed CLI exposes `hermes prompt-size`, lower active tool-schema bytes than that exact
  comparable metric.

The benchmark reports OpenClaw's installed version but **does not declare an OpenClaw win** from schema
footprint because the installed OpenClaw CLI currently exposes no directly equivalent offline prompt-size
probe. Overall product superiority also cannot be inferred from a prompt-size result. Future comparison
must add equivalent task-success, tool-error, token-per-success, latency-per-success, and policy-compliance
scenarios before making that claim.

## Current P0 baseline

On the development host at implementation time:

| Metric | MSO P0 | Hermes local baseline |
|---|---:|---:|
| Full MSO transport catalog | 47 tools | — |
| Full MSO schema bytes | 31,212 | — |
| Average MSO active tools / turn | 14.6 | — |
| Average active schema bytes / turn | 11,074 | 44,758 tool-schema bytes |
| MSO schema reduction vs full catalog | 64.5% | — |
| Required-tool routing recall | 100% | not the same benchmark |
| Deterministic routing | yes | not the same benchmark |

These numbers are a reproducible **harness-footprint baseline**, not an overall quality leaderboard. Re-run
the benchmark after catalog/router changes; do not copy the numbers into marketing claims without a fresh
measurement and comparable evaluation.

## P1 direction

P1 should build on these invariants rather than replace them:

1. typed memory records with provenance, confidence, sensitivity, temporal validity, and supersession;
2. retrieval evaluation before adding graph complexity;
3. Tool/Skill quality telemetry (success, latency, cost, invalid arguments, retries, rollback);
4. an eval-gated **Tool Forge** that may propose project functions/Skills from repeated verified workflows,
   but cannot promote generated code directly to trusted execution;
5. optional programmatic read-only orchestration for bulk filtering/aggregation, still constrained by the
   caller's scope and normal host guards;
6. task-success benchmarks shared with Hermes/OpenClaw where equivalent non-interactive contracts exist.

## Security notes

- Session archives are private backups, not secret vaults; recursive redaction happens before compression.
- Persistent memory is data, never an instruction or permission source.
- A discovered Skill or recipe cannot grant a tool the caller's token does not already permit.
- Untrusted Skills keep their instructions withheld until promoted through the existing trust process.
- `exec_run` remains full service-user shell power at `exec` scope; cognitive routing is not a sandbox.
- Never expose raw ChatGPT conversation ids, tokens, credentials, hidden chain-of-thought, or unrestricted
  tool output in memory/recipes/archives.
