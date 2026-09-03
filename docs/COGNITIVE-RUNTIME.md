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
bun run bench:corpus -- --provider openai-codex --model gpt-5.6-terra        # nine-task dry plan
bun run bench:corpus -- --provider openai-codex --model gpt-5.6-terra --run  # isolated scratch-fixture quality corpus
bun run bench:corpus:repeat -- --runs 2 --seed baseline-1 --provider openai-codex --model gpt-5.6-terra       # deterministic repeated plan
bun run bench:corpus:repeat -- --runs 2 --seed baseline-1 --provider openai-codex --model gpt-5.6-terra --run # repeated full corpus
bun run bench:cache-calibration -- --rounds 4 --prefix-chars 12000 --seed cache-1 --provider openai-codex --model gpt-5.6-terra --run # observation-only repeated-prefix cache calibration
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

P4 deliberately withheld token ranking because MSO exposed only aggregate `input/output/total` while Hermes exposed cache/reasoning components with a different representation. P5 resolves that observability gap below without rewriting historical P4 results. Failed attempts, when present, are still charged into token/cost-per-success instead of disappearing from the denominator; partial/opaque accounting remains unknown. Cost comparison remains withheld unless both runners expose the same attributable USD semantics.

### P4 found and fixed a real RASMIC inefficiency

The first P4 diagnostic exposed an avoidable security-task route: the prompt already supplied an exact absolute path, but RASMIC's `file-read` pattern required a literal word such as `file`, so the fallback injected `skills_search → fs_list → fs_read`. The catalog and agent policy now route exact-path reads directly and route explicit multi-read aggregation to `read_pipeline` without discovery fallback. The initial diagnostic observed **3 tools / 14,934 reported tokens / 16,072 ms**; the final matched-provider corpus observed **1 `fs_read` / 2,117 reported tokens / 8,774 ms**, while task/scenario-policy remained **100% / 100%**. Those before/after timings are observed runs, not a controlled causal estimate; the structural routing change (3 tools → 1) is the deterministic invariant.

The final `multi-read` scenario uses exactly one `read_pipeline` call. Recovery intentionally records one failed `fs_read` because the task explicitly requires trying the missing primary before using the fallback; that is expected recovery evidence, not a benchmark failure. Scenario-tree scoring also rejects unexpected extra files/symlinks rather than checking only the named target.

### OpenClaw status

OpenClaw remains installed and testable, but the current host does not expose an equivalent usable `openai-codex/gpt-5.6-terra` path for its main agent. P4/P5 **do not change competitor credentials/configuration just to manufacture comparability**, and they therefore emit no OpenClaw quality ranking yet.

## P5 normalized provider-usage semantics

P5 makes token accounting auditable without adding prompt context or inventing missing values. A provider-neutral usage envelope now preserves the provider's raw categories plus an explicit accounting mode:

- OpenAI Responses / Codex and compatible Chat Completions: `inputTokens`, `outputTokens`, authoritative `totalTokens`, optional `cacheReadTokens`, `cacheWriteTokens`, and `reasoningTokens`, with `accountingMode=inclusive-input-output-total`. Cache/reasoning are details already included in the input/output categories; they are **not added again**.
- Anthropic: input/output plus optional cache-read/cache-creation categories with `accountingMode=separate-cache-input-output`; absent fields remain absent. A benchmark-only canonical total may be derived from this explicit component contract, while the raw provider total remains unknown if Anthropic did not report one.
- Agent session aggregation tracks `apiCalls`, accounting mode, and detail coverage. A new session starts at `{apiCalls:0}` instead of fake zero token totals, so an unknown provider field cannot silently become `0`.

The benchmark converts representations to canonical `inclusive-input-output-total` only with proof. `accountingProof` records why the conversion is allowed. In the isolated candidate corpus:

- MSO: `explicit-inclusive-contract` from the actual Codex `response.completed.usage` payload, including provider-reported cache/reasoning details.
- Hermes: `exact-exclusive-cache-sum`; on every corpus scenario, arithmetic proves `total = base input + cache-read/cache-write + output`, while `reasoning` is already a subset of output. If that identity does not hold, the row stays `opaque-total`.
- Two equally opaque totals are **not** considered comparable merely because their labels match. Token comparability additionally requires 100% coverage, canonical recognized mode, and non-unknown proof for every agent.

A full six-scenario candidate run on the same `openai-codex/gpt-5.6-terra` provider/model preserved the quality result while making token totals comparable:

