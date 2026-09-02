# MSO testing handoff

Update this file at the end of every manual or automated test session. Keep it factual; never include tokens, cookies, prompts containing secrets, or hidden transcripts.

## Current status

The current deployed baseline is **MSO CLI 1.12.0** with toolset `2026.09.03.1`; use `mso --version` plus `/api/health` for the exact Git build because documentation-only release commits also advance that identity. The v1.10/v1.11 findings and the v1.12 sectioned-terminal/recoverable-error work below are resolved and retained as historical test evidence. Do not re-open a resolved finding from prose alone: reproduce it against the current build first. There is no known 1.12 release blocker in this handoff.

Current verified behavior:
- every durable session has a unique short public `name` (`milo`, `luna`, `nara`, …) independent from its longer `title`; `/rename` changes the handle and `/title` changes the description;
- human `@name` mention routing resolves active agents only; internal `agent-a` aliases remain compatibility data for explicit APIs;
- composer drafts wrap dynamically to terminal width/height, repaint on resize, and ↑/↓ navigate visual rows before history;
- `local_agents_list` exposes lease status separately from `consumerConnected` / `consumerCount`;
- `local_agent_request_wait` provides bounded foreground outcomes without resend/background polling;
- `local_agent_request` has MCP-dispatch coverage and remains a fresh bounded worker, never a claim to wake/control another terminal/ChatGPT process;
- standalone Local Agent MCP tests isolate the A2A worker import boundary instead of failing on Vitest's unresolved `server-only`;
- `read_pipeline` batches up to six eligible read-only MCP calls and applies bounded declarative transforms server-side; child calls retain their normal guards/rate limits, are forced to read scope, and cannot carry a foreign `workflow_id`;
- exact write/exec approval defaults to one compact safe line; Enter opens redacted-safe details plus the unchanged canonical digest, and a separate explicit `allow` / `deny` decision is required.
- the terminal separates `Assistant`, `Agent work`, `Local agent`, `Error`, and `Input · @name` with full-width dividers; the composer identity is `@name ›` and permission lives in the bottom footer as `mode ask|auto|yolo`;
- recoverable HTTP/API failures preserve the interaction and correlation state, classify mutation outcome as `not_started`, `completed`, or `uncertain`, redact safe error summaries, and never auto-retry an uncertain write/exec mutation.

## Copy prompt for Agent Alpha

```text
You are taking over MSO testing work in /home/rahman/projects/mso.

Read docs/TESTING-HANDOFF.md first. Current verified baseline: CLI 1.12.0, toolset 2026.09.03.1; resolve the exact live Git build from `mso --version`/`/api/health`. Preserve existing work and do not re-open resolved v1.10-v1.12 findings unless you can reproduce them against the current build.

For a new issue: record the exact reproduction, distinguish durable state from live receiver/process state, avoid duplicate write/exec retries when outcome is uncertain, add the smallest focused regression, run typecheck plus the relevant contract tests, then update this handoff with factual results.
```

### Resolved historical takeover prompt

The prompt below is retained because it records the acceptance criteria that produced 1.11/1.12. It is **not current open work**.

