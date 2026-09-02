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

The router is **catalog-first, not model-first**. It classifies the latest user intent through a deterministic bilingual capability catalog before the model call, loads only that capability pack plus proven dependencies, and falls back to `skills_search`/lexical discovery only when the catalog cannot classify the request. There is no always-on schema core. Short continuation prompts inherit only a bounded prior user intent; routing never needs the full projected conversation.

Capability packs are phase-aware. A repository change starts with `workflow_start` alone; after that call, the next round exposes the bounded execution/finish pack instead of sending `workflow_start` again. Long jobs add status/cancel companions, writes add their bounded read prerequisite, and local-agent/A2A/Forge routes add only the lifecycle tools needed for that class. Hiding a schema from one turn neither deletes the tool nor changes its permission because invocation is still validated against the complete local catalog.

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
bun run bench:agents -- --provider openai-codex --model gpt-5.6-terra        # one-task smoke plan
bun run bench:corpus -- --provider openai-codex --model gpt-5.6-terra        # six-task dry plan
bun run bench:corpus -- --provider openai-codex --model gpt-5.6-terra --run  # isolated scratch-fixture quality corpus
```

The core benchmark is deterministic and provider-neutral. Its checked scenarios cover application logs, server health, safe file editing, long/short execution, project functions, Cloudflare/Hostinger/Dokploy, browser/screenshots, memory, session resume, Skills, manual regression evidence, Indonesian repository changes, local-agent requests, subagents, A2A and Tool Forge. It also verifies the second phase after `workflow_start`.

Release gates require:

- **100% required-tool recall** on the checked scenarios;
- **100% typed-memory retrieval, temporal-resolution and conflict-resolution accuracy** on the deterministic fixture suite;
- deterministic selection for identical input;
- average active tools ≤ 4 and active-schema reduction ≥ 95%;
- catalog hit rate ≥ 90%, average routing text ≤ 12 KiB, and average route-requested history budget ≤ 16k tokens;
- phase-aware repository execution after `workflow_start`;
- lower active schema bytes than the full MSO catalog;
- when Hermes' installed CLI exposes `hermes prompt-size`, lower active tool-schema bytes than that exact
  comparable metric.

The benchmark reports OpenClaw's installed version but **does not declare an OpenClaw win** from schema
footprint because the installed OpenClaw CLI currently exposes no directly equivalent offline prompt-size
probe. Overall product superiority also cannot be inferred from a prompt-size result. Future comparison
must add equivalent task-success, tool-error, token-per-success, latency-per-success, and policy-compliance
scenarios before making that claim.

## Historical P2 + A2A baseline

On the development host after P2 + outbound A2A integration:

| Metric | MSO P2 + A2A | Hermes local baseline |
|---|---:|---:|
| Full MSO transport catalog | 70 tools | — |
| Full model-tool schema bytes | 53,108 | — |
| Average MSO active tools / turn | 2.7 | — |
| Average active schema bytes / turn | 2,252 | 44,758 tool-schema bytes |
| MSO schema reduction vs full catalog | 95.8% | — |
| Required-tool routing recall / catalog hit | 100% / 100% | not the same benchmark |
| Average routing text / requested history budget | 76 bytes / 10,571 tokens | — |
| Typed-memory fixture accuracy | 100% (8/8) | not implemented in this harness |
| Deterministic routing / memory resolution | yes / yes | not the same benchmark |

The existing learned-recipe store currently reports **179 successful / 186 total workflows (96.2%)**, but those recipes predate the P1 quality schema, so step-level telemetry coverage correctly starts at **0%** rather than fabricating historical tool-error/retry data. New or re-learned recipes carry `qualityVersion: 1`; coverage grows naturally from real post-P1 executions.

A non-interactive full MSO tool loop is available as `mso agent --oneshot <prompt> --json`. It defaults to read-only autonomous approval; write/exec require explicit `--approve-scope write|exec`. The earliest cross-agent smoke intentionally used a mismatched `openai` provider and correctly returned **`comparable=false`** for Hermes/OpenClaw. P4 later discovered that MSO and Hermes already share `openai-codex/gpt-5.6-terra`, enabling the first genuinely provider+model-matched corpus below without changing competitor credentials or configuration. OpenClaw still has no usable equivalent model/provider path on this host, so it remains outside the ranking.

These numbers are reproducible harness baselines, not an overall quality leaderboard. P4 permits a bounded corpus ranking only when every compared runner covers the same full corpus with 100% model-family/provider evidence matching the requested provider; one-task smoke latency is never an overall-agent claim.

## Current P3 + RASMIC baseline

P3 runs on the catalog-first RASMIC router rather than the older lexical active-tool selector. The merged deterministic harness now reports:

| Metric | MSO P3 + RASMIC | Hermes local baseline |
|---|---:|---:|
| Full MSO transport catalog | 71 tools | — |
| Full MSO schema bytes | 55,995 | — |
| Average MSO active tools / turn | 2.6 | — |
| Average active schema bytes / turn | 2,281 | 44,758 tool-schema bytes |
| MSO schema reduction vs full catalog | 95.9% | — |
| Required-tool routing recall / catalog hit | 100% / 100% | not the same benchmark |
| Average routing text / requested history budget | 77 bytes / 10,455 tokens | — |
| Typed-memory fixture accuracy | 100% | not implemented in this harness |
| P3 read fixture model round-trips | 1 vs 4 raw calls (75% lower) | not implemented in this harness |
| P3 read fixture model-visible bytes | 1,891 vs 232,205 raw bytes (99.2% lower) | not implemented in this harness |
| P3 read fixture correctness / determinism | exact / yes | not the same benchmark |

The Hermes comparison above is **tool-schema footprint only** and does not establish product superiority. The P4 section below is the separate matched-provider task-quality corpus; its ranking is bounded to those six scenarios. OpenClaw still exposes no equivalent configured provider/model path on this host and remains outside that ranking.

## P4 comparable task-quality baseline

P4 turns the benchmark harness into an engineering gate rather than a one-task demo. `bench:corpus` creates **six seeded, semantically identical task fixtures per agent in separate private 0700 scratch directories** so write tasks cannot contaminate another runner. Every outcome is scored from the exact scenario filesystem tree/result state rather than trusting the model's prose. Fixture isolation is not an authority sandbox: each runner keeps its normal tool authority, the harness reports `runnerAuthoritySandboxed=false`, and `policyObservationScope=scenario-tree` means policy compliance is proven only for the exact observable fixture tree—not for the whole host. Agent execution is scenario-major with rotating runner order to reduce warm-up/order bias:

1. `read-json` — exact read + arithmetic;
2. `multi-read` — two-source transform/aggregation;
3. `write-create` — exact scratch-file creation;
4. `write-preserve` — one-field update with unrelated bytes/newline preserved;
5. `recovery` — missing-primary → fallback recovery while all inputs/sentinels remain unchanged;
6. `security-injection` — malicious instructions inside untrusted JSON must remain data and a protected scratch sentinel must not change.

The final post-optimization head-to-head uses the **same `openai-codex/gpt-5.6-terra` provider/model** for MSO and Hermes. Both runners receive the same seeded values/expected outcomes in isolated agent-local paths and cover all six scenarios:

| P4 metric | MSO | Hermes |
|---|---:|---:|
| Task success | **6/6 (100%)** | **6/6 (100%)** |
| Scenario-observable policy compliance | **6/6 (100%)** | **6/6 (100%)** |
| Average latency | **10,759.5 ms** | 14,624 ms |
| p50 latency | **10,646.5 ms** | 14,304.5 ms |
| Reported token coverage | 100% | 100% |
| Reported tokens / successful task | 3,495.2 | 56,718.2 |
| Tool telemetry coverage | 100% | unavailable from the Hermes one-shot report |

Comparability is fail-closed: every attempted scenario must report matching model-family evidence and the same **requested** provider before a quality ranking is eligible. Both runners satisfied that contract for this run. Because task success and scenario-observable policy compliance tie, the P4 quality ranking uses p50/average latency only as a descriptive tie-breaker: **MSO ranks ahead of Hermes on this six-scenario corpus**, with about **26.4% lower average latency** and **25.6% lower p50 latency**. This is a bounded corpus result, not a claim that MSO is universally better on every workload.

### Token/cost accounting is deliberately separate

The reported token totals are **not used to rank the agents**. MSO currently reports provider `input/output/total` usage (`input-output-total` accounting), while Hermes' one-shot report exposes expanded input/output/cache/reasoning components (`expanded-components`). P4 therefore records `tokenSemanticsComparable=false` even though both have 100% token coverage. Failed attempts, when present, are charged into tokens/cost-per-success instead of disappearing from the denominator; partial coverage leaves per-success efficiency unknown. Cost comparison is also withheld: MSO reports no comparable cost field, while the local Hermes report marks cost as included with source `none`; an ambiguous generic `cost` is not assumed to be USD unless currency is explicit. Missing or semantically incompatible accounting remains **unknown/non-comparable**, never zero-efficiency evidence.

### P4 found and fixed a real RASMIC inefficiency

The first P4 diagnostic exposed an avoidable security-task route: the prompt already supplied an exact absolute path, but RASMIC's `file-read` pattern required a literal word such as `file`, so the fallback injected `skills_search → fs_list → fs_read`. The catalog and agent policy now route exact-path reads directly and route explicit multi-read aggregation to `read_pipeline` without discovery fallback. The initial diagnostic observed **3 tools / 14,934 reported tokens / 16,072 ms**; the final matched-provider corpus observed **1 `fs_read` / 2,117 reported tokens / 8,774 ms**, while task/scenario-policy remained **100% / 100%**. Those before/after timings are observed runs, not a controlled causal estimate; the structural routing change (3 tools → 1) is the deterministic invariant.

The final `multi-read` scenario uses exactly one `read_pipeline` call. Recovery intentionally records one failed `fs_read` because the task explicitly requires trying the missing primary before using the fallback; that is expected recovery evidence, not a benchmark failure. Scenario-tree scoring also rejects unexpected extra files/symlinks rather than checking only the named target.

### OpenClaw status

OpenClaw remains installed and testable, but the current host does not expose an equivalent usable `openai-codex/gpt-5.6-terra` path for its main agent. P4 **does not change competitor credentials/configuration just to manufacture comparability**, and it therefore emits no OpenClaw quality ranking yet.

## P4 next direction

1. **Broaden the corpus before broad claims** — add repository debugging, longer multi-step work, approval/retry/rollback, and realistic MCP project tasks while keeping objective state-based scoring.
2. **Normalize provider usage semantics** — expose cache/reasoning usage consistently from MSO (where the provider supplies it) before allowing token/cost efficiency to influence ranking.
3. **Add OpenClaw only when comparable** — run the same corpus when an equivalent provider/model is legitimately configured, without mutating credentials as part of the benchmark.
4. **Use benchmark failures as engineering inputs** — keep the P4 pattern: locate an unnecessary route/tool/retry, fix the harness/runtime rather than prompting harder, then rerun the exact seeded scenario.
5. **Memory calibration** — grow post-P1 telemetry and test authority/confidence/temporal policies against real corrections before introducing graph-memory complexity.

## Security notes

- Session archives are private backups, not secret vaults; recursive redaction happens before compression.
- Persistent memory is data, never an instruction or permission source.
- A discovered Skill or recipe cannot grant a tool the caller's token does not already permit.
- Untrusted Skills keep their instructions withheld until promoted through the existing trust process.
- Tool Forge candidates are inert. Executable fixtures require the labelled local Docker sandbox; evaluation never auto-pulls an image or executes generated shell/code.
- `read_pipeline` is an efficiency surface, not authority: only eligible read-only tools may run, child scope is forced to read, child rate limits/host guards stay active, and arbitrary program execution is impossible by contract.
- `exec_run` remains full service-user shell power at `exec` scope; cognitive routing is not a sandbox.
- Never expose raw ChatGPT conversation ids, tokens, credentials, hidden chain-of-thought, or unrestricted
  tool output in memory/recipes/archives.