| P5 metric | MSO | Hermes |
|---|---:|---:|
| Task success | **6/6 (100%)** | **6/6 (100%)** |
| Scenario-observable policy compliance | **6/6 (100%)** | **6/6 (100%)** |
| Average latency | **11,497.7 ms** | 16,199.3 ms |
| p50 latency | **11,782 ms** | 16,184.5 ms |
| Normalized token coverage | **100%** | **100%** |
| Normalized tokens / successful task | **3,510.8** | 59,743.2 |
| Accounting proof | explicit inclusive contract | exact exclusive-cache sum |
| Cost semantics comparable | no | no |

On this bounded corpus, MSO uses about **94.1% fewer normalized tokens per successful task (~17× smaller)**, with **29.0% lower average latency** and **27.2% lower p50 latency** in this run. This is a corpus result, not a universal product/model claim; quality ranking still prioritizes task success and scenario-policy, with latency only as its descriptive tie-breaker. Token efficiency is reported as a separate now-comparable metric and still does not override correctness/policy. Cost remains withheld because MSO has no comparable cost field and Hermes reports included cost with source `none`.

The candidate run also preserves the structural P3/P4 behaviors: `multi-read` uses one `read_pipeline`, security uses one `fs_read`, and recovery's one failed primary read remains expected task evidence.

## P6 expanded repository/recovery corpus

P6 broadens the objective corpus from six micro-scenarios to **nine** by adding three repo-style tasks while retaining the same per-agent private scratch isolation, rotating scenario-major execution order, state-based scoring, requested provider/model evidence, and proof-gated token normalization:

7. `repo-debug` — inspect an issue/source/test trio, patch only the implementation, then run the immutable test;
8. `repo-migration` — migrate every record to a new schema while preserving order/identity, then run an immutable validator;
9. `rollback` — apply a requested change, observe validator rejection and its failure evidence, then restore the stable config exactly without erasing that evidence.

The new fixtures are intentionally tool-neutral: prompts require filesystem/execution capability but do not name MSO-specific tools. Repo tests/specs/validators are immutable authority, unexpected files/symlinks fail scenario-policy, and the verifier reruns the fixed repo validators only after the scenario tree exactly matches the expected final state. The runner is still **not** a whole-host sandbox; `policyObservationScope=scenario-tree` keeps that boundary explicit.

P6 immediately found a real RASMIC defect. Generic words such as `debug`/`test` were over-classified as a *user manual-test result*, which loaded `project_memory_upsert` and could omit execution validation. The manual-result route is now limited to actual outcome language such as “I tested it”, “still broken”, or “sudah test”; explicit `run node|bun|npm|pnpm|python|pytest ...` validation gets `exec_run`, and repo-first debug/migration/rollback intent enters the normal repo-change lifecycle. A second trace finding showed long repo turns could lose the first `workflow_start` from an eight-row recent-tool window and re-offer it. Workflow-start state is now tracked for the complete current user turn, so long work keeps `workflow_finish/cancel` available without opening a duplicate workflow. Targeted post-fix `repo-debug` and `repo-migration` both passed with exactly **one** `workflow_start`.

The final post-lifecycle full run used the same `openai-codex/gpt-5.6-terra` provider/model for MSO and Hermes across all nine scenarios:

| P6 metric | MSO | Hermes |
|---|---:|---:|
| Task success | **9/9 (100%)** | 8/9 (88.9%) |
| Scenario-observable policy compliance | **9/9 (100%)** | **9/9 (100%)** |
| Average latency | 22,776 ms | **22,189.3 ms** |
| p50 latency | **15,285 ms** | 23,294 ms |
| Normalized token coverage | **100%** | **100%** |
| Normalized tokens / attempt | **16,683.4** | 67,433.1 |
| Normalized tokens / successful task | **16,683.4** | 75,862.3 |
| Accounting proof | explicit inclusive contract | exact exclusive-cache sum |
| Cost semantics comparable | no | no |

On that exact full run, the formal quality ranking is eligible and orders **MSO > Hermes** because correctness precedes policy and latency. The only Hermes task miss was `multi-read`: its scenario tree stayed unchanged and the process exited normally, but the exact aggregate answer was wrong. That miss was **not reproduced** in a follow-up alternating-order stability check: MSO passed 3/3 and Hermes passed 3/3 `multi-read` repeats. Therefore P6 records the 8/9 full-run outcome as observed run variance, **not** as evidence that MSO is universally more reliable.

Efficiency is less sensitive to that one miss. On all nine attempts, MSO averaged **16,683.4 normalized tokens/attempt vs 67,433.1** for Hermes — about **75.3% fewer (~4.04× smaller)**. Tokens/success are **78.0% lower (~4.55× smaller)** in the formal run, but that denominator also charges Hermes's failed attempt, so tokens/attempt is the cleaner cross-run efficiency comparison here. MSO's p50 was **34.4% lower**, while its average latency was **2.6% higher** because `repo-debug` and `repo-migration` were slower; P6 therefore does not claim a blanket latency win. Cost remains withheld.