```text
You are taking over MSO testing work in /home/rahman/projects/mso.

Read docs/TESTING-HANDOFF.md first. Preserve existing uncommitted changes unless they directly conflict with the requested fix.

Implement and verify the open items below:
1. Expose and exercise local_agent_request end-to-end through the MCP tool catalog. It must run a fresh bounded worker from a same-owner durable session even when its live terminal lease is offline. It must never claim to wake/control the original ChatGPT conversation or terminal process.
2. Diagnose local-agent request/reply delivery. A target shown `idle` only means its lease is current; it does not prove a consumer is subscribed or will reply. Add explicit delivery/consumer observability and a bounded timeout/result state so requests cannot silently wait forever. Preserve durable mailbox and correlation semantics.
3. Replace the verbose exact-approval prompt with the compact interaction below. Keep canonical full-payload approval binding unchanged.
4. Improve the terminal conversation layout, drawing from Claude Code/Codex CLI ergonomics:
   - Render a full-width horizontal divider before each distinct section: agent work/progress, normal assistant response, and local-agent discussion/inbound or outbound messages. Dividers must make the three streams visually unambiguous without duplicating content.
   - Keep the input composer in a dedicated bottom area separated from transcript output by a full-width horizontal divider.
   - Move the current permission mode (`yolo`, auto-write, ask, etc.) into the bottom composer/status area below that input divider, not among transcript headers.
   - Put the current agent's short public name/handle in the header slot currently used for permission mode, matching the identity-forward layout familiar from Claude Code/Codex CLI. Preserve clear indication of the active permission mode in the new bottom location.
   - Preserve keyboard accessibility, resize redraw behavior, compact output, exact approval semantics, and existing local-agent correlation/inbox behavior.

Exact-approval UX requirement:
- Show only one changing status line while a write/exec approval is pending, e.g. `Approval needed: exec_run — run typecheck`.
- The line must describe the current task/tool and update for the next call; do not print `[WRITE · YOLO]`, payload JSON, hash, byte count, or a multi-line confirmation by default.
- `Tab` focuses/selects the pending approval action; `Enter` opens exact-call details (tool, redacted-safe args summary, canonical digest, scope, and allow/deny choices).
- From details, the user can explicitly allow or deny; no approval is implied by Tab or Enter alone.
- Preserve accessible keyboard behavior, cancellation/interrupt behavior, and the existing exact full-payload server-side digest check.

Validation minimum: focused unit tests for success, offline target, absent subscriber/no reply, self-target rejection, principal isolation, transcript section dividers, input divider, agent-name header placement, permission-mode bottom placement, compact default approval line, Tab-to-details, Enter-to-details, explicit allow/deny, and canonical approval binding; then npm run typecheck. Report changed files and exact test results.
```

## Session log

### 2026-09-03 — repository docs + unused Agent surface audit

**Goal**
- Make every current MSO document consistent with the shipped 1.12 Agent/runtime contract without deleting still-valid historical evidence.
- Remove only demonstrably unused recent Agent code/surface and strengthen machine checks against future documentation drift.

**Changed**
- Audited all 71 repository Markdown files; current references were synchronized while `PROGRESS`, generated changelog, dated audits/plans and older release evidence were preserved as historical records.
- At the 1.12 documentation-cleanup checkpoint, corrected MCP scope/count catalogs to 66 model/operator tools (32 read / 22 write / 12 exec) plus app-only `workflow_status`, and corrected current A2A docs to include authenticated outbound credentials, streaming and optional authenticated inbound serving.
- Updated 1.12 terminal/provider/install/Local Agent/architecture/troubleshooting guidance and replaced the stale takeover prompt with a current-baseline prompt while retaining the resolved old prompt as historical acceptance evidence.
- Strengthened `check-docs.mjs` so architecture/operator markers plus MCP, ChatGPT and connectors scope partitions must match source exactly.
- Removed dead `coreToolNames()` and made implementation-only Agent helpers private instead of exporting unused internal API.

**Verified before release gate**
- Markdown inventory: **71 files**; structural issues: **0**.
- Relative Markdown links: **125 checked / 0 broken**.
- Stale current-claim sweep for obsolete 31/29/59/56-tool counts, old toolset sample and anonymous-only A2A wording: **clean**.
- `node scripts/check-docs.mjs`: PASS — **53 checked project docs, 66 model MCP tools + 1 app-only bridge, 22 slices, 10 AppShell feature dirs**.
- `npm run typecheck`: PASS after the documentation/checker and unused-export cleanup.

