# RASMIC — Risk-Aware Orchestration, Memory, Evidence, and Automation

RASMIC is MSO's model-independent orchestration layer. It decides how much safety, memory, verification, and automation a task needs. It is part of MSO itself and has no hard dependency on another repository, vendor, model provider, or external memory service.

## Runtime flow

```text
TASK
→ CLASSIFY (complexity · risk · contention · memory relevance)
→ PREPARE (minimal memory · recipe/script · collision check · isolate if useful)
→ EXECUTE (bounded tools · tested scripts · agents when useful)
→ VERIFY (progressive tests · Evidence Receipt · health/manual evidence)
→ LEARN (task/debug/test/failure memory · recipe quality · script promotion)
```

## Risk and isolation

| Risk | Examples | Default isolation | Verification |
| --- | --- | --- | --- |
| LOW | docs, typo, isolated minor UI/style | direct | targeted |
| MEDIUM | contained feature, vertical slice, multi-file/runtime change | optional short-lived branch/worktree | affected checks |
| HIGH | auth, schema/database, destructive operation, infra/deploy, secrets, public API, dependency upgrade, broad/multi-agent refactor | isolated worktree | full/progressive |

A branch/worktree is a safety mechanism, not a goal. `main` can remain the integration state. New high-risk workflows cannot claim success without explicit verification evidence.

## Task context and collision detection

`workflow_start` accepts optional `affected_paths` and `reserved_resources`. Resource labels can be `port:4173`, `database:development`, `deployment:staging`, `queue:jobs`, etc.

The orchestration snapshot records base commit/branch when available, workspace path, current changed paths, declared affected paths/resources, overlapping paths/resources, active/conflicting workflow counts, risk/complexity/contention, isolation/verification policy, cleanup state, memory hits, approximate context tokens, and reused recipe id.

Collision summaries intentionally do not reveal another session's private actor or intent.

A worktree isolates Git/filesystem state only. Ports, databases, APIs, queues, caches, Docker services, deployment targets, and lockfile semantics remain explicit shared resources.

## Progressive verification

```text
LOW:    targeted check
MEDIUM: targeted check → affected tests → build if affected
HIGH:   targeted check → affected tests → build → broader regression → E2E/release verification when applicable
```

## Evidence Receipt

`workflow_finish` accepts additive structured evidence: claims, tests, build, deployment, health, artifacts, manual verification, environment, and known risks. Receipts can include base/final commit.

A successful tool call is not proof that the user-facing result works. New HIGH-risk workflows require concrete test/build/deployment/health/manual evidence before `success: true` is accepted. Evidence is redacted before persistence.

## Repo-local memory

```text
.agent/
├── memory/
│   ├── tasks/
│   ├── debug/
│   ├── tests/
│   ├── decisions/
│   └── failures/
├── recipes/
├── scripts/
└── evidence/
```

The `.agent/` tree is **runtime-local orchestration state**, not source code. MSO's own repo ignores it so evidence/memory can survive locally without making the canonical checkout dirty or blocking `mso update`. Projects that adopt RASMIC should likewise keep `.agent/` out of normal source commits; portability/sync is an explicit memory/export concern, not an implicit Git side effect.



Memory is compact structured JSON, not raw chat history. It distills what happened, what was learned, what failed, what worked, and what should be reused.

Lifecycle: `active → confirmed → superseded → archived`.

Retrieval combines lexical relevance, confidence, importance, freshness, lifecycle, and manual-user authority. Superseded/archived records are excluded by default, stale records lose rank, and a current failed manual user test outranks a conflicting automated healthy assumption. `project_memory_search` is one token-efficient read surface with `search`, `related`, and `timeline` views; relation edges are derived deterministically from supersession, scope/tags, result conflicts, and lexical overlap rather than an LLM call. It does not create `.agent/` merely because an agent searched. `project_memory_upsert` writes one task/debug/test/decision/failure record. LOW trivial successful tasks remain memory-light unless explicit evidence or relevant memory warrants persistence.

## Manual user tests

User evidence is first-class. A report such as “I tested it and it still freezes” should be stored as:

```text
kind: test
source: user-manual
result: fail
observation: <actual user observation>
```