The full-run MSO repo traces also confirm the structural lifecycle fix: `repo-debug` and `repo-migration` each contain one `workflow_start`, bounded reads/writes, one `exec_run` validator, and `workflow_finish`; rollback preserves rejected-transaction evidence while restoring the config exactly. The older P4/P5 six-scenario results above remain historical evidence and are not rewritten as if they were P6 results.

## P7 repeated full-corpus baseline

P7 closes the first P6 follow-up by making repeatability a first-class benchmark contract instead of an ad-hoc rerun. `bench:corpus` now accepts an explicit bounded `--seed` and records both the seed and requested agent order. New `bench:corpus:repeat` derives a deterministic seed per run, rotates the starting agent between runs, executes the complete child corpus unchanged, and aggregates only after strict identity checks. Ranking is withheld if any requested child run is missing, seed/order identity drifts, one agent duplicates or omits a scenario while preserving row count, or provider/model identity changes across runs. The repeat layer reports observed counts/rates and does **not** manufacture confidence intervals or statistical-significance claims.

The first full P7 baseline was executed from source commit `5bd5788` with two complete nine-scenario runs on `openai-codex/gpt-5.6-terra`, using different derived fixture seeds and opposite starting-agent order. Independent post-run validation checked all **36 rows**, exact per-run/per-agent scenario identity, provider/model evidence, scenario-policy, exit status, and every token-accounting arithmetic proof.

| P7 repeated metric | MSO | Hermes |
|---|---:|---:|
| Task success | **18/18 (100%)** | **18/18 (100%)** |
| Scenario-observable policy compliance | **18/18 (100%)** | **18/18 (100%)** |
| Perfect full runs | **2/2** | **2/2** |
| Average latency | **18,922.6 ms** | 21,077.4 ms |
| p50 latency | **13,761 ms** | 20,513.5 ms |
| Normalized token coverage | **100%** | **100%** |
| Normalized tokens / attempt | **17,271.3** | 65,073.3 |
| Accounting proof | explicit inclusive contract | exact exclusive-cache sum |
| Cost semantics comparable | no | no |

Across these two runs, MSO used about **73.5% fewer normalized tokens per attempt** (Hermes used ~3.77× as many), with **10.2% lower average latency** and **32.9% lower p50 latency**. The earlier P6 Hermes `multi-read` miss did not recur: both agents passed `multi-read` **2/2** here, in addition to the prior P6 3/3 alternating-order stability follow-up. That strengthens the interpretation that the single P6 miss was run variance, but two complete repeats are still a small sample and P7 does not turn this into a universal reliability claim.

P7 also observed real provider-reported cache-read activity without forcing a cache hit: MSO had positive `cacheReadTokens` on **4/18** rows while preserving `explicit-inclusive-contract` arithmetic; Hermes reported positive cache reads on all 18 rows under its separately proven `exact-exclusive-cache-sum` shape. Cache-hit frequency is not ranked because the runners expose different request/context behavior. The observation is useful only as evidence for a dedicated repeated-prefix cache-calibration phase. Cost remains withheld because the attribution contract is still asymmetric.

## P7 next direction

1. **Increase repeat depth before reliability statistics** — run at least several additional complete, independently seeded corpora before estimating variance/confidence; two runs establish the mechanism and first repeated baseline, not statistical certainty.
2. **Calibrate cache behavior** — add repeated-prefix fixtures that can observe real provider cache hits without forcing them; keep zero/absent cache fields distinct and never assume a hit.
3. **Normalize cost only with attribution** — compare cost only when every runner exposes the same usable USD source/contract; `0` with source `none` is not evidence of free execution.
4. **Add OpenClaw only when comparable** — run the same corpus when an equivalent provider/model is legitimately configured, without mutating credentials as part of the benchmark.
5. **Keep benchmark → engineering feedback closed-loop** — fix deterministic routing/lifecycle/tool waste exposed by the corpus, then rerun the same objective fixture rather than prompting harder.
6. **Memory calibration** — grow post-P1 telemetry and test authority/confidence/temporal policies against real corrections before introducing graph-memory complexity.

## P8 calibration: repeat spread, cache observation, and cost gate

P8 turns the P7 follow-up list into explicit calibration gates without changing the nine-scenario corpus. Repeated aggregation now reports **descriptive per-run distributions** for task success, average latency, p50 latency, and normalized tokens/attempt: count, min/max, median/mean, range, sample standard deviation, and coefficient of variation. These are observed sample descriptors only; the harness still does not manufacture confidence intervals, p-values, or universal reliability claims.