**Repository-wide verification**
- Targeted Agent/docs regression: **10 test files / 45 tests passed**.
- Full release verification PASS with exit 0: `bun run verify` (typecheck, lint, coverage/full test suite, docs/architecture checks, dependency audit) followed by `bash scripts/verify-build.sh` for the out-of-tree production build.
- Lint remains **0 errors / 9 existing max-lines warnings**; this audit adds no warning-only file.
- Dependency audit: `bun audit` reports **No vulnerabilities found**.
- Final Agent dead-code scan: **0 dead top-level helpers**; the removed `coreToolNames()` was the only definition-only function found before cleanup.
- Final Markdown validation remains **71 files / 125 relative links / 0 structural issues / 0 broken links**; strengthened `check-docs.mjs` passes.

**Open work / handoff**
- No known documentation, Agent-contract, dependency-audit, or build blocker. Future tool additions/renames should update source first and let the strengthened docs gate identify every stale MCP scope/count representation instead of manually copying counts.

### 2026-09-02 — sectioned terminal + recoverable API failures

**Goal**
- Separate Assistant, Agent work, Local Agent, Error, and Input streams without buffering model output or duplicating content.
- Move permission mode to the bottom composer area while keeping the short public `@name` as the terminal identity.
- Make HTTP/API transport failures recoverable and explicit without automatically repeating an uncertain mutation.

**Changed**
- Added full-width `Assistant`, `Agent work`, `Local agent`, `Error`, and `Input · @name` section dividers.
- Replaced the old `[ask] ›` identity prompt with `@name ›`; the bottom footer now shows `mode ask|auto|yolo` and Tab cycles that mode in place.
- Preserved wrapped composer editing, vertical cursor navigation, resize repaint, and incoming-event draft redraw.
- Added structured Agent API errors plus a per-turn mutation journal with `not_started`, `completed`, and `uncertain` outcomes.
- A write/exec transport failure with uncertain delivery now stops the turn before the model can retry the mutation. A later assistant/API error after a completed mutation reports the mutation as completed and tells the client not to repeat it.
- Recoverable errors are redacted, rendered as a bounded `Error` section, persisted as safe durable context, and keep session/correlation state. Pending exact-approval metadata is retained if the approval interaction itself fails before a decision.
- Moved turn/tool orchestration out of `mso-agent.mjs`; removed obsolete internal `permissionPrompt` and `renderStatusBar` helpers rather than keeping compatibility shims.

**Verified**
- Focused Local Agent/layout/error/approval/dispatcher regression bundle: **13 test files / 91 tests passed**.
- Additional composer/layout/error focused suites passed after extracting composer row-reservation helpers to keep lint line budgets unchanged.
- Pre-release PTY smoke PASS: `@smoke-a` showed `mode yolo`, one `Assistant` section for model output, one `Agent work` section for `/spawn`, one `Local agent` section for outbound collaboration, and a bounded `Error` section for an unknown mention. `@smoke-b` received `LOCAL_LAYOUT_SMOKE` under a `Local agent · [smoke-a]` divider and its Input area/draft was redrawn correctly. Temporary PTYs were closed.
- Full release gate PASS with exit 0: `npm run typecheck`, `npm run lint`, full `npm run test`, `npm run check`, production `npm run build`, and `git diff --check`.
- Lint: **0 errors / 9 existing max-lines warnings**; no new warning-only file remains after the composer extraction.
- MCP toolset remains `2026.09.02.7` because this release changes Agent/TUI runtime semantics but adds no MCP tool.

**Release/live verification**
- Feature release commit `eeaaa27` was pushed to `main`; deployed service reported `buildSha=eeaaa27` and CLI `1.12.0`.
- Post-deploy PTY smoke PASS: source `@live-a` showed the `Input` divider, `mode yolo`, one `Assistant` section with `LIVE_ASSISTANT_112`, one outbound `Local agent` section, and a bounded `Error · local agent` section for an unknown mention. Target `@live-b` received `LIVE_LOCAL_112` under `Local agent · [live-a]` while its bottom composer remained `mode ask`.
- Both temporary PTYs were closed after the smoke. No runtime regression was found.

**Open work / handoff**
- No release blocker remains for 1.12.0. Future work should start from new reproducible observations rather than re-opening the resolved section-layout or recoverable-error findings above.