A newer failed manual test must not be silently overridden by an older automated pass. The terminal tool router loads repo-memory tools for natural test/debug/regression wording such as `tested`, `freezes`, `crashed`, and `failed`.

## Recipe → script lifecycle

```text
observed trace
→ repeated success
→ reusable recipe candidate
→ stable verified recipe
→ bounded deterministic script candidate
→ successful real replay
→ tested script
```

A one-off trace may remain searchable history but is not returned as a reusable `recommendedRecipe`. Automatic script replay is currently restricted to bounded read-only tools. Write/exec routes remain recipes requiring normal reasoning, approval, and verification.

`project_script_run` re-validates every manifest step. A tampered script containing write/exec tools is refused. Candidate scripts become `tested` only after a successful real replay, not because unrelated workflow evidence exists. Outputs are compact and structured so repeated deterministic checks can collapse several model/tool turns into one call.

## Review loop

`review → classify actionable findings → fix → test → review again`.

Stop on `maxIterations`, repeated no-progress, new regressions, destructive uncertainty, or required human decision. Static analysis, tests, security scans, architecture rules, LLM reviewers, and external reviewers are optional backends; none is mandatory.

## Catalog-first token budget

The terminal runtime routes the latest intent through a shared deterministic capability catalog **before** projecting model history. Known intents do not pay for `skills_search` or an always-on tool core. Capability packs are phase-aware, dependency-complete, and bilingual for the common Indonesian/English operations used by MSO. The model sees only the small selected schema pack and a route-requested history slice; broader semantic discovery is the fallback for genuinely unknown intent.

The benchmark currently gates 100% required-tool recall and deterministic selection while averaging 2.7 active tools / 2,252 schema bytes per turn, a 95.8% reduction from the 70-tool catalog. Routing text averages 76 bytes and the route-requested history budget 10,571 tokens in the checked corpus. These are reproducible harness metrics, not a claim about total provider billing. Runtime status/one-shot JSON expose routing metadata outside the prompt so real token-per-success can be measured without spending model context on telemetry.

## Metrics

`workflow_finish` reports tool calls, execution duration, retries, memory hits, approximate context tokens, recipe reuse/stage, and whether a script candidate was created. It also reports reservation/worktree cleanup guidance. The objective is repeated reasoning ↓, tool calls ↓, context usage ↓, consistency ↑.

## Security

RASMIC redacts common token/password/API-key/Authorization/private-key/credential-query forms. `.agent` must be a real directory, not a symlink escape. JSON writes are atomic and bounded to 64 KiB. Created files/directories use owner-only modes. Artifact and caller-provided memory ids are normalized to safe basenames. Nested `.agent` symlink escapes are refused during both reads and writes. Script execution rechecks read-only scope. Do not persist raw credentials, cookies, Authorization headers, private keys, or secret-bearing command bodies.

## Backward compatibility

RASMIC is additive. Existing workflow ids and learned recipe storage remain valid; old in-flight workflows without RASMIC metadata can close under the old finish contract; new start fields and finish evidence are optional additions; `.agent` is portable/optional; no new package dependency is required.

## Optional external memory transport

Repo-local memory stays canonical. MSO now has internal bounded export/import adapters for a portable redacted memory bundle, so a future external service can synchronize records without becoming a core dependency. `related` and `timeline` already exist locally through `project_memory_search`; no extra model tool names were added for them.

## MCP surfaces

- `workflow_start`: classify, collision check, minimal memory/recipe/script retrieval.
- `workflow_finish`: Evidence Receipt, memory, recipe quality, metrics, script-candidate promotion.
- `project_memory_search`: ranked `search`, deterministic `related`, or compact `timeline` projection through one read tool.
- `project_memory_upsert`: structured memory and manual-test ingestion.
- `project_script_run`: bounded read-only replay and candidate→tested promotion.

## Simple mental model

```text
Small task → do it directly → targeted test.
Bigger task → check risk/collisions → retrieve only useful old lessons → use recipe/tested script if available → isolate if justified → work → test → save evidence/lessons.
```

The engineering ceremony stays behind the user-facing workflow.