P8 also adds `bench:cache-calibration`. It creates one deterministic inert shared prefix, changes only a small exact reply marker per round, alternates the starting agent, and records provider-reported cache fields separately as positive, zero, or absent. Cache-hit frequency is intentionally **not ranked** because MSO and Hermes still have different request envelopes/system/tool context. The benchmark never forces a cache hit and never infers one from latency.

The dedicated cache fixture exposed a benchmark-accounting defect: one runner can legitimately move between multiple independently proven normalized shapes across calls (for example, `exact-inclusive-total-identity` when cache is zero and `exact-exclusive-cache-sum` when cache is positive). The old aggregate gate treated the mixed proof *names* as non-comparable even though every row normalized exactly to the same inclusive total semantics. P8 fixes this by proof-gating **each row**, while opaque/unknown rows still fail closed.

The final P8 cache calibration was run from source `51ae31f` on `openai-codex/gpt-5.6-terra` with four rounds and a 12,000-character shared prefix. All **8/8 calls succeeded** and provider/model evidence covered every row. MSO reported `cacheReadTokens=0` on **4/4** rows. Hermes reported zero on 2/4 and positive cache reads on **2/4** rows (**9,728** and **19,968** tokens). Token semantics remain comparable after per-row proof normalization; cache frequency remains observation-only. Cost remains non-comparable: MSO has no attributed cost field, while Hermes reports zero with source `none`, which is not evidence of a shared USD billing contract.

P8 then added three more complete independently seeded nine-scenario runs, also from `51ae31f`. Independent validation checked all **54 rows**, exact per-run/per-agent scenario identity, provider/model evidence, exit status, task/policy outcome, and normalized token arithmetic. Both agents achieved **27/27 task success + 27/27 scenario-policy and 3/3 perfect runs**.

| P8 3-run metric | MSO | Hermes |
|---|---:|---:|
| Task success | **27/27 (100%)** | **27/27 (100%)** |
| Scenario-observable policy compliance | **27/27 (100%)** | **27/27 (100%)** |
| Perfect full runs | **3/3** | **3/3** |
| Average latency | **19,028.2 ms** | 22,248.0 ms |
| Aggregate p50 latency | **14,259 ms** | 20,472 ms |
| Normalized tokens / attempt | **16,665.0** | 67,936.2 |
| Run-level avg-latency CV | 6.8% | 4.0% |
| Run-level p50 CV | 10.6% | 12.6% |
| Run-level token/attempt CV | 2.3% | 1.9% |
| Cost semantics comparable | no | no |

On these three P8 runs, correctness/reliability is a tie. MSO used about **75.5% fewer normalized tokens per attempt (~4.08× smaller)**, with about **14.5% lower average latency** and **30.3% lower aggregate p50**. Those are bounded observed-run measurements, not provider/model-wide claims.

Combining the raw P7 two-run artifact and raw P8 three-run artifact gives a five-run descriptive history on the same corpus/provider/model. Both agents are **5/5 perfect**. Mean normalized tokens/attempt are **16,907.6 MSO vs 66,791.1 Hermes** (~**74.7% lower**, Hermes ~3.95× higher); mean per-run average latency is **18,985.9 vs 21,779.8 ms** (~**12.8% lower** for MSO); mean per-run p50 is **14,130.8 vs 21,457.2 ms** (~**34.1% lower**). Run-level token CV is 5.5% vs 2.7%. Five runs are enough to expose observed spread and remove the earlier one-run reliability anomaly, but still too small for an inferential reliability claim.

## P8 next direction

1. **Reliability stays descriptive until the sample is materially deeper** — add more full independent seeds only when a decision actually needs confidence bounds; do not turn `n=5` into pseudo-statistics.
2. **Equalize cache request envelopes before cache comparison** — the dedicated fixture now proves telemetry handling, but cache-hit frequency should remain unranked until the runners expose equivalent system/tool/request prefix behavior.
3. **Cost remains blocked on attribution, not arithmetic** — enable cost comparison only when both runners expose the same attributable USD source/contract; zero with source `none` remains unknown for comparative billing.
4. **Add OpenClaw only with a legitimate matched provider/model path** — do not mutate credentials merely to populate a benchmark table.
5. **Move next to memory calibration** — test P1 authority/confidence/temporal/correction policies against real repeated corrections before considering graph-memory complexity.
6. **Keep benchmark → engineering feedback closed-loop** — when a fixture exposes deterministic tool/routing/accounting waste, fix the system and rerun the same objective gate rather than prompting harder.

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