### 2026-09-02 — named sessions, responsive composer, consumer observability, compact approval

**Goal**
- Apply the user's v1.10 test findings without losing the uncommitted local-agent worker/subagent changes.
- Make session identity easy to type and separate it from session description.
- Make long terminal input editable as a responsive wrapped draft.

**Changed**
- Added per-session familiar short names with same-principal uniqueness locking and backward-compatible legacy fallback names.
- Added `/rename <name>`; kept `/title <text>` for the longer session topic/description.
- Restricted human `@name` mentions to active sessions while preserving explicit offline queueing in the lower-level mailbox API.
- Added receiver subscription observability and `local_agent_request_wait` bounded outcomes.
- Preserved/finished `local_agent_request` and configurable subagent max-turn policy from the previous test session.
- Reworked the composer into a terminal-size-aware wrapped input viewport with vertical cursor movement and resize repaint.
- Replaced verbose exact-call approval output with compact status → details → explicit allow/deny UX while preserving canonical digest verification.

**Verified so far**
- Focused regression bundle: **13 test files / 97 tests passed**.
- `npm run typecheck` passes after the changes.
- `node scripts/check-docs.mjs` reports **53 Markdown files, 66 model MCP tools + 1 app-only bridge** and is current.
- `local_agent_request` is exercised through the real MCP dispatcher with its worker boundary mocked, not by direct tool invocation only.

**Observed**
- The old standalone `tools-local-agents.test.ts` `server-only` failure was reproduced and fixed by isolating the A2A worker boundary in that test.
- `idle` remains a presence-lease state by design; receiver subscription is now a separate field instead of overloading `idle`.

**Repository-wide verification**
- Full release gate PASS: `npm run typecheck`, `npm run lint`, full `npm run test`, `npm run check`, production `npm run build`, and `git diff --check`.
- Lint: **0 errors / 9 existing max-lines warnings**; the responsive composer tests were split into a dedicated file so this change adds no new warning-only file.
- The first full-load run exposed an overly broad per-principal session-name lock; it was replaced with per-candidate-name locking, after which unrelated conversation/session creation remained concurrent and the full suite passed.

**Live 1.11.0 smoke finding**
- Fresh PTYs received familiar names `@omar` and `@cali`; `/rename qa-omar` changed only the handle while the title stayed `MSO Agent session`; `consumerConnected=true/1` was correct while the receiver was attached.
- A 40×16 PTY rendered one long logical draft across four visual rows; resizing to 72×20 repainted the same draft across two visual rows without submission/data loss.
- One real race remained: immediately after closing the target PTY, the presence lease was still `idle` for its grace window while `consumerConnected=false`, so `@qa-omar` could still enqueue. The 1.11.1 patch tightens human mention eligibility to **lease current + receiver subscribed** and race-proofs the server send boundary with the same rule. Lower-level explicit mailbox sends keep offline/no-consumer queue compatibility.

**1.11.1 verification**
- Targeted receiver-required mention patch: **24/24 tests passed**.
- First full-load gate exposed two test-timing races unrelated to the mention behavior. Session-store concurrency passed immediately when isolated; the gateway exclusion fixture still used a two-second lock-holder despite claiming explicit synchronization. The fixture now holds the lock until the test terminates it.
- Final full release gate PASS with exit 0: `npm run typecheck`, `npm run lint`, full `npm run test`, `npm run check`, production `npm run build`, and `git diff --check`.
- Lint remains **0 errors / 9 existing max-lines warnings**. Full-load session-store concurrency and gateway exclusion both pass in the final run.

**1.11.1 release/live verification**
- Released as commit `3e06c70` with `HEAD == origin/main`; live `mso.service` reported `buildSha=3e06c70` and CLI `1.11.1`.
- Close-target race smoke PASS: after target PTY disconnect the lease could still report `idle`, but `consumerConnected=false`; human `@name` was rejected immediately and the target mailbox marker count stayed unchanged.
- Temporary PTYs were closed. Durable smoke session records were not manually deleted because MSO does not yet expose a supported AgentSession delete API and direct store-file deletion could leave indexes/mailbox references inconsistent.


### 2026-09-02 — local agent wake + subagent capacity

**Goal**
- Let a same-owner durable local-agent session perform work even if its live terminal receiver is offline.
- Increase focused subagent model/tool rounds for testing.

**Changes made (uncommitted)**
- Added `local_agent_request` in `lib/mcp/tools-local-agents.ts` (exec scope).
- Added `handoffOwnerLocalSession()` in `lib/a2a/local-session.ts`.
- The request creates a fresh bounded worker using target durable session context; it does **not** wake or control the original terminal/ChatGPT session.
- Added `OS_SUBAGENT_MAX_TURNS`: default `12`, configurable up to absolute cap `48`. Callers still pass `max_turns` per invocation.

**Verification**
- `npx vitest run lib/a2a/local-session.test.ts lib/agent/local-agent-messaging.test.ts` → 15 passing.
- `npm run typecheck` → passing.
- `lib/mcp/tools-local-agents.test.ts` could not load in standalone Vitest because dependency `server-only` was unresolved via the full MCP tool graph. This is a test-environment/import issue, not treated as a passing test.

**Observed local-agent issue**
- `agent-k` is currently reported `idle` with a fresh lease, but no reply arrived.
- This status proves presence heartbeat only. It does not prove the ChatGPT-side consumer is subscribed, has read the inbox, or will execute `local_agent_reply`.
- Do not send duplicate request messages while diagnosing. Inspect delivery/inbox state and add observability/timeout behavior first.

**Open work (resolved by the 1.11 candidate)**
- `local_agent_request` now has MCP dispatcher coverage.
- Directory rows expose receiver subscription state and `local_agent_request_wait` gives bounded outcomes.
- Product UX is documented: `@name`/mailbox for active-session collaboration; `local_agent_request` for an immediate fresh bounded worker from durable context; `local_agent_request_wait` for bounded mailbox observation.

### 2026-09-02 — compact exact-approval UX requirement

**Requested behavior**
- One changing status/task line only for a pending exact write/exec approval.
- `Tab`, then `Enter`, opens the exact-call details; details contain the approval controls.
- Default display must not expose YOLO/auto-write labels or payload/hash noise.

**Handoff (resolved by the 1.11 candidate)**
- Compact approval runtime and focused regression coverage are implemented; canonical exact full-payload digest binding is unchanged.

### 2026-09-02 — terminal HTTP/API error resilience

**Resolution**
- Shipped in MSO CLI 1.12.0 (`eeaaa27`) and live-verified before the final testing-doc sync (`be0e436`). The requirements below are retained as the original acceptance evidence.

**Observed**
- During a documentation-only update, the file write succeeded, but the next tool/UI step surfaced an HTTP 400 and interrupted the visible flow before the assistant could confirm completion.

**Required follow-up**
- Treat recoverable transport/API failures (including HTTP 400) as a visible, bounded UI state rather than silently terminating the active interaction.
- Preserve the user draft, session identity, transcript, pending permission state, and correlation IDs across a recoverable failure; do not duplicate a mutation automatically.
- Render a concise error section/divider with a safe error summary, whether the preceding operation completed, and a clear retry/continue action. Never expose secrets, raw request bodies, or hidden transcripts.
- The assistant/client must still emit a user-facing completion, partial-result, or failure message after a tool/API error. If status is uncertain, say so and verify before retrying any write/exec mutation.
- Add focused tests for: HTTP 400 after a successful mutation, HTTP 400 before dispatch, draft preservation, no duplicate write on retry, pending approval preservation, and a visible user-facing error/result message.

### Template — append for every later session

```md
### YYYY-MM-DD — short title

**Goal**
- ...

**Changed**
- files / behavior

**Verified**
- exact commands and results

**Observed**
- reproducible facts only

**Open work / handoff**
- ...
```
