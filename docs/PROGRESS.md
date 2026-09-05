## 2026-09-05 — MCP Page preview lifecycle


## 2026-09-05 — Native named-connection identity, not parallel credential forms

The provider-only Integrations store could not represent multiple deployments or
source-aware execution even though its HTML form worked. Replace the foundation
with credential users, named connections, direct/Composio/provider-MCP sources,
auth methods, folder/default resolution and explicit account selection. Browser,
CLI and MCP now call the same domain actions; old infrastructure helpers adapt to
that core and pin values for compound provider operations.

Preserve v1 data through a read-only projection and exact protected backup before
the first atomic v2 write. Bind temporary setup capabilities to user/connection
UID/revision so stale forms cannot rotate another account. Namespace upstream
Composio users by installation/profile UUID; lease both the target and broker for
hosted authorization/execution. Duplication is metadata-only unless copying direct
credentials is separately approved. Device roles remain distinct from credential
profiles, not a new user-login/ACL system.

Tests exercise two users, five Convex connections, folder resolution, actual
Dokploy client routing, source refusal, hosted-account identity, lease protection,
MCP/CLI contracts and real shared-core browser saves with synthetic credentials.
Page layout follows the host's returned display mode; full-height behavior is
measured against the fixture iframe viewport rather than assumed from a button.
No real upstream OAuth success is inferred from these tests.

- **Reviewed-app Google sign-in leaves the iframe (2026-09-05):** Page v6 adds an explicit host-side Google-login action using a code-owned same-origin path. A nested app may only highlight this action, never trigger navigation, supply a URL or transfer session data. The host opens through `ui/open-link`/`openExternal` after a real button click; sandbox popup restrictions remain unchanged. Play Together finishes sign-in in the browser tab; this does not promise shared login with storage-partitioned embeds. v5 resource requests remain compatible.


## 2026-09-05 — Repair native Integrations delivery and full credential catalog

The initial temporary form was too narrow and could arrive without its UI-only
setup grant when the MCP transport selected the generic profile. Preserve that
metadata in MCP `_meta` for both profiles without making it serializable in model
results. Page v5 shares one guided picker with `/integrations`, advertises exact
standard/compatibility CSP origins, and keeps older resource aliases working.
Missing grants, authorization, and cached setup tools have explicit recovery paths.

Expand native setup from four providers to twelve without importing another
application's credential library or state. Method-specific fields distinguish
Composio project/organization and Convex personal/deployment credentials. Fix the
Composio organization endpoint and use the dedicated read-only PAT verification
endpoint for Convex. Schema-derived masking covers every secret field.

Targeted security/contract tests and desktop/mobile browser fixtures prove catalog
navigation, guidance before sign-in, retry, safe save, input cleanup and no key in
MCP messages. Provider key verification and full upstream OAuth remain distinct;
synthetic browser tests are not evidence of a user's successful authorization.

Fixed a missing MCP Apps host initialization handshake, wrapped tool-result handling and
repeated iframe remounts on unchanged globals. Page v3 now waits for an origin/source-checked
app readiness message, displays bounded retry/direct-production actions, and preserves the
cached v2 URI as a read-only alias. The exact reviewed iframe registry and Block-only approval
contract remain unchanged. Targeted contracts and a desktop/mobile browser harness validate
both standard MCP and legacy ChatGPT host paths. Toolset: `2026.09.05.1`.

# mso — Progress Log
- **Native integration preservation (2026-09-05):** merged published c164dbe without dropping the concurrent native credential setup. The short README retains its documentation link (99 lines). MCP 1.12.0 / toolset 2026.09.05.4 labels the combined maintenance, service-token, Page-readiness and native-integration contracts. This merge does not execute maintenance or reset real credentials.
- **Concurrent main reconciliation (2026-09-05):** preserved published MCP Page initialization/readiness changes e46c417 + changelog c4856d2 in the maintenance/PR integration branch without modifying the other session's unpublished work. MCP 1.11.1 / toolset 2026.09.05.2 records the combined compatible contract. The Settings maintenance files are unchanged from the isolated desktop/mobile acceptance at 2164d29; full repository and GitHub gates are rerun for the combined source.
- **PR integration validation (2026-09-05):** preserve the reviewed PR36/PR37 ancestry while repairing PR38 glob escaping/native Bun audit checks and PR37 code-generating visual-test fixtures. Direct-image boundary tests now cover malformed content and size/type limits. MCP server 1.11.0 / toolset 2026.09.05.1 records the compatible restricted-service-token/direct-image contract; widget resources and ordinary OAuth token behavior are unchanged. Publication still requires complete current-head local and remote gates, including late CodeQL findings—not only the workflow completion status.
- **Reviewed 9Router network boundary (PR36, 2026-09-05):** reuse the configured internal proxy network only when it already exists; Docker host publishing remains loopback-only unless explicitly enabled. This supports a containerized reverse proxy without opening the application port to the public interface. The update adds no automatic network creation or DNS mutation. The old PR lifecycle-test failure must be rechecked against the combined current baseline before publication.


## 2026-09-05 — Integration setup recovery and complete browser navigation

The previous setup document exposed a clickable setup button before Owner sign-in,
then collapsed authentication and transport failures into the same 403 message.
The Page also depended on a new setup action that cached chat catalogs may not know.
The native `/integrations` hub now probes live auth before enabling changes, keeps
provider/method guides available beforehand, refreshes on return from sign-in, and
provides expiry recovery and a route back from completed forms. Old URLs are retained.
Page v4 preserves usable browser links on unknown-tool/missing-private-metadata
responses, while older Page URIs map to the same current resource. Framing policy,
Owner gates, direct secret submission, and scoped capability checks remain intact.

Validation: isolated desktop/mobile browser runs exercise the signed-out to Owner
transition, method selection, rejected-save retry, cleared successful inputs, and
cached/current MCP bridge modes. No real credential was written by those tests.
The connected chat can display the Page, but a browser fixture is not proof that
its cached tool catalog has refreshed; the visible fallback is part of the contract.


Fixed a missing MCP Apps host initialization handshake, wrapped tool-result handling and
repeated iframe remounts on unchanged globals. Page v3 now waits for an origin/source-checked
app readiness message, displays bounded retry/direct-production actions, and preserves the
cached v2 URI as a read-only alias. The exact reviewed iframe registry and Block-only approval
contract remain unchanged. Targeted contracts and a desktop/mobile browser harness validate
both standard MCP and legacy ChatGPT host paths. Toolset: `2026.09.05.1`.

# mso — Progress Log
- **Native integration preservation (2026-09-05):** merged published c164dbe without dropping the concurrent native credential setup. The short README retains its documentation link (99 lines). MCP 1.12.0 / toolset 2026.09.05.4 labels the combined maintenance, service-token, Page-readiness and native-integration contracts. This merge does not execute maintenance or reset real credentials.
- **Concurrent main reconciliation (2026-09-05):** preserved published MCP Page initialization/readiness changes e46c417 + changelog c4856d2 in the maintenance/PR integration branch without modifying the other session's unpublished work. MCP 1.11.1 / toolset 2026.09.05.2 records the combined compatible contract. The Settings maintenance files are unchanged from the isolated desktop/mobile acceptance at 2164d29; full repository and GitHub gates are rerun for the combined source.
- **PR integration validation (2026-09-05):** preserve the reviewed PR36/PR37 ancestry while repairing PR38 glob escaping/native Bun audit checks and PR37 code-generating visual-test fixtures. Direct-image boundary tests now cover malformed content and size/type limits. MCP server 1.11.0 / toolset 2026.09.05.1 records the compatible restricted-service-token/direct-image contract; widget resources and ordinary OAuth token behavior are unchanged. Publication still requires complete current-head local and remote gates, including late CodeQL findings—not only the workflow completion status.
- **Reviewed 9Router network boundary (PR36, 2026-09-05):** reuse the configured internal proxy network only when it already exists; Docker host publishing remains loopback-only unless explicitly enabled. This supports a containerized reverse proxy without opening the application port to the public interface. The update adds no automatic network creation or DNS mutation. The old PR lifecycle-test failure must be rechecked against the combined current baseline before publication.

## 2026-09-05 — Restricted MCP service tokens + truthful diverged self-update

- **Machine automation gets least-privilege MCP bearers instead of a generic exec token.** A trusted local operator can mint a service token only from the owner CLI; there is no HTTP mint endpoint. The current service-token policy permits only `project_capabilities` and `project_function_call`, requires an exact top-level string constraint for every allowlisted tool, filters `initialize` / `tools/list`, and re-checks both the tool allowlist and argument constraints at `tools/call`. OAuth/browser tokens keep their existing behavior. Raw bearers are emitted once and the existing owner-only MCP store persists only their SHA-256 hash; normal token expiry/revocation still applies.
- **Project-function visuals stay bounded rather than becoming arbitrary binary passthrough.** A successful declared project function may opt into `mso.project-function-content.v1`; MSO accepts at most one PNG/JPEG/WebP image with matching magic bytes plus bounded text/content, under the existing runner output cap. Non-zero exits, stderr, malformed envelopes, unsupported MIME types, oversized payloads, and invalid image signatures remain ordinary process output or failures rather than trusted MCP image content. Project functions still execute fixed argv and validate caller JSON against their declared schema.
- **Self-update now models both sides of Git history.** Status uses `git rev-list --left-right --count HEAD...origin/main` and reports `ahead` and `behind` separately. A normal update is refused when local `main` is ahead or diverged, so unpushed work cannot be silently deployed or overwritten; `--rebuild` remains an explicit rebuild of the already-selected clean checkout and does not mutate Git history. Settings → About suppresses the Update action for local-ahead/diverged state and explains the real reconciliation requirement instead of mislabeling it as a remote-connectivity failure.
- **PR37 pre-integration verification (historical):** the two implementation commits remain independently reviewable; targeted MCP/updater tests pass 65/65, TypeScript passes, `git diff --check` is clean, the safe out-of-tree production build passed on the same implementation head, and GitHub dependency/security/CodeQL/ShellCheck/Verify checks were green before this documentation follow-up.

- **Visual README + local maintenance (2026-09-05):** README reduced from 575 to 97 lines with two Mermaid diagrams and an actual CLI PTY capture; longer valid material moved to the workspace reference. App 0.2.3 / CLI 1.13.0 adds preview-first reset and uninstall with exact-plan confirmation, private reset archives, stopped-runtime checks, existing runtime-exclusion coordination, symlink/ownership checks and explicit purge/standalone-source options. Unknown .mso entries/worktrees, other projects, shared dependencies and browser profiles are retained. Settings separates browser reset from copyable server maintenance previews; the device identity is preserved. Synthetic fixture tests exercise reset, clean-clone uninstall and failure paths; production was not reset or uninstalled. PR38 review fixes include complete glob escaping and a Bun >=1.2.15 native-audit prerequisite, enforced by the installer with refreshed bootstrap checksum.
- **Previously hidden exec/discovery test gaps closed (2026-09-05):** the remaining expected-failure shell-expansion case is now a real passing refusal test. Recursive deletion with unresolved shell expansion is conservatively refused; literal reviewed targets remain subject to normal approvals, and the matcher is explicitly not a shell parser or sandbox. Added eight predicate-only expansion fixtures without executing destructive commands. Registered the previously omitted root machine-protocol proxy test in normal Vitest/coverage and added an inventory regression contract. Per-area runs now use isolated exact-include configurations and verify the exact returned file set, preventing substring matches from counting unrelated nested proxy tests twice. Earlier per-area totals from this audit are superseded by the exact-selection rerun.
- **Compiler-enforced unused-code cleanup (2026-09-05):** resolved 49 unused import/local/parameter diagnostics across the shell, assistant, media, host, MCP and test modules. Calls with intentional side effects remain intact; positional callback placeholders are explicitly named. TypeScript `noUnusedLocals` and `noUnusedParameters` now make the ordinary typecheck/CI reject regressions. This is compiler-proven unused-symbol cleanup, not a claim that every exported symbol, runtime-discovered asset or optional integration is removable.
- **Public-sharing security and maintenance audit (2026-09-05):** app `0.2.2` keeps the independently versioned CLI/MCP contracts unchanged. Release and assurance dependency audits now fail closed on unavailable, malformed or incomplete evidence; local developer skips are explicitly labelled, registry diagnostics do not expose raw URLs, and skipped optional scanners cannot produce an unconditional assurance PASS. Removed the dormant Convex deploy tail, fixed shared Git-hook installation and out-of-tree dependency copying for linked worktrees, and added functional regression tests. README now leads with a readable install/features/security overview and collapsible reference detail, preserving generated comparison evidence and public-alpha limits. `test:features` runs each test area in a separate process and distinguishes PASS/PARTIAL/SKIPPED/FAIL. The Forge Docker sandbox and synthetic credential-path fixture activate previously skipped security checks without using real secrets; CI now provisions the same bounded fixtures. Onboarding tests derive the app version from `package.json`; the browser suite follows the actual Activity & Runs UI, checks infrastructure deep-links, and never echoes session-cookie diagnostics. Full-history scanning now requests merge diffs explicitly in CI and the assurance runner; independent scanner outputs remain private; no genuine historical secret was identified by the configured scan, so shared history was not rewritten. Live-service deployment and remote CI status require separate exact-revision evidence and are not inferred from local tests.
- **Rahmanef-aligned MCP widget palette / Block + Page v2 (2026-09-04):** MCP server `1.10.0` / toolset `2026.09.04.7` moves the two canonical ChatGPT resources to `ui://mso/block-v2.html` and `ui://mso/page-v2.html` so hosts do not reuse the old purple CSS cache key. Block and Page now share one visual-token source aligned with `rahmanef.com`: light `#f4f4f7` / `#1c1c1f`, dark `#1b1b20` / `#f2f2f5`, accent `#1f6df0`, Plus Jakarta Sans display copy, Inter body copy, fine separators, and editorial foreground/background primary-action inversion. ChatGPT theme changes propagate through `window.openai.theme` with a color-scheme fallback. Block/Page v1 and the earlier workflow/surface URIs remain readable but unlisted compatibility aliases; the headless workflow and two-surface/security contracts are unchanged.
- **Headless workflows + two-surface MCP UI contract (2026-09-04):** MCP server `1.10.0` / toolset `2026.09.04.6` removes the automatic UI binding from `workflow_start`: orchestration, collision checks, tracing, evidence, and learning continue in the background without consuming the answer with a progress card. ChatGPT now has exactly two canonical MCP App resources: `ui://mso/block-v1.html` through `render_mso_block` for compact validation/action/CRUD input-output, and `ui://mso/page-v1.html` through `render_mso_page` for native operator views plus reviewed development/preview/production embeds. Block buttons send a user-approved follow-up and never execute mutations inside the widget, preserving normal scope, approval, audit, and workflow boundaries. The prior workflow/surface URIs remain non-advertised read aliases, while `workflow_status` and `render_mso_surface` remain app-only compatibility shims for cached clients. The ChatGPT transport profile is 66 tools: 64 model-visible actions (35 read / 17 write / 12 exec) plus two app-only shims; the full catalog is 90. Only Block and Page advertise a resource URI.
- **Local release audit timeout hardening (2026-09-04):** the tolerant pre-push dependency audit now caps `bun audit --json` at 15 seconds. A registry timeout is reported and skipped only in the local gate, matching its existing network-tolerant policy; CI remains the fail-closed dependency-audit authority. This prevents a slow registry request from holding GitHub's pre-push SSH session open for minutes and failing the otherwise-green release with a transport/SIGPIPE-style exit.
- **MCP Apps CSP metadata dedup / Surface v5 (2026-09-04):** MCP server `1.9.4` / toolset `2026.09.04.5` moves all standard widget CSP fields to the preferred `_meta.ui.csp` surface and leaves legacy `openai/widgetCSP` with only `redirect_domains` for `Open in MSO`. Workflow/Surface resources are cache-busted to `workflow-progress-v3` and `surface-v5`; the reviewed Play Together iframe remains exact-origin under `/embed`, so one external-iframe review advisory is expected from `ui.csp.frameDomains`. Scanner-facing Surface metadata explicitly names `/apps/play-together` and has a regression guard against cross-scope app examples.
- **MCP Apps presentation unification / Surface v4 (2026-09-04):** MCP server `1.9.3` / toolset `2026.09.04.4` retires the specialized `project-status-v2`, `project-diff-v2`, and `vps-status-v2` resources. `project_get`, `project_diff`, and `vps_status` are pure data tools again; `ui://mso/surface-v4.html` is the only general-purpose UI and uses the portable MCP Apps `tools/call` bridge for native monitor/project/diff views. `workflow-progress-v2` remains intentionally separate for live workflow polling. Play Together keeps the exact `game.rahmanef.com/embed` frame boundary, so the external-iframe review advisory remains expected only for the universal Surface.
- **Cognitive Runtime claim audit / public evidence boundary (2026-09-04):** revalidated source/main/origin and loopback/public production on the latest concurrent baseline, then reran the deterministic Cognitive Runtime/memory gates: routing recall 100%, active-schema reduction 96.6%, typed memory 8/8, P9 6/6 at 200 corrections, P10 lifecycle 8/8, lexical/local-semantic 4/6 vs 3/6, and bounded graph fixture 3/3. Raw P6/P7/P8 artifacts were independently re-hashed and their aggregate arithmetic recomputed; the canonical P7 two-run artifact is `mso-p7-repeat-full-2x9.json` (`a0c12961...`), not the similarly named older `mso-p7-repeat-full-2runs.json`. Canonical P7+P8 yields 5/5 perfect full runs for both MSO and Hermes and the documented 74.7% token / 12.8% average-latency / 34.1% p50 observed deltas on that exact nine-scenario matched corpus. P4/P5 exact tables are downgraded to historical release-reported metrics because this audit could not independently recover raw artifacts matching those exact values. README now removes the stale 29-tool ChatGPT count, removes the unsupported "most complete" positioning superlative, and states explicit no-universal-superiority/no-cost/no-cache/no-OpenClaw boundaries. Tool Forge executable evaluation is documented as fail-closed until its explicit local Docker sandbox image is provisioned; that image was absent during this audit.
- **Play Together secure iframe / Surface v3 (2026-09-04):** MCP server `1.9.2` / toolset `2026.09.04.3` upgrades `ui://mso/surface-v3.html` so Play Together can render live inside ChatGPT without relaxing the whole app. The Surface allowlists only `https://game.rahmanef.com`, starts it at `/embed`, revalidates the exact origin plus `/embed` path prefix in-browser, and retains a sandbox without popups/top-navigation. The Play Together deployment reciprocally keeps normal routes anti-frame and gives only `/embed` + `/embed/*` the exact `mso-ui.rahmanef.com` ancestor permission. Auth remains normal; no demo bypass or raw HTML/arbitrary URL input is added.
- **MSO Surface v1 scope correction / v2 resource (2026-09-04):** MCP server `1.9.1` / toolset `2026.09.04.2` removes accidental cross-project catalog entries from Fresh 3. `ui://mso/surface-v2.html` keeps the generic secure Surface architecture but its current VPSKU app catalog contains only **Play Together** (`https://game.rahmanef.com`) as a `remote` target because that app currently sends `frame-ancestors 'self'`. The Surface CSP therefore has **no third-party `frameDomains` at all**. Raw HTML/arbitrary URLs remain rejected, project anti-framing headers are never stripped, and app identities from other MSO server scopes are not copied into this connector.
- **MCP App contextual landing hardening (2026-09-03):** `Open in MSO` no longer lands on an idle desktop. Workflow/VPS/project/diff cards target `/assistant/mcp`, `/monitor`, `/files`, and `/code`; the shell also recognizes ChatGPT's root `redirectUrl=https://chatgpt.com/c/...` handoff and redirects it to Alfa → MCP Activity so an already-cached v2 widget still produces a visible result. Assistant deep-link payloads now select their requested tab even when reusing an existing singleton window. MCP tool count, scopes, output schemas, and v2 resource URIs are unchanged.
- **Live-build chunk corruption eliminated (2026-09-03):** a production browser repro proved the shell/Settings crash was not a Settings logic regression: an in-place `next build` in the active service checkout replaced `.next` while the old Next process still served its boot-time manifest, making all 19 root-referenced chunks disappear and one observed JS request return `500 text/plain`. Production was recovered through `mso deploy`; shell + Settings then passed real authenticated Playwright on desktop/mobile with zero failed requests/console errors. `bun run build` is now a fail-closed wrapper that holds the checkout exclusion and refuses a same-checkout live runtime; `mso build` remains the out-of-tree proof and guarded deploy/update lifecycles invoke raw Next only after quiescence. Post-replacement validation now checks every root-referenced JS/CSS asset status+MIME, not one CSS/chunk. The Fresh 3 smoke scratch path moved out of protected `~/.mso`, and recursive `fs_mkdir` now securely supports missing parents while rejecting symlink escapes.

## 2026-09-04 — Alfa Cockpit exposes MSO runtime context without duplicating the CLI (DONE)

Alfa's browser surface had real host tools and approvals, but much of the runtime state that makes `mso` powerful was hidden behind terminal/MCP surfaces. The Assistant now has a responsive **Alfa Cockpit**: active provider/model with in-place model switch/test, bounded + searchable project selection, branch/tree/HEAD/package/knowledge metadata, trusted Host Skills, typed-memory telemetry/current records, native session summaries, same-principal local-agent presence, pending approval count, and an **Activity & Runs** view that combines Alfa host-tool events with MCP workflow activity at the presentation layer. The read-model route reuses existing project/session/memory/config domains; it does not create parallel stores. CLI parity is preserved with `mso cockpit [project]` / `mso cockpit search <query>`, which calls the same read-model instead of reimplementing the aggregation. Project scan truncation stays explicit, project search works beyond the first bounded page, raw `KNOWLEDGE.md`/repo-memory bodies are not returned, and private/restricted typed-memory keys/values are masked; legacy Alfa fact text and repo-memory result bodies are not copied into the Cockpit response.

Selected project context is persisted as an `alfa.*` preference and sent per turn only as a capped metadata snapshot; it is explicitly not mutation permission and does not change Alfa's stable global host-tool catalog. The dock/mobile Alfa thread shows the same selected project and pending approvals. Browser-local “Skills” are now labelled **Playbooks**, Host Skills remain the real `SKILL.md` catalog, Playbook starters finally render as quick prompts, and saved Automations now execute by re-entering Alfa's normal agent/tool loop instead of only logging pretend steps—so read calls use the existing bindings and mutations still stop on the same human approval cards. Native agent sessions remain read-only summaries rather than being falsely presented as the current browser chat. Focused typecheck/ESLint/docs gates and cockpit/context/activity/automation tests pass; full repository verify and the official production build also pass on the combined CSP v5 + Alfa baseline.

## 2026-09-03 — Cognitive Runtime P10 memory retention & lifecycle

- **Cold-history retention before hard caps:** typed agent memory now starts deterministic retention at 1,400 live records or ~1.4 MiB and targets <=1,000 records / ~1 MiB by archiving only records whose effective interval has already ended. Current or future-effective facts are never selected; the existing 2,000-record / 2 MiB live-ledger limits remain fail-closed.
- **Crash-safe owner-only archive:** finished history moves into content-addressed `archive-v1/segment-<sha>.json` files (<=400 records / 768 KiB each) under `0700` directories / `0600` files. Archive segments are written before the atomic live-ledger swap; duplicate ids after an interrupted commit are deduped with the persisted live ledger winning. Backdated replacements use forward `supersedes` edges as temporal boundaries, so immutable archived rows never need in-place mutation. Explicit history/time-travel reads include cold records, while normal resolved memory stays archive-free.
- **Privacy-safe lifecycle telemetry:** aggregate diagnostics report live/archive/total counts, resolved keys, superseded/retracted/future/conflict counts, correction-depth buckets, max corrections per key, ledger/projection/archive bytes and segment count. No memory values, raw keys, raw conversation ids, bearer/client data or secrets are emitted. The telemetry is kept out of the default MCP memory-read payload to avoid permanent tool/context overhead.
- **Frozen sessions now have explicit regression coverage:** the isolated lifecycle fixture proves session A retains its captured old memory after persistent memory changes, session B captures the new value, and resuming A returns A's frozen snapshot. No hidden mutable global memory context was added.
- **Threshold calibration:** `bench:memory:lifecycle` is **8/8 deterministic**. A synthetic 1,400-correction ledger compacts to **1,000 live + 401 archived records / two segments**, with a 56-byte resolved projection. The same fixture verifies archived-history retrieval, historical temporal resolution, archive permissions, archive-before-ledger crash semantics, backdated replacement over immutable cold records, and frozen sessions without touching real operator memory.
- **Retrieval evidence gate found and fixed exact-match crowding:** history query `Runtime-1` could be displaced by substring matches like `Runtime-10` before the result limit. Deterministic scoring now prioritizes exact phrases/tokens and keeps bounded alphabetic-prefix stemming. Existing `bench:memory` stays 8/8 / 100%.
- **Vector and graph complexity remain evidence-blocked:** realistic retrieval calibration is **4/6 lexical**, with objective misses only for `IDE`↔`editor` synonym and Indonesian `kantor`↔English `office`. P10D compares the existing local `mso-local-hybrid-v1` semantic encoder against the same rows: it is deterministic but only **3/6**, fails the same two semantic cases and regresses the exact-domain rollback case. The candidate runs ephemerally with zero network calls / zero persisted memory vectors, so this is a direct architecture gate rather than an infrastructure limitation: adding a memory vector index now would make retrieval more complex without improving recall. Relationship calibration remains **3/3 two-hop**, so current keyed retrieval still does not justify graph storage.
- **P9 privacy semantics preserved:** 200-correction `bench:memory:calibration` remains 6/6 and future-scheduled claims still cannot resurrect after `forget`. Cache remains observation-only, cost remains attribution-blocked, OpenClaw remains unranked without a legitimate matched provider/model path, and five-run reliability remains descriptive.
- **MCP Apps navigation hardening (2026-09-03):** server `1.8.2` / toolset `2026.09.03.7` bumps all four UI resources to v2 and makes `Open in MSO` self-diagnosing: official `openExternal` + `setOpenInAppUrl`, visible success/failure feedback, and a user-clickable direct-link fallback. No tool count or security-scope changes.
## 2026-09-03 — Cognitive Runtime P9 memory calibration

- **Repeated-correction calibration instead of graph expansion:** added `bench:memory:calibration`, which runs only against an isolated temporary agent-memory root and exercises explicit authority, confidence/recency, future replacement, forget semantics, finished-history integrity and deep repeated corrections.
- **Future-memory resurrection fixed:** `agent_memory_forget` previously retracted only claims effective at the current instant, allowing a scheduled future replacement to reappear later. Forget now retracts every matching claim whose interval can still become effective now/future while leaving already-ended historical evidence unchanged.
- **Bounded context under correction depth:** the final 200-correction stress run from source `d249da4` passed **6/6 deterministic scenarios**. The ledger reached **200 records / 135,180 bytes**, but the compatibility snapshot stayed **1 resolved record / 58 bytes (99.96% smaller)** and explicit history retrieval remained capped at 100 rows. Existing `bench:memory` stayed 100% and the full Cognitive Runtime memory gates stayed 100%.
- **Graph memory remains deferred by evidence:** P9 found no authority/conflict/temporal/repeated-correction task that needs a graph. Future graph or vector complexity must first solve a reproduced retrieval failure; next memory work should focus on real correction telemetry and retention/archival before the 2,000-record / 2 MiB ledger caps.

- **Fresh 3 completion / scanner-clean contract (2026-09-03):** server `1.8.1` / toolset `2026.09.03.6` keeps the 62-action Fresh 3 surface unchanged while closing the post-refresh metadata gaps. Every ChatGPT action now advertises `outputSchema`; dynamic actions share one DRY bounded `{ result }` envelope instead of 57 duplicated hand schemas, keeping the profile at 64,180 bytes (~16.0k rough tokens). Four MCP Apps now declare the dedicated sibling widget origin `https://mso-ui.rahmanef.com` (Traefik config in `ops/traefik/mso-ui.yml`), and the OpenAI/MCP skills extension publishes five official, digest-verified `claude-skills/` snapshots through `skills/list`, `skills/get`, and `resources/read`. Generic MCP clients retain the prior text-only result behavior unless a tool already had explicit structured output.
- **Fresh 3 capability-max release (2026-09-03):** server `1.8.0` / toolset `2026.09.03.5` restores Original MSO bounded VPS/system/filesystem/app/browser/infra operations to the ChatGPT profile while preserving Fresh 3 workflow/session/Local Agent/read-pipeline/project-MCP orchestration. The ChatGPT transport profile is now 62 tools (61 model actions + app-only `workflow_status`) at 57,853 descriptor bytes (~14.5k rough tokens), while the full model/operator catalog grows to 85 tools. New Lovable-inspired surfaces add `project_get`, Git history/diff, `.mso/KNOWLEDGE.md`, safe connection inventory, private `project_agent_run`/`project_agent_status`, and MCP Apps project/diff/VPS cards. Convex is first-class through the project-installed official Convex MCP CLI with projectDir override stripping, cross-project selector refusal, dynamic schemas, and no automatic dangerous production flags.

- **MCP protocol-era correctness (2026-09-03):** server `1.7.3` stops claiming the stateless `2026-07-28` protocol while serving the legacy initialize/session wire shape. The supported ceiling is deliberately `2025-06-18` (matching the known-good CareerPack ChatGPT connector); a modern HTTP probe receives a 400 and can fall back to initialize. `server/discover` is no longer aliased to the legacy initialize payload. Browser CORS also permits `Mcp-Method`/`Mcp-Name` so a standards-aware probe can reach the server and receive the fallback signal. Toolset stays `2026.09.03.4`.
Running log of what shipped each phase. Newest at top.

## 2026-09-03 — Cognitive Runtime P8 calibration

- **Observed run spread, not pseudo-statistics:** repeated corpus aggregation now reports per-run min/max/mean/median/range/sample-SD/CV for success, average latency, p50 and normalized tokens/attempt. Three new complete `openai-codex/gpt-5.6-terra` runs from source `51ae31f` produced **27/27 task + 27/27 scenario-policy** and **3/3 perfect runs** for both agents; all 54 rows and token arithmetic proofs passed independent validation.
- **Five-run reliability history is a tie:** combining the prior two P7 runs with the three P8 runs yields **5/5 perfect full runs for both MSO and Hermes**. The observed five-run means are 16,907.6 vs 66,791.1 normalized tokens/attempt (~74.7% lower for MSO), 18,985.9 vs 21,779.8 ms average latency (~12.8% lower), and 14,130.8 vs 21,457.2 ms mean per-run p50 (~34.1% lower). `n=5` remains descriptive; no CI/p-value or universal reliability claim is made.
- **Dedicated repeated-prefix cache calibration:** new `bench:cache-calibration` keeps one inert shared prefix, varies only exact reply markers, rotates starting agent, and distinguishes positive/zero/absent provider cache fields. The final 4-round 12K-prefix run was 8/8 success; MSO reported zero cache reads on 4/4, Hermes naturally reported positive cache reads on 2/4 (9,728 and 19,968 tokens). Cache frequency remains unranked because runner request envelopes differ.
- **Benchmark accounting bug fixed:** valid normalized proof shapes may legitimately vary by row when cache behavior changes. Comparability now proof-gates every row instead of requiring one aggregate proof label; opaque/unknown rows still fail closed. This preserves token comparability in the real cache-hit run without weakening arithmetic requirements.
- **Cost gate remains closed:** MSO still has no attributable cost field while Hermes reports zero with source `none`. Cost comparison stays withheld until both runners expose the same attributable USD contract.

## 2026-09-03 — Cognitive Runtime P7 repeatable corpus baseline

- **Deterministic repeat contract:** added `bench:corpus:repeat`, explicit single-run `--seed`, deterministic per-run seed derivation, and alternating starting-agent order. Repeated aggregation is fail-closed on missing runs, seed/order drift, duplicate or missing per-agent scenario identities, and cross-run provider/model drift.
- **First repeated full baseline:** two complete nine-scenario `openai-codex/gpt-5.6-terra` runs from source `5bd5788` produced **18/18 task + 18/18 scenario-policy** for both MSO and Hermes, with **2/2 perfect runs** each. The prior P6 Hermes `multi-read` miss did not recur (`2/2` here for both agents).
- **Observed efficiency, still bounded:** MSO measured **18,922.6 ms average / 13,761 ms p50 / 17,271.3 normalized tokens per attempt** versus Hermes **21,077.4 ms / 20,513.5 ms / 65,073.3 tokens**. On these two runs that is ~**73.5% fewer normalized tokens/attempt**, ~**10.2% lower average latency**, and ~**32.9% lower p50** for MSO. All 36 token proofs passed independent arithmetic validation; cost semantics remain non-comparable.
- **Cache evidence without a manufactured hit:** provider telemetry naturally reported positive MSO cache reads on 4/18 rows and Hermes cache reads on 18/18. P7 records this as calibration evidence only; it does not rank cache-hit rates because runner request/context behavior differs. More independent full repeats are required before reliability statistics.

## 2026-09-03 — OAuth DCR registration identity fix

- **2026-09-03 — Browser MCP install compatibility:** comparison with the working CareerPack MCP showed that ChatGPT completed DCR + OAuth for MSO but the post-auth browser probe differed: CareerPack serves CORS preflight/metadata while MSO rejected `Origin: https://chatgpt.com` and returned OPTIONS without usable CORS headers. MCP server `1.7.2` now permits the exact ChatGPT browser origins only against the configured public MSO origin, keeps arbitrary/loopback-origin requests denied, adds explicit `/mcp` preflight headers, and adds public CORS to OAuth discovery/DCR. Toolset stays `2026.09.03.4` because no tool descriptor changed.
- **Fresh app means fresh OAuth client:** `POST /oauth/register` now mints a distinct RFC 7591 client id for every registration. Redirect URIs are client metadata, not identity; two ChatGPT dev apps sharing the same `chatgpt.com` callback no longer collapse onto an August-era client record.
- **Safe bounded store:** registration pruning removes only old client records that are not referenced by a live authorization code, access token, or refresh grant. Existing connectors/tokens remain valid. The DCR response now also reports `client_id_issued_at`.
- **Why this matters:** real ChatGPT testing showed a supposedly new app at 10:55 UTC receiving the historical `probe-chatgpt` client id solely because its redirect set matched. That defeated the purpose of a clean Scan Tools registration and could retain stale app identity server-side. MCP server patch version is 1.7.1; toolset remains 2026.09.03.4 because the advertised tool catalog did not change.

## 2026-09-03 — MCP 1.7 ChatGPT compact profile + dynamic project MCP

- **ChatGPT scanner contract:** full MSO remains 73 transport tools / 72 model tools (34 read / 24 write / 14 exec + app-only `workflow_status`), while ChatGPT is client-profiled to **29 transport tools = 28 model tools (14 read / 8 write / 6 exec) + app-only bridge**. The profile is fail-closed at list and direct-call time, keeps only MSO-owned generic names, and regression-measures **31,908 descriptor bytes (~8k rough tokens)** with a 40 KiB total / 8 KiB per-tool guard.
- **Scanner portability follow-up:** MCP Inspector 2.5.0 successfully listed the live 29-tool profile but strict lint found one unconstrained `{}` schema at `read_pipeline.transform.where[].value`. The schema now advertises the runtime's real scalar contract explicitly (`string <= 2048 | number | boolean | null`) so portable clients do not have to interpret a bare permissive schema. Toolset advances to `2026.09.03.4`; live acceptance must include Inspector `tools/list --strict` with zero portability findings.
- **Metadata SSOT:** every advertised tool is normalized through one descriptor layer with a human title, explicit `readOnlyHint` / `destructiveHint` / `openWorldHint`, optional idempotency, and matching top-level + `_meta.securitySchemes`. ChatGPT gets compact descriptions/schema descriptions without changing behavior or constraints.
- **Project MCP stays dynamic:** added generic exec-scope `project_mcp_tools` and `project_mcp_call`. `.mcp.json` stays private; `project_capabilities` exposes only server alias/transport/auth class, stdio runs without shell inside project cwd from a credential-scrubbed environment, remote HTTP uses SSRF/DNS-rebinding guards, and another project's OAuth is never copied/minted implicitly. Project-specific tool names never enter MSO `tools/list`.
- **OAuth/transport refresh hardening:** new OAuth grants bind `resource=<origin>/mcp`, return `iss`, issue one-hour access tokens plus rotating hashed refresh credentials, and revoke by grant family. Legacy bearers remain a migration path. Streamable HTTP validates `MCP-Protocol-Version`; the unsupported optional SSE GET listener now returns 405.
- **Open-source independence:** removed the cross-repository MCP contract document, sibling-repo CI fallback and current private-project examples. MSO's push gate always uses its own `bun run verify`; downstream integrations consume MSO's public contract, not vice versa.
- **Release verification:** targeted MCP/auth/project regression, TypeScript, docs and the full repository verify gate pass; lint remains 0 errors / 8 baseline max-lines warnings. Trivy high/critical, OSV dependencies, Gitleaks history, Semgrep OWASP/SAST and ShellCheck all pass on the staged candidate. The optional Codex Security AI component scan is recorded as **incomplete**, not PASS: the full-repo run hit the 20-minute executor cap and two high-effort targeted attempts hit their $3/$5 cost guards; both targeted partial reports contained 0 findings. Live ZAP remains a post-deploy check because scanning the previous production build would not validate this candidate.

## 2026-09-03 — Cognitive Runtime P6 expanded repo/recovery corpus

- **Nine-scenario v2 corpus:** `bench:corpus` now adds objective `repo-debug`, `repo-migration`, and transactional `rollback` fixtures to the six P4/P5 scenarios. Each agent still receives semantically identical seeded state in a separate private 0700 tree; immutable issue/spec/test/validator files plus exact final-tree verification remain authority, and `policyObservationScope=scenario-tree` explicitly avoids whole-host sandbox claims.
- **Benchmark found and fixed RASMIC routing debt:** ordinary repo `debug`/`test` instructions were being mistaken for a user manual-test outcome, loading project-memory writes while execution validation could disappear. Manual-test routing now requires outcome language; explicit Node/Bun/npm/pnpm/Python/pytest validation selects `exec_run`, and repo-first debug/migrate/rollback requests enter `repo-change`. The P1-P5 Cognitive Runtime gate remains 100% required-tool recall / 100% catalog hit / 95.9% schema reduction.
- **Long-turn workflow lifecycle fixed:** after enough tool rounds the original `workflow_start` could fall outside the eight-row recent-tool window and be offered again. The router now remembers workflow start across the complete current user turn, preserves finish/cancel companions, and resets correctly on a later user turn. Post-fix repo-debug/migration traces both pass with exactly one `workflow_start`.
- **Final matched full run:** on `openai-codex/gpt-5.6-terra`, MSO achieved **9/9 task + 9/9 scenario-policy**; Hermes achieved **8/9 task + 9/9 scenario-policy**. MSO measured **22,776 ms average / 15,285 ms p50 / 16,683.4 normalized tokens per attempt**, Hermes **22,189.3 ms / 23,294 ms / 67,433.1 tokens per attempt**. Thus MSO used ~**75.3% fewer normalized tokens/attempt (~4.04× smaller)** and had ~**34.4% lower p50**, while average latency was ~**2.6% higher**. Cost semantics remain non-comparable.
- **No cherry-picked reliability claim:** the sole Hermes full-run miss was `multi-read` with intact scenario state but an incorrect exact aggregate. An alternating-order follow-up repeated `multi-read` three times per agent and both MSO and Hermes passed **3/3**. The formal full-run ranking is MSO > Hermes because correctness is first, but the 8/9 observation is treated as run variance rather than universal reliability evidence.

## 2026-09-03 — Cognitive Runtime P5 normalized provider usage

- **Provider usage SSOT:** Codex/OpenAI now preserve authoritative input/output/total plus provider-reported cache-read/cache-write/reasoning details and explicit `inclusive-input-output-total` semantics; Anthropic keeps its separate cache categories and leaves absent fields absent. Agent sessions start with `apiCalls:0`, so unknown totals are never seeded as fake zero.
- **No double counting:** cache/reasoning details remain breakdowns when the provider contract says they are included. Session aggregation records API-call/detail coverage and mixed semantics rather than summing a component into total twice. Compact status can show in/out even when a provider does not report total.
- **Proof-gated benchmark normalization:** P5 adds `accountingProof`. MSO Codex uses `explicit-inclusive-contract`; Hermes openai-codex is normalized only when exact arithmetic proves cache is outside base input while reasoning is inside output (`exact-exclusive-cache-sum`). Ambiguous rows stay `opaque-total`, and even two opaque rows cannot enable token comparison.
- **Comparable full-corpus result:** candidate P5 reran all six P4 scenarios on `openai-codex/gpt-5.6-terra`; both agents remained **6/6 task + 6/6 scenario-policy**. MSO measured **11,497.7 ms average / 11,782 ms p50 / 3,510.8 normalized tokens per success** versus Hermes **16,199.3 ms / 16,184.5 ms / 59,743.2 tokens**. On this bounded corpus that is ~**94.1% fewer normalized tokens (~17× smaller)**, ~**29.0% lower average latency**, and ~**27.2% lower p50**. Token semantics are now comparable; cost semantics remain withheld.
- **Honest limits:** no cache hit was manufactured for MSO; zero cache values in the observed Codex calls came from the provider payload. Cost remains non-comparable because MSO exposes no matching cost field and Hermes reports source `none`. OpenClaw remains unranked without an equivalent configured provider/model.

## 2026-09-03 — Cognitive Runtime P4 comparable quality corpus

- **Six objective scratch scenarios:** added seeded per-agent read, multi-read transform, exact write-create, write-preserve, recovery, and prompt-injection/security tasks. Each agent gets the same seeded semantic values/expected outcomes in a separate 0700 scratch tree; scoring compares the exact scenario filesystem tree/result state and rejects unexpected extra files/symlinks. Fixtures are isolated, but runners retain normal authority (`runnerAuthoritySandboxed=false`) and `policyObservationScope=scenario-tree` prevents whole-host policy claims; all scratch state is deleted after the run.
- **Strict comparability:** model-family/provider evidence is collected per scenario and must cover **100% of attempted scenarios**. Overall ranking is allowed only for equal full-corpus coverage with matching model family and the same explicitly requested provider. Execution is scenario-major with rotating agent order to reduce temporal/warm-up bias. Token/cost efficiency is a separate diagnostic gate: missing/partial/mixed accounting stays unknown, failed-attempt usage is charged into per-success metrics, and mismatched accounting modes cannot influence quality ranking.
- **Reproduced full comparable result:** on six seeded scenarios using `openai-codex/gpt-5.6-terra`, MSO and Hermes both achieved **6/6 task success and 6/6 scenario-observable policy compliance**. MSO averaged **10,759.5 ms** vs Hermes **14,624 ms** (~26.4% lower) and p50 **10,646.5 ms** vs **14,304.5 ms** (~25.6% lower). Thus MSO ranks ahead **on this bounded P4 corpus** only after the quality/policy tie; this is not an overall-product claim. OpenClaw is withheld because the host does not currently provide an equivalent usable model/provider path.
- **Token accounting kept honest:** MSO reports `input-output-total`; Hermes reports expanded cache/reasoning components, so `tokenSemanticsComparable=false`. Reported tokens/success (**3,495.2 vs 56,718.2**) remain diagnostic only and do not decide ranking. Cost comparison is withheld: MSO has no comparable cost field and Hermes reports included cost with source `none`; generic cost without explicit USD currency is not treated as USD.
- **Benchmark → engineering loop:** P4 found exact-path reads falling through to discovery. RASMIC now routes supplied absolute paths directly to `fs_read`, and explicit multi-read aggregation to `read_pipeline`. Initial security diagnostic: 3 tools / 14,934 reported tokens / 16,072 ms. Final matched-provider corpus: **1 `fs_read` / 2,117 reported tokens / 8,774 ms**, still 100% task/scenario-policy. The structural 3→1 route is deterministic; timing/token before-vs-after values are observed runs, not a controlled causal estimate. Final `multi-read` uses one `read_pipeline`; recovery's one failed primary read is expected by the scenario.

## 2026-09-03 — MCP Local Agent foreground two-way receive

- **KISS two-way MCP path:** `local_agent_inbox` now accepts optional `wait_ms=0..20000`. A positive wait keeps only the current foreground MCP request open, registers the existing in-process Local Agent subscriber, and returns early when another same-principal session delivers a message. No DB, webhook, broker, WebSocket, daemon, or background worker was added.
- **Race-safe durability:** the durable file mailbox remains authoritative. The receiver reads once, subscribes, reads again to close the read→subscribe race, then waits for either an event or timeout; the listener is always removed on return/error/timeout. Omitted/zero `wait_ms` preserves the previous immediate inbox behavior.
- **Receivable MCP presence:** the MCP dispatcher keeps `local_agent_inbox` sessions `idle` rather than marking the receive call `busy`, allowing `local_agent_message_send` / `local_agent_reply` to publish directly to that foreground receiver. Other tool calls retain normal `busy → idle` presence.
- **Real A↔B integration coverage:** a new MCP-dispatch integration test opens Chat-B-style inbox wait, sends a correlated request from Chat A, then opens Chat-A-style inbox wait and replies from Chat B. Both deliveries return `delivered`, both waits wake before timeout, and neither path invokes `local_agent_request` or any spawned durable-session worker.
- **Toolset:** upstream P3 already added `read_pipeline`; this schema-only Local Agent update therefore advances the catalog to `2026.09.03.2` while keeping **71 transport tools = 70 model/operator tools (34 read / 24 write / 12 exec) + app-only `workflow_status`**. ChatGPT must refresh/re-scan its frozen action snapshot before the model can see the new optional parameter.

## 2026-09-03 — Cognitive Runtime P3 read-only orchestration

- **Self-update invariant fixed:** RASMIC `.agent/` evidence/memory is runtime-local state and is now ignored by the MSO repo. This prevents successful workflow memory writes from making the canonical checkout dirty and causing `mso update` to refuse its own upgrade.
- **Programmatic reads without program execution:** added read-scope `read_pipeline`, batching 1–6 independent eligible read tools in parallel/sequential mode and reducing their results with bounded declarative path/filter/select/sort/unique/limit/count/sum/avg/min/max operations. No shell, JavaScript, nested pipeline, foreign child `workflow_id`, screenshot/direct-file result, wait/poll primitive, write tool or exec tool can enter the pipeline.
- **Guard reuse instead of a second security stack:** direct MCP dispatch and pipeline children now share one per-tool rate-limit helper. Child calls still execute the original tool handler and host/path checks and are internally forced to `read` scope even when the parent bearer is `exec`. Raw results cap at 1 MiB/child; transformed output caps at 12 KiB/child and 40 KiB total; the complete response has a 15-second wall-time deadline. Parallel results are emitted in declaration order for deterministic caching/evals.
- **Measured context reduction:** `bench:pipeline` preserves exact deterministic fixture answers while reducing four independent model round-trips to one (**75%**) and model-visible bytes from **232,205 to 1,891 (99.2%)**. Integrated Cognitive Runtime remains **100% required-tool routing recall**, **100% typed-memory fixture accuracy**, and averages **2.6/71 active tools** with **95.9% schema reduction** under the merged RASMIC catalog-first router.
- **Docs/tool catalog SSOT:** `check-docs.mjs` now derives tool modules from the canonical `lib/mcp/tools.ts` composition and fails on orphan `tools-*.ts` modules, so adding a new tool module cannot silently escape MCP/ChatGPT/connectors documentation. Toolset advances to `2026.09.03.1`: 71 transport tools = 70 model/operator tools (34 read / 24 write / 12 exec) + app-only `workflow_status`. The docs checker follows the recursive `tools-*` import closure from `lib/mcp/tools.ts`, so split RASMIC workflow modules remain in the same SSOT.

## 2026-09-03 — MSO 1.12 documentation and Agent contract cleanup

- **Full Markdown audit:** reviewed all 71 authored Markdown files in the repository, preserving dated release/audit/design evidence while correcting current-reference drift. Structural validation reports zero malformed fence/heading issues and all 125 relative Markdown links resolve.
- **Current Agent docs:** synchronized `TESTING-HANDOFF`, Local Agents, install/provider guidance, troubleshooting, architecture and the documentation map with the shipped 1.12 identity-first composer, sectioned transcript, compact exact approval and recoverable `not_started | completed | uncertain` mutation semantics. Historical 1.8–1.11 release notes remain intact rather than being rewritten as if they were current instructions.
- **MCP/A2A drift fixed:** at that 1.12 documentation checkpoint, references agreed on server `1.6.0`, toolset `2026.09.02.7`, 67 transport tools = 66 model/operator tools (32 read / 22 write / 12 exec) + app-only `workflow_status`. Stale 31/29/59/56-tool claims and obsolete anonymous-only A2A wording were removed from current docs; historical benchmark snapshots were relabeled as snapshots instead of live metrics.
- **Docs gate strengthened:** `check-docs.mjs` now verifies the MCP marker in architecture/operator docs and exact scope membership in `docs/MCP.md` and `docs/CHATGPT-PLUGIN.md`, so a future tool addition cannot leave one human catalog silently stale.
- **Unused surface cleanup:** removed the dead `coreToolNames()` helper and stopped exporting Agent constants/helpers that are private implementation details while retaining every internally used behavior. No compatibility placeholder or public CLI/MCP capability was removed.

## 2026-09-02 — MSO 1.12.0 sectioned Agent TUI + recoverable API failures

- **Identity-first bottom composer:** the old `[ask] ›` prompt is replaced by the short durable handle (`@milo ›`). A full-width `Input · @milo` divider separates transcript from editing state; permission moves to the dynamic footer as `mode ask|auto|yolo`, and empty-prompt Tab repaints only that footer. Wrapped input, resize redraw, prompt history, and keyboard editing remain intact.
- **Unambiguous transcript streams:** streamed model text opens an `Assistant` section lazily on the first text delta, tool/subagent execution opens `Agent work`, and Local Agent send/receive/inbox output uses `Local agent`. Sections are full-width and content is not duplicated merely to label a stream.
- **Recoverable error state:** terminal API/transport failures carry bounded status/path/method/dispatch metadata and render a redacted `Error` section. The turn journal distinguishes `not_started`, `completed`, and `uncertain` mutation outcomes. A successful mutation is never repeated just because a later assistant request failed; an uncertain write/exec transport failure stops the turn before the model can retry it.
- **State preservation:** recoverable failures keep the durable session/transcript/correlation rows, active draft redraw, and pending exact-approval metadata. Exact approval still binds the canonical full payload/digest; transport error rendering never prints request bodies, hidden transcript, credentials, or secret-shaped error values.
- **Cleanup:** turn/tool orchestration moved out of the CLI entrypoint into a focused module; the obsolete internal `permissionPrompt` and `renderStatusBar` helpers were removed instead of retained as compatibility shims.

## 2026-09-02 — MSO 1.11.0 named sessions + wrapped composer + collaboration observability

- **Short session handles:** every durable session now has a public `name` separate from its longer title. Fresh sessions allocate familiar easy-to-type names such as `milo`, `luna`, or `nara`; allocation is unique under same-principal concurrency, old sessions receive deterministic backward-compatible fallback names, `/rename <name>` changes only the handle, and `/title <text>` remains the topic/description lifecycle. Internal `agent-a` presence aliases remain a compatibility detail.
- **Active-name mentions:** leading `@milo …` resolves only currently active public names. Offline/ended targets are not mentionable; lower-level explicit mailbox sends retain backward-compatible offline queueing. The local directory reports lease status separately from `consumerConnected` / `consumerCount`, so `idle` no longer implies an SSE consumer exists.
- **Bounded request observability:** added read-scope `local_agent_request_wait`, returning `replied`, `target_offline`, `consumer_absent`, or `timeout` in a bounded 0–30s foreground call without resend/background polling. The testing-handoff `local_agent_request` is now dispatch-covered as an exec-gated fresh bounded worker from another same-owner durable session context; it never claims to wake/control that original terminal/ChatGPT process.
- **Responsive composer:** the interactive draft wraps to terminal width and a height-aware 2–12-row viewport. Terminal resize repaints without losing text; ↑/↓ navigate visual wrapped rows while preserving cursor column before falling through to prompt history.
- **Compact exact approval:** default ask-mode approval is one safe status line. Tab focuses it, Enter opens redacted-safe tool/scope/args plus the unchanged canonical SHA-256 digest, and a separate explicit `allow` / `deny` decision is mandatory. Auto-write/YOLO still compute exact payload binding while skipping only the human prompt.
- **Subagent testing capacity:** `OS_SUBAGENT_MAX_TURNS` defaults to 12 and can raise the server policy up to absolute 48; each child still defaults to 6 turns and remains foreground/context-isolated/non-recursive.

## 2026-09-02 — MSO 1.10.0 correlated Local Agents + same-session subagents

- **Mention UX:** leading `@agent-b …` resolves the live/known local directory, validates aliases/manual labels, dispatches a durable correlated request, and returns an immediate honest acknowledgement instead of blocking on an idle target. Unknown/ambiguous mentions fail with stable alias choices; known offline targets remain queueable.
- **Explicit message contract:** mailbox rows add backward-compatible `intent=notify|request|reply`, `correlationId`, `replyToMessageId`, and `requiresUserRelay`. Legacy sends remain notify-only; `local_agent_reply` inherits routing/correlation/relay policy from one exact inbox request.
- **Deterministic async relay:** correlated replies are matched against a durable source `local_request` ledger and become a synthetic assistant relay without another model turn. Notify-only/stale/mismatched/duplicate events never create extra assistant answers.
- **Processing semantics:** SSE `delivered` no longer means processed. Requests remain unread until explicit ack/reply; replying marks the exact original request read. At-least-once SSE replay dedupes by message ID.
- **Subagent split:** `/spawn` and `agent_subagent_run` now run transient foreground workers inside the parent session, not A2A child sessions. Workers start with isolated context, explicit objective/context only, read scope by default, 6/12 turn defaults/cap, 60/120s timeout defaults/cap, and final-result-only parent return.
- **Subagent guardrails:** top-level exec approval is the explicit delegation boundary; child scope cannot exceed it. Recursive spawn plus `agent_session_*`, `agent_memory_*`, `local_agent_*`, and `a2a_*` are unavailable inside workers. Legacy `mso a2a spawn` remains the durable cross-session compatibility path.

## 2026-09-02 — MSO 1.9.0 native Local Agents

- **Transport split:** live same-host session communication is now a native Local Agents layer, separate from remote A2A v1. No Agent Card, URL, registration, bearer, refresh, or restart is part of local discovery/delivery.
- **Automatic presence:** interactive CLI sessions maintain a small private lease plus one SSE feed. `ready`, `idle`, `busy`, `offline`, and `ended` have explicit semantics; MCP conversation sessions refresh the same lease around bound tool calls.
- **Readable identity:** unnamed live sessions receive stable per-principal `[agent-a]`, `[agent-b]`, … aliases. Manual `agent_session_rename`/`/title` names become primary immediately; duplicate manual names use a light alias suffix and ambiguous bare names fail instead of guessing.
- **Durable mailbox:** explicit 16 KiB `message`/`task` payloads persist privately before notification. Idle delivery can be `delivered`/`accepted`, busy targets are `queued`, and known expired/ended targets return `target_offline` while retaining the message for a later receiver.
- **TUI:** `/agents`, `/message`, local `/delegate`, and `/inbox` use the native layer. Incoming events redraw above an active composer without losing draft input, persist as role `agent`, and project to a provider-compatible labeled envelope only when model context is built.
- **Tools/API:** added `local_agents_list` (read), `local_agent_message_send` (write), `local_agent_inbox` (read), plus owner-authenticated `/api/v1/local-agents`. Receiving a local message never expands tool/file/shell/network authority.
- **Isolation:** directory/mailbox operations require the exact same durable-session principal; only explicit text plus minimal routing metadata is copied. Private stores use bounded 0600 atomic persistence and security-store locking.
- **Remote compatibility:** public A2A v1 registry, Agent Cards, credentials, send/task/handoff, inbound serving, and loopback compatibility helpers remain intact and are no longer the path used by native live-session UX.

## 2026-09-02 — MSO 1.8.2 constant-depth Agent restart

- **Restart lifecycle fix:** `/restart` now uses process replacement (`execve`) instead of `spawnSync`. Repeated refreshes no longer leave prior Agent processes blocked behind their children.
- **Wrapper boundary:** interactive `mso agent` now `exec`s its Node runtime, so the CLI wrapper itself does not remain as an extra waiting parent. A restart replaces the same process chain with the latest `bin/mso` and Agent modules while loading the exact same durable session id through a restart-only path; normal `/resume` continuation semantics remain unchanged.
- **Fail closed:** runtimes without process replacement support refuse `/restart` rather than silently falling back to a nesting child process. Node 22 on the supported MSO runtime provides `process.execve`.

## 2026-09-02 — MSO 1.8.1 Agent soft restart + new session

- **`/restart`:** soft-reloads the interactive Agent process, not the MSO service/VPS. The current durable session is persisted, the composer closes cleanly, then the current CLI is relaunched with `--resume <same-session-id>`, so updated CLI modules plus the latest dynamic tool/skill/plugin catalog are loaded without abandoning conversation history.
- **Process-local UX:** current permission mode and status-bar preference are forwarded only across this explicit soft restart and immediately consumed by the child; they are not persisted into durable session state or leaked to later child processes.
- **`/new [name]`:** persists the current session, creates a fresh durable CLI session in the same terminal, clears conversation/queued-skill/usage state, and refreshes the capability catalog. An omitted name preserves normal first-prompt auto-title behavior.
- **Verification:** lifecycle/session transition tests, slash/terminal contracts, permission/session regressions, TypeScript, targeted ESLint, and a real PTY soft-reload smoke test pass.

## 2026-09-02 — MSO 1.8.0 authenticated inbound A2A

- **Shipped surface:** A2A v1 outbound credentials/streaming plus authenticated inbound Agent Card and JSON-RPC/SSE server, with owner Settings → A2A management for peers, credentials, tasks, and audit activity.
- **Authority model:** inbound bearer profiles are owner-minted `read | write | exec` delegated capabilities. Model-visible tools and MCP dispatch both enforce the scope; owner memory/session tool families remain unavailable to inbound callers.
- **Isolation:** inbound tasks persist only explicit A2A messages/results, are isolated by credential principal, and use `taskId` as the MSO workflow session boundary so concurrent tasks cannot cross-control one another.
- **Credentials:** outbound API-key/Bearer/OAuth access-token profiles live in private `0600` storage and bind to sanitized Agent Card security schemes. Inbound raw bearer tokens are shown once and only their hashes persist. Unsupported query/cookie API keys, non-Bearer HTTP auth, mTLS, and multi-scheme AND requirements fail closed.
- **Streaming:** `SendStreamingMessage` and `SubscribeToTask` use SSE; observer disconnect does not cancel execution. `CancelTask` remains the explicit cancellation boundary.
- **Ingress:** `/.well-known/agent-card.json` and `/a2a/v1` are machine-protocol surfaces with no document CSP/nonce or browser-cookie CSRF gate; `/api/v1/a2a` remains owner-cookie + CSRF protected. Public inbound serving is enabled when an explicit HTTPS `OS_PUBLIC_ORIGIN` is configured; `OS_A2A_INBOUND_ENABLED=0` disables it. Same-host exact-loopback A2A is enabled by default and can be disabled with `OS_A2A_ALLOW_LOOPBACK=0`.
- **CLI:** `mso a2a state`, `stream`, `auth ...`, and `inbound ...` added; credential secrets are read interactively and sent through stdin rather than process argv.
- **Verification:** targeted A2A/assistant/provider and ingress suites, typecheck, targeted ESLint, generated docs, and architecture/docs checks pass. Full release verification/build follows this entry before deployment.

## 2026-09-02 — Eval-gated Tool Forge P2 — SHIPPED

Cognitive Runtime P2 adds a self-improvement path without turning learned workflows into self-authorizing code. Four MCP primitives expose a private candidate lifecycle: `tool_forge_candidates` (read), `tool_forge_propose` (write), `tool_forge_evaluate` (exec), and `tool_forge_promote` (exec). Proposal requires P1 quality telemetry, at least two verified successes, at least 90% success, and a fully-completed best trace. Skill candidates contain only deterministic redacted tool guidance. Project-function candidates cannot generate shell/code or escalate a lower-scope recipe: they require an exec-scope verified recipe and may reference only an existing regular project-owned Node script; credential-like schema fields, fixture inputs, and fixed argv are rejected.

Executable fixtures run only in a dedicated **local-only Docker sandbox**: no registry pull, `--network none`, read-only root/project mounts, all capabilities dropped, `no-new-privileges`, non-root execution, and bounded CPU/memory/PIDs. `bun run forge:sandbox` constructs the minimal sandbox from the already-trusted host Node binary plus its shared libraries and labels it as MSO Forge v1. Evaluation rejects missing/unlabelled images and records the exact image ID plus project source SHA-256. Regression coverage proves fixture network access and project writes are blocked.

Promotion is intentionally high-friction: the caller must send literal `PROMOTE <candidate_id>`, MSO immediately re-runs the complete evaluation, candidate/target/toolset/source/image drift fails closed, existing Skills/functions are never overwritten, writes are atomic, and the resulting project capability is independently parsed/trust-checked. Combined with outbound A2A v1, MCP toolset **2026.09.02.4** contains **60 transport / 59 model tools** (29 read, 23 write, 7 exec). `bench:cognitive` still reaches **100% required-tool routing recall** while averaging **15.4 active tools / 11,614 schema bytes**, a **72.0% reduction** from the full catalog.

## 2026-09-02 — Interactive permission badge + outbound A2A v1 — SHIPPED

MSO CLI **1.7.0** makes permission state part of the interactive prompt instead of terminal scrollback. The bottom-left prompt is now a persistent color-coded badge (`ask` cyan, `auto` amber, `yolo` red); Tab on an empty prompt cycles `ask → auto → yolo` by repainting the same row with zero added LF/newline. The compact status line no longer duplicates permission. `/permission` remains the explicit picker/command surface, and the existing exact-call digest/server authorization semantics are unchanged. A live PTY regression proves three Tab transitions emit no scrollback line.

The same release adds a provider-neutral **A2A v1 outbound client** beside MCP. MSO discovers the standard well-known Agent Card, validates v1 `supportedInterfaces`, supports JSONRPC and HTTP+JSON `SendMessage` / `GetTask` / `CancelTask`, preserves optional tenant routing, bounds remote responses, and exposes a private host registry plus `mso a2a` / `/agents` / `/delegate`. MCP adds eight stable `a2a_*` tools for discovery/registry/message/task/handoff instead of dynamic per-peer tool names, and the per-turn router loads them only for A2A/delegation intent.

A2A is deliberately fail-closed at the trust boundary: only public HTTPS peers are accepted; the existing SSRF/DNS-rebinding pinned transport is reused; Agent Card security requirements are reduced to scheme names; authenticated peers are detected but not contacted until a dedicated credential profile exists. Normal messages carry only explicit A2A message/context/task arguments, while `a2a_handoff` carries only objective/context supplied by the caller plus optional one-way hashes—never hidden MSO history, memory, Skills, tool state, or raw session/workflow ids. Inbound MSO A2A serving, auth profiles, streaming/push and gRPC remain a later explicit phase rather than opening a network listener implicitly.

## 2026-09-02 — Full-store session resume resolution — SHIPPED

MSO CLI **1.6.2** moves direct resume resolution to the server-side durable session store instead of first truncating the candidate set to 100 recent summaries in the terminal client. `--continue`, `--resume`, `/session <query>`, and `/resume <query>` now resolve `latest`, modified-order index, full/short id, exact/prefix/fuzzy title against every owner-visible durable session; the interactive picker intentionally remains a bounded newest-first view for fast navigation. Empty default CLI shells are excluded from index/latest selection, matching the human picker. Ambiguity errors use human titles rather than exposing internal ids. Regression coverage includes a target beyond 275 synthetic recent rows so the 100-row regression cannot return.

## 2026-09-02 — Cognitive Runtime P1: typed memory + measurable agent quality — SHIPPED

P1 upgrades durable agent memory without breaking the existing `USER.md` / `MEMORY.md` contract. Each client principal can now persist a private `records-v1.json` ledger of semantic/episodic/procedural claims carrying confidence, sensitivity, validity windows, provenance authority/channel, supersession/retraction and competing-claim evidence. Legacy Markdown remains readable until the first structured mutation, then seeds the ledger and becomes a resolved compatibility projection. Resolution is deterministic by temporal effectiveness → authority → confidence → recency; future facts do not erase still-current facts early. MCP adds read-only `agent_memory_search`; raw ChatGPT conversation ids are never persisted in provenance.

Workflow learning now records P1 quality telemetry rather than only success and duration: completed/failed/denied/rate-limited/invalid-argument steps, retry count, rollback/restore signals and tool latency. Legacy recipes remain valid for aggregate workflow success but carry no `qualityVersion`, so the baseline correctly reports **0% step-telemetry coverage** instead of pretending historical data exists. The current real recipe store is **179/186 successful workflows (96.2%)**; P1 telemetry coverage will grow only from executions observed after this release.

Benchmarking is now layered. `bench:memory` passes **8/8** deterministic retrieval/temporal/conflict fixtures; `bench:cognitive` reports **48 transport tools / 32,969 schema bytes**, **14.5 selected tools / 11,125 bytes average**, **66.3% reduction**, 100% required-tool recall and 100% typed-memory fixture accuracy. `bench:quality` validates telemetry accounting and can summarize the live learned-recipe store. `mso agent --oneshot <prompt> --json` exposes the same autonomous tool loop without a TTY, read-only by default and requiring explicit `--approve-scope` for write/exec. `bench:agents` uses that runner plus Hermes/OpenClaw on a scratch-only read task and refuses comparison when model/provider evidence does not match. The first smoke passed MSO on GPT-5.6 Terra, while the local Hermes/OpenClaw configurations could not run the equivalent override, therefore `comparable=false`; no overall ranking is claimed.

The P1 smoke also caught a semantic tool-contract defect: `sys_stats` exposed uptime as an ambiguous numeric `uptime` field in milliseconds, which GPT-5.6 Terra described as days. The model-facing tool now emits explicit `uptimeMs` and `uptimeSeconds` fields and removes the ambiguous field while the existing REST/UI `SysStats.uptime` contract remains unchanged.

## 2026-09-02 — Human-first session picker + durable prompt history — SHIPPED

MSO CLI **1.6.1** removes the duplicate session navigation UI. `/session` and bare `/resume` now open exactly one native picker instead of printing a recent-session list and then rendering a second completion list. Sessions are sorted by `updatedAt` descending, the human title is the primary/only identity shown in the normal UI, and each row carries compact `modified just now / Xm / Xh / Xd / YYYY-MM-DD` metadata. The internal durable id remains the hidden selection value and an accepted exact query for automation/debugging. The Agent header, Runtime row, compact status bar, `/session`, and exit summary are title-first as well; `/status` deliberately retains the exact id for diagnostics.

Prompt history now behaves like a normal terminal across process boundaries, not only inside one invocation. On startup, `--continue`, or `/resume`, the composer is seeded from durable `role:user` rows newest-first, so ↑/↓ and Ctrl+P/N traverse prior prompts and return to the current draft. Session switching replaces the readline history with the selected session's prompts so histories do not leak across sessions. The existing Ctrl+C/D/L/W/U/K, Ctrl+A/E/B/F and word-navigation behavior remains unchanged.

The same audit fixed title lifecycle correctness. Fresh CLI sessions no longer send the placeholder `MSO Agent session` as an explicit manual title, allowing the first real prompt to auto-title the session. `/title` now calls the dedicated durable `rename` action instead of trying to smuggle a rename through an auto-title history update. A compatibility rule repairs only legacy CLI records whose literal default `MSO Agent session` was incorrectly marked manual; genuine manual titles remain locked. Regression coverage verifies newest-first ordering, hidden-id title rows, relative modified metadata, immediate dropdown rendering, durable ↑/↓ traversal, explicit rename, legacy-title repair, and human-title compact status. Real PTY proof covers one `/session` dropdown with no duplicate recent list/visible id, durable Up/Up/Down/Down traversal after `--resume`, and title-first banner/status output.

Permission DX is hardened in the same CLI patch. `mso --yolo`, `mso -yolo`, and `mso agent --yolo` all enter an explicit process-local YOLO mode; the default remains `ask`. `/permission` provides a native picker for `ask`, `auto-write`, and `yolo`, while Tab on an empty prompt cycles them. Auto-write only bypasses write prompts; YOLO bypasses both write and exec prompts. Crucially, non-read calls still compute the canonical full-payload approval object/digest before execution, so bypassing the human prompt does not bypass server-side exact-call binding. A real harmless `exec_run` PTY turn in YOLO completed without any `allow this exact call? [y/N]` prompt and with the server accepting the digest. The audit also makes `/clear` clear the composer prompt history, and filters empty default CLI sessions from the human picker so opening/exiting the Agent does not flood recent navigation.

## 2026-09-02 — MCP session lookup contention hardening — SHIPPED

The first live Cognitive Runtime P0 deployment exposed a scalability problem that unit-size fixtures did not: the host already had **2,927 durable agent session files**, while every conversation-bound `/mcp` tool call still took one global session-store lock and scanned the entire directory to find its `openai/session` hash. Parallel ChatGPT conversations could therefore exhaust the 3-second security-store lock budget and return `security store is busy; retry the operation` even though each conversation was correctly isolated.

Conversation correlation now has a private durable index keyed only by the stable principal hash + hashed conversation id. Startup backfills pre-index P0 sessions once before requests are accepted; normal conversation lookup is then O(1). New-session creation uses a per-conversation lock so duplicate parallel calls collapse to one record, while history/title/event mutations use a per-session lock so unrelated chats never serialize behind a global lock. The raw OpenAI conversation id is still never persisted. Regression coverage runs 32 simultaneous lookups for one conversation, 24 unrelated conversations in parallel, legacy-index backfill, cross-session workflow isolation, compaction/archive policy, and MCP route correlation.

## 2026-09-02 — MCP-first Cognitive Runtime P0 — SHIPPED

MSO CLI **1.6.0** moves agent quality into the provider-neutral harness instead of relying on one model vendor. ChatGPT/MCP identity is now layered as **authenticated client → durable conversation session → workflow/job**: `_meta["openai/session"]` is hashed with the stable client principal and the raw opaque conversation id is never persisted, transport-session rotation does not split a ChatGPT conversation, active workflows/jobs are session-scoped, and verified learned recipes remain reusable at the stable client-principal boundary. This lets parallel chats benefit from prior successful procedures without being able to status, finish, cancel, or attach to each other's live work.

Durable session context now has an explicit lifecycle. MSO estimates stored context provider-neutrally, compacts at **700,000 tokens** by default, preserves a structured summary plus roughly **140,000 recent tokens**, writes a recursively redacted owner-only gzip archive before compaction, and prunes archives after **30 days** both after archival and at boot. CLI continuation uses copy-on-resume across MCP/terminal surfaces. Separately, one model call receives only recent projected history—roughly 55% of the advertised context window, capped at 120k history tokens—so system policy, memory, active Skills/tools, reasoning and output retain headroom; assistant tool-use + matching result rows are projected atomically. `/status` distinguishes active model context from durable session/lifetime counters and compaction/archive counts.

Tool context is now budgeted at both schema and result layers. The public MCP transport remains capability-complete at **47 tools**; the documented model/operator catalog is **46 tools** (**24 read, 17 write, 5 exec**) plus app-only `workflow_status`. MSO's own terminal harness uses a deterministic per-turn router with a 14-schema soft target, core discovery/control tools, recently used tools and required companions. Generic MCP result text is capped at **32 KiB** by default, `exec_run` at 48 KiB, and file/long-job outputs at 64 KiB; oversize results return a parseable `msoTruncated` preview/hint instead of flooding the model context. MCP toolset version is **2026.09.02.1**.

`bun run bench:cognitive` is now a release-quality provider-neutral harness. On the release host, the full MSO catalog is **47 tools / 31,212 schema bytes**, while 14 representative scenarios select **14.6 tools / 11,074 schema bytes on average**, a **64.5% reduction**, with **100% required-tool recall** and deterministic routing. The installed Hermes v0.20.0 baseline reports **27 tools / 44,758 tool-schema bytes**, so P0 is smaller on that exact comparable schema-footprint metric while preserving benchmark recall. This is deliberately **not** an overall Hermes claim. Installed OpenClaw 2026.7.1-2 has no directly equivalent offline prompt-size probe exposed to this harness, so no OpenClaw superiority claim is made yet; equivalent task-success, tool-error, token-per-success, latency and policy-compliance scenarios remain the proper overall benchmark target.

Final repository verification passes **271 test files / 1,972 passing tests** with **1 expected-fail and 7 skipped**. TypeScript passes; lint has **0 errors** and only five existing `max-lines` warnings; value cycles are 0; docs report 49 current Markdown files and exact MCP parity; contrast has 0 WCAG failures; all 11 official skill flows validate; and the high/critical dependency audit is clean. `docs/COGNITIVE-RUNTIME.md` is the SSOT for these invariants and the P1 path: provenance/temporal typed memory, Tool/Skill quality telemetry, eval-gated Tool Forge, scope-preserving programmatic orchestration, and genuinely comparable Hermes/OpenClaw task-quality benchmarks.

## 2026-09-01 — External TTY Ctrl+C handoff hardening — SHIPPED

MSO Agent 1.5.8 closes one live-only SIGINT edge case found after the 1.5.7 deployment: cancelling the `/model` child TUI could leave the shared terminal in cooked mode, so the next Ctrl+C arrived as an OS `SIGINT` while the parent composer was awaiting a keypress. The interrupt manager correctly requested exit, but the waiting prompt was not resolved. `AgentComposer` now exposes one idempotent `cancelCurrent()` primitive shared by raw-key Ctrl+C and OS-level SIGINT. The parent SIGINT bridge wakes the current prompt on exit/interrupt, so child TTY handoffs cannot strand the Agent.

Regression coverage now includes programmatic cancellation of a waiting composer prompt in addition to the 1.5.7 raw-key and AbortController tests. Live PTY verification specifically covers `/model` cancel → returned Agent prompt → Ctrl+C clean exit.

## 2026-09-01 — Agent terminal control semantics + interrupt-safe history — SHIPPED

MSO Agent 1.5.7 aligns terminal control behavior with mature agent harnesses. Ctrl+C now clears a non-empty draft, exits cleanly from an empty idle prompt, and aborts an active assistant/tool HTTP turn through a real `AbortController`; a quick second Ctrl+C while a turn is still stopping requests exit. Ctrl+D follows readline semantics (delete-right with text, EOF exit when empty), Ctrl+L clears/repaints, Ctrl+W deletes the previous word, Ctrl+P/N mirror history ↑/↓, and Ctrl+A/E plus Ctrl+B/F provide standard line navigation. `/quit` is now an explicit `/exit` alias.

Interrupt state is split from the composer so raw-mode key handling and cooked-mode OS SIGINT cannot fight each other. Ctrl+C inside approval cancels and aborts the active turn, while Ctrl+C/Esc inside `/model`, `/models`, and `/resume` pickers cancels only that foreground picker. Assistant and agent-tool fetches receive the same turn AbortSignal. If a turn is interrupted, all user/assistant/tool history rows created by that unfinished round are rolled back before persistence; provider token usage already consumed may still be counted, but `mso --continue` never resumes a half-turn. Server-side bounded jobs already created keep their explicit job/cancel lifecycle.

Regression coverage includes empty/draft Ctrl+C, active-turn double interrupt state, AbortSignal propagation to the assistant fetch, Ctrl+D/W/L/B/F/P/N editing, `/quit`, slash catalog parity, and zero-warning modularity for the new control files. Real PTY smoke covers clean idle Ctrl+C/D exits, Ctrl+L repaint, draft-clear→exit, history recall, `/resume` cancel, both stages of `/model` cancel, `/models` cancel, and a real Codex turn interrupted back to a live prompt with `historyTurns: 0`. Final repository verification passes **265 test files / 1,953 tests**, with 1 expected-fail and 7 skipped; typecheck, docs, dependency cycles and high/critical audit are clean, and the only lint findings are the six pre-existing `max-lines` warnings outside this change.

## 2026-09-01 — Arrow-key model/provider picker + visible skill lifecycle — SHIPPED

MSO Agent 1.5.6 removes the last numeric prompt from the AI provider/model interaction path. `mso model`, the no-argument `mso models` manager, provider connect/remove selection, and catalog-provider selection now share one dependency-free native TTY picker. The current provider/model is preselected, ↑/↓ redraw in place with zero added newline scrollback, typing filters candidates, Enter selects, and Esc cancels. Direct scriptable forms such as `mso model openai-codex/gpt-5.6-terra` and `mso models add openrouter` remain unchanged.

Skill invocation state is now explicit and consistent across the slash palette, `/skills`, the invocation badge and the compact status line: `◇ ready` means trusted/executable, `◆ queued` means selected for the next message, and `✓ invoked` means the skill instructions were actually attached to a model turn. Queued state is amber; invoking/invoked state is green. Resuming or clearing a session clears ephemeral skill UI state so one session cannot visually leak the previous session's skill marker.

Regression coverage locks the picker/filter/wrap primitives, absence of numeric model/provider prompts, exact `/model` vs `/models` behavior, skill ready/queued/invoked state, and status propagation. Real PTY smoke verifies model current-item highlighting, ↓/↑ with zero LF output, Esc cancellation, and preservation of the active model.

## 2026-09-01 — Agent model/session UX parity + dynamic status — SHIPPED

MSO Agent 1.5.5 aligns the useful interaction contract of mature agent harnesses without copying their branding/runtime. The startup banner now uses the owner-specified 12-line Hybrid MSO geometry and exact six-stop True Color gradient (purple/indigo → blue → cyan → teal/emerald). AI configuration is split into two explicit surfaces: `mso models` manages provider API keys/OAuth/custom-provider connections **without switching the active model**, while `mso model` validates and selects only models available through connected providers. Exact `/model` now wins over the `/models` prefix in the slash palette; OpenRouter-style model IDs containing `/` are resolved against the current provider before being interpreted as a provider/model ref.

The terminal now carries a compact dynamic status line with active provider/model, approximate context consumption (explicit `~`, plus catalog context window when known), provider-reported token usage when available, turn count, last-turn latency, durable session id and working directory. `/status`/`/context` expand the same state and `/statusbar` toggles it. Session UX supports `/title`, numbered `/sessions`, `/resume` picker, `latest`, index, exact/short id, exact title or unique fuzzy title; startup equivalents are `mso --continue` and `mso --resume <query>`. Resume stays bounded to sessions visible to the authenticated principal. Anthropic and ChatGPT/Codex streaming now propagate provider usage into the terminal status when upstream data exists; OpenAI-compatible streams consume usage opportunistically and otherwise keep the clearly-labeled estimate.

The same audit caught two real regressions before release: `/api/models/test` could not validate the `openai-codex` subscription provider because it incorrectly entered the generic API-key resolver, and Enter on exact `/model` could apply the highlighted longer `/models` completion. Both paths now have dedicated regression tests. Provider-auth APIs accept `select:false` for CLI connection management while keeping legacy Settings callers selecting by default, so existing browser behavior remains compatible.

Verification for this milestone passed **262 test files / 1,939 tests** (1 expected fail, 7 skipped), typecheck, documentation consistency, cycle checks and high/critical dependency audit. PTY smoke covers exact 12-row banner/color output, wide/narrow terminal behavior, zero-newline arrow navigation, `/model` vs `/models`, `/status`, durable title, resume by title and `--continue`.

## 2026-09-01 — Version identity and update messaging DX — SHIPPED

MSO's two legitimate version domains are now explicit instead of looking like drift. The app/package
version remains the runtime/service compatibility identity used by health/readiness and Settings → About;
the CLI keeps its independently versioned interaction contract. `mso --version` labels **CLI**, **app**
and the exact Git **build**, About says **App version**, and README/install docs explain why those values
can differ. Git commit identity remains the release/update authority.

`mso update status` and its interactive background notice also distinguish a CLI-version change from a
commit-only release. A commit-only update now says `N new commits on mso CLI X` instead of the confusing
`X -> X`; a true CLI bump still shows an explicit `mso CLI X -> Y`. Up-to-date status labels both CLI and
build identity. Regression tests cover version-change, commit-only, active-service build matching and CLI
version output so the ambiguity cannot silently return.
## 2026-09-01 — Terminal banner geometry + stable slash navigation — SHIPPED

MSO Agent now uses the compact canonical folder + `MSO` ASCII geometry from the terminal logger instead of the oversized 12-row title. The seven title rows render as a cool blue → cyan → teal/emerald gradient with no purple. The slash palette also reserves its physical terminal rows only when it opens or grows; subsequent `↑/↓` selection redraws use ANSI cursor movement only, and the input prompt no longer embeds a leading newline that would be replayed on every redraw. A real PTY regression verifies both arrow directions emit zero LF/CRLF while still moving selection, so terminal scrollback stays stable. CLI patch version: **1.5.4**.

## 2026-09-01 — Install/update DX and legacy upgrade bridge — SHIPPED

The public installation contract is now explicitly agent-friendly and backward-compatible. A user may
hand a capable AI agent only the MSO repository URL and ask it to install or update; `AGENTS.md`,
`CLAUDE.md`, README and the public `/install` page all route that request to the repository-owned
installer/updater instead of a hand-built parallel setup. Current installs use `mso update` or Settings →
About, while older installs that predate both surfaces bridge forward by re-running the same verified
one-line installer. The installer discovers an existing `mso.service` WorkingDirectory before selecting a
default checkout, preserves `.env.local` and `~/.mso`, refuses dirty/diverged source, and upgrades in
place rather than creating a second clone.

README's **Useful installer controls** now covers every public flag and environment override advertised by
`install-core.sh`, with safe guidance for bind/ref overrides. A new contract test derives those controls
from `--help` and fails when README or `docs/INSTALL.md` drifts. Upgrade completion is also state-aware:
fresh installs receive first-device pairing guidance, while existing installs say `updated`, confirm
preserved state, and point to `mso update`, Settings → About, `mso doctor`, onboarding and the legacy
installer fallback without replaying first-run instructions. Repository worktree policy was consolidated
at the same time: `~/projects/mso`/`origin/main` remains the release SSOT and parallel worktrees stay under
`~/.cache/mso-worktrees` until verified and reconciled.

## 2026-08-31 — MSO terminal agent + provider-backed deployment setup — SHIPPED

**Shipped milestone.** The release passed the repository/security gates and the live health endpoint returned the release build SHA before this status was promoted. A previously standalone deployment-assistance pattern is now absorbed into MSO's own architecture instead of spawning a second agent runtime. Installed Hermes and its public CLI were used as interaction references only; MSO has original terminal artwork, its own tool catalog, and its existing auth/audit model.

What changed:

- bare `mso` now launches **MSO Agent**; `mso agent`/`mso chat` are explicit aliases and `mso model` connects or changes the AI provider before the agent starts;
- the terminal presents an original MSO folder + `>_` ASCII icon beside the large MSO wordmark (stacking on narrow terminals), selected model, Available Tools, Available Skills and infrastructure readiness, then streams through the existing `/api/assistant` backend;
- the terminal discovers the canonical MCP catalog through an Owner-only `/api/v1/agent-tools` bridge. Read tools may execute directly; every individual write/exec call pauses for an exact-call terminal approval (never a cached session-wide mutation grant) while server role/scope/rate-limit/audit checks remain authoritative;
- MCP toolset is **2026.08.31.1: 38 tools = 20 read + 13 write + 5 exec**. New provider tools cover redacted provider discovery/doctor, Dokploy project list/ensure, exact per-record Cloudflare DNS upsert, and exact Hostinger name/type RR-set replacement;
- provider credentials are stored separately in `~/.mso/private/infra-providers.json`: 0700 parent, 0600 file, `O_NOFOLLOW`, regular-file/owner/size checks, atomic locked writes, API summaries expose only the word `configured` for secret fields, and no raw secret enters model/MCP arguments;
- `mso provider set dokploy|cloudflare|hostinger` uses hidden terminal input. AI API-key setup was hardened at the same time so provider keys are built from stdin rather than being exposed through helper-process argv;
- **Dokploy** and **Cloudflare** are built-in default shell/App Store features with secure configuration, Verify, and live project/zone inventory. Hostinger remains a provider rather than a default app;
- configurable remote Dokploy endpoints use the existing DNS-pinned safe-provider transport; remote HTTP is refused, redirects are refused, and private/link-local/metadata resolution is blocked. Literal loopback remains the explicit same-host exception;
- Cloudflare automation never performs a bulk zone PUT, refuses duplicate/conflicting rows, PATCHes one existing record or POSTs one new record, and defaults proxying off. Hostinger DNS now uses the provider's scoped RR-set replacement semantics (`overwrite:true` with one `name + type` row), so unrelated zone rows never enter the PUT payload; ambiguity/conflicts remain refused and the mutation stays approval-gated;
- official `mso-project-deploy` skill documents workflow start → inspect → provider doctor → bounded deployment/DNS operations → runtime/HTTPS verification → finish/cancel;
- MSO Agent slash skills are now executable: `/<skill>` selects a trusted global/current-project skill for the next message, `/<skill> <prompt>` runs immediately, `/skill <exact-id>` resolves cross-project ambiguity, and Tab completion only offers skills valid in the current scope; project skills follow the terminal working directory while untrusted instructions remain withheld;
- the terminal composer opens a Hermes-style slash dropdown immediately on `/`, with live filtering, fixed 8-row viewport, Enter/Tab selection, Esc dismissal, command metadata, and trusted current-project/global skill recommendations;
- `mso update` now short-circuits when source and active runtime already match, avoiding redundant production rebuilds; when a real service update is needed, an interactive terminal waits and prints update milestones until the new runtime is verified instead of immediately returning with only a log hint;
- CLI version for this interaction milestone is **1.5.4**. `docs/INFRASTRUCTURE-PROVIDERS.md`, architecture/install/MCP/ChatGPT connector docs, generated CLI reference and slice catalog are synchronized.

Verification added specifically for this slice covers provider-store symlink/permission/secret behavior, Cloudflare one-record semantics, Hostinger exact RR-set payloads, Owner-only agent/provider routes, exact-payload terminal approval, CLI onboarding/update fixtures, MCP parity/rate limits, and documentation/toolset markers. The final full repository gate passes with **254 test files / 1,918 passing tests** (1 expected fail, 4 skipped), typecheck and dependency audit green, zero value cycles, and zero lint errors (six pre-existing max-lines warnings remain). A targeted Codex Security pass first found two Medium issues in the new infrastructure surface — whole-response buffering before its nominal 1 MiB cap and a stale full-zone Hostinger PUT. Both were fixed; the final infrastructure re-scan completed **1/1 component with 0 findings**. A separate terminal-agent scan found one Medium issue where a truncated approval preview could conceal mutation fields. The terminal now renders the complete canonical tool name + nested input, refuses approval payloads above 32 KiB, removes session-wide mutation grants, and binds the approval SHA-256 to the exact payload that the server independently re-hashes before dispatch; the final terminal-agent re-scan completed **1/1 component with 0 findings**. A parallel-suite-only lifecycle harness race was also removed by holding the fixture lock until the assertion explicitly releases it; the lifecycle file then passed 5 consecutive runs (40/40 checks). The first production handoff also exposed a release-verification false negative: the system unit can spend close to its 90 s `TimeoutStopSec` draining the old npm/Next control group, while the finalizer only waited 40 s for a new MainPID. Production still reached the gated release SHA, and the verifier now uses a bounded 120 s default restart budget (override constrained to 30–300 s) so a valid slow systemd restart is not reported as rollback. Live Dokploy/Cloudflare/Hostinger API success is intentionally not claimed until an owner supplies credentials and `mso provider doctor` checks that provider.

## 2026-08-31 — Login-origin diagnosis + `mso doctor --fix` + runtime hardening (SHIPPED)

A real install report confirmed the confusing post-approval login case was transport, not a broken
device store: the browser was opening MSO on plain `http://<server-ip>:4005`. MSO's session cookie is
always `Secure`, so that address can answer health/API requests and accept the password while the
browser still cannot retain the authenticated session. Pairing on that IP and later moving to an HTTPS
hostname is also a different browser origin, so the device ID shown there is not the final-origin ID.

The supported guidance is now explicit in the installer summary, `/install`, README, CLI reference,
Install and Troubleshooting docs: browser sign-in uses HTTPS, or loopback via `http://localhost` (for
example through SSH port forwarding). `mso doctor` prints the same login-transport rule even when its
own loopback CLI base is healthy, and fails clearly when `--base` / `OS_PUBLIC_ORIGIN` points at a
plain-HTTP non-loopback address. `mso doctor --fix` was added for bounded local recovery: it may start
an existing MSO service, approve this host's own CLI device, and refresh its session jar; it never
changes DNS, certificates, firewall rules, public exposure, or login credentials.

The screenshot also exposed a separate onboarding bug: `ensure_local_cli_device` previously searched
`device --list`, which contains both APPROVED and PENDING rows. A CLI ID already in PENDING was
therefore mistaken for approved, onboarding skipped promotion, then its first authenticated request
failed. The device helper now has an exact approval-status probe; onboarding and doctor promote that
local CLI ID correctly and regression tests cover the pending-to-approved case.

The remaining changes from PR #28 were not discarded as stale. Its installer/update-lock recovery,
service/fallback readiness handoff, gateway public-origin canonicalization, job-retention ordering and
security-store contention fixes were integrated on top of the current MCP work and independently
exercised before release.

## 2026-08-31 — Guided multi-client MCP setup in Settings (SHIPPED)

Settings → MCP now treats connection as an onboarding workflow instead of a developer-only list of
OAuth endpoints. The authenticated Settings API returns MSO's deployment-owned public origin, so a
loopback browser no longer teaches ChatGPT a `localhost` URL when `OS_PUBLIC_ORIGIN` is configured.
The connection card probes `GET /mcp`, the Bearer OAuth challenge, protected-resource metadata and
authorization-server metadata and reports readiness only when all four agree on the same deployment.

The UI now mirrors modern MCP client setup flows: choose ChatGPT, Codex, Claude Code, Cursor, Gemini
CLI, VS Code, or a generic Streamable HTTP client; follow numbered steps; copy the exact server URL,
CLI/config snippet, and only expand advanced OAuth fields when a client asks for them. ChatGPT gets
copy-ready Name/Description/Connection/Authentication values matching the New Plugin form. Local-only
origins are called out before users paste them into a cloud client, with MSO Gateway and stable
custom-domain/reverse-proxy instructions that keep the raw Next listener loopback-only. Scope guidance
starts at `read` and explicitly describes `write` and `exec` blast radius.

The existing token revocation, audit trail and toolset-signature cards remain the operational truth
after connection. Current MCP/ChatGPT docs were refreshed at the same time, including the live
31-tool split (16 read / 10 write / 5 exec) and current Plugin/App terminology. The Streamable HTTP
route now also validates browser `Origin` before authentication, closing the DNS-rebinding gap called
out as a MUST in the MCP transport specification, while server-to-server clients remain unaffected.

## 2026-08-31 — 10× MCP daily allowance + truthful Settings updater preflight (SHIPPED)

The authenticated MCP endpoint now permits 50,000 calls per token per fixed 24-hour process-local
window, up from 5,000, while retaining the 120-per-minute runaway-client guard. The public MCP
tool names, schemas, scopes and toolset signature are unchanged; this is an endpoint limit only.

Settings software update now refuses non-`main` checkouts before starting its transient updater,
matching the CLI contract and preventing a feature branch from being misreported as merely one
commit behind `origin/main`. The executor independently enforces the same branch boundary, and the
panel no longer labels an unsupported checkout as a remote-connectivity failure.

## 2026-08-30 — Loopback-only public gateway + resilient WSL CLI lifecycle (SHIPPED)

MSO now has an explicit laptop/WSL public-access lifecycle without widening the application bind.
`mso web` verifies the MSO health contract and can start the already-built production runtime on
`127.0.0.1` when no service is active. `mso gateway start` adds an outbound HTTPS Cloudflare tunnel
on top; temporary Quick Tunnel mode is disclosed as preview-only because the provider does not
support SSE, while named/custom-domain mode remains driven by `OS_PUBLIC_ORIGIN`. `mso gateway
domain set https://…` updates that stable origin atomically and prints loopback-only ingress config.

The independent PR review found lifecycle failure modes before merge, so the gateway was hardened
rather than those comments being dismissed. Gateway state now records a process fingerprint (PID,
`/proc` start ticks, executable and command-line hash), startup first verifies the exact expected argv,
`stop` refuses identity mismatches, start/stop share an owner-only lifecycle lock, concurrent starts
produce one tunnel, state-write failure rolls newly launched processes back, stale tunnel state
preserves a still-owned runtime, and both local/public probes require MSO's structured health
contract rather than accepting any HTTP 2xx. The original 428-line script was split into bounded
≤200-line single-responsibility modules. Regression tests cover rollback, PID reuse, concurrency,
runtime ownership, non-loopback/hostname confusion, config permissions, domain mutation and browser
selection.

The WSL onboarding failure path is also repaired. `mso onboard` no longer turns a connection failure
into the false advice to approve an already-approved device; loopback onboarding starts/verifies the
fallback runtime first. Re-approving the same device+role is idempotent, while role changes still need
`mso device role`. CLI version is now 1.4.0. `mso update` is API-independent and is the preferred
operator command: it can fetch/fast-forward/verify/build even when port 4005 is down, and normal
interactive CLI use emits a throttled Git-backed update notice when `origin/main` is ahead.
`mso update run` remains accepted for compatibility. Final PR review then hardened crash/concurrency
recovery: deployment state is keyed by canonical checkout, update transactions are serialized with kernel `flock`, recovery intent is durable before an owned runtime is quiesced,
and an interrupted post-quiesce state write is reconciled on retry. The shared private-state atomic
writer now propagates write/rename failures explicitly even when called from a shell conditional. A
full pre-push run then exposed a fork/signal race before the tunnel fingerprint existed. Tunnel launch
now uses a held-child handshake: the scrubbed child cannot `exec cloudflared` until its parent records
PID + kernel start-ticks and releases an owner-only gate; if the parent disappears first, the child
self-terminates. The same handshake now protects the detached Next fallback. Final review also moved
gateway/update serialization to kernel `flock` (no stale-lock ABA reclaim), scoped gateway state by
canonical checkout + selected loopback origin, and made public readiness compare the exact local
`version + buildId + runtimeInstanceId`. This closes the cross-clone control and wrong-deployment
readiness classes without widening the raw app bind. The last P1 review pass added a checkout-wide
shared/exclusive runtime exclusion: every in-place update owns it exclusively through `.next` mutation and deployment-state persistence, while all runtime-start paths take the shared side. Service-active updates now inventory and restore all gateway-owned fallback origins for the checkout instead of assuming only one runtime exists. An already-live
tunnel is no longer treated as sufficient proof of readiness; `gateway start` recovers a dead local
runtime, preserves the tunnel PID, and re-probes the exact public health identity before success.

The global response policy additionally sends `X-Robots-Tag: noindex, nofollow, noarchive` because an
MSO control plane should not be indexed merely because a temporary HTTPS endpoint exists. The
Cloudflare client is now a core supply-chain lock too: release `2026.8.2` is pinned by exact official
asset URL + SHA-256 for Linux amd64/arm64, installed user-locally on first gateway use, re-hashed
before reuse, and launched with self-update disabled. Named configs are parsed before launch and are
accepted only when dedicated to the configured MSO hostname/loopback port with a private credentials
file and a terminal `http_status:404` fallback.

## 2026-08-30 — WSL Bun bin-metadata build resilience (SHIPPED)

A second real Ubuntu/WSL install reached checkout and a complete Bun 1.3.14 dependency install,
then failed at `bun run build` with `could not open bin metadata file` / `Bun failed to remap this
bin`. The important distinction is that Bun's package-bin metadata can be damaged while the actual
`node_modules/next` package payload remains readable. The previous ordering also meant this build
failure still happened before the CLI launcher was created, so an operator again ended with no
`mso -h` despite a valid checkout.

The installer now treats the CLI as the earliest post-checkout recovery surface: it creates and
self-checks the launcher before dependency installation, configuration, build, or service setup.
Production build no longer asks Bun to remap the `next` package binary; it executes
`node node_modules/next/dist/bin/next build` directly. A force reinstall is reserved for the
stronger condition that the package entrypoint itself is missing after dependency installation.
This keeps real compile errors fail-closed while avoiding a WSL-specific package-bin indirection.

Regression coverage asserts the new phase order, forbids an executable `bun run build` in the
installer core, and proves the direct Next entrypoint still runs while `node_modules/.bin/next` is
absent. A WSL-like end-to-end run using Bun 1.3.14 deliberately replaced `.bin/next` with a failing
launcher immediately after dependency installation; the production build still completed through
the direct Node entrypoint, the broken launcher remained broken (proving it was not silently fixed),
and the parent shell resolved `mso -h` successfully.

## 2026-08-30 — WSL installer reliability and recognized property fuzzing (SHIPPED)

A WSL install exposed two assumptions that were true on the production VPS but not on a fresh
Linux shell. The installer treated the presence of a `systemctl` executable as proof that systemd
was PID 1, and it did service setup before creating the CLI launchers. On WSL with systemd disabled,
`systemctl` therefore aborted the `set -e` installer before `mso` existed. Separately, `curl | bash`
can never modify the parent shell's PATH, so claiming `mso -h` was immediately available without
checking the invoking PATH was not a valid installation contract.

The installer now creates and validates the CLI before service setup, requires systemd to actually
be PID 1, persists `~/.local/bin` for future bash/zsh sessions, and uses a guarded launcher in an
already-reachable system bin directory when possible. It checks the original invoking PATH rather
than its child-process PATH and prints an exact fallback export when immediate discovery cannot be
proven. WSL without systemd remains a supported CLI-only shape; background service/onboarding waits
for a verified service. An isolated clean-HOME/PATH install proved the child installer returns to a
parent shell where `command -v mso` and `mso -h` succeed. The invoking cwd is captured too: relative
PATH entries such as `bin` are normalized against that cwd before discoverability is claimed, so a
later `cd` into the checkout cannot manufacture a false positive.

The service readiness gate was also corrected for explicit `NEXT_DEPLOYMENT_ID`. Each installer-
driven service restart now receives a fresh random runtime instance ID in the systemd unit, and the
public no-store health route echoes that non-secret value. Readiness accepts the response only when
it carries the exact freshly injected ID. This is stronger than either build-ID or MainPID change:
it still works when the deployment ID intentionally stays stable, while a stale or unrelated process
that happens to answer on the same port cannot satisfy the gate. Runtime reporting also
distinguishes “WSL without systemd” from “systemd existed, the unit was attempted, but health/takeover
verification failed,” so a failed WSL service keeps its journal recovery path instead of being mislabeled.

OpenSSF's remaining Fuzzing posture gap is addressed with real TypeScript property testing rather
than a dismissed alert. `fast-check` now generates adversarial cases for filesystem containment,
private-provider SSRF rejection, and PKCE exactness; the package/import form is one that Scorecard's
Fuzzing check recognizes. Code Review and CII Best Practices remain external governance evidence:
they require genuine independent review and OpenSSF badge enrollment rather than repository-side
alert suppression.

Verification: installer Bash syntax + hosted ShellCheck, installer contract tests, hundreds of
property-generated security cases, full TypeScript/lint/test gates, docs/changelog parity, dependency
audit, isolated production build, an isolated clean-HOME/PATH install, and protected-branch hosted
CodeQL/dependency/Gitleaks/Trivy/OSV/Semgrep checks.

> **How to read this log:** it is the source of truth for **why/when work shipped**, not
> today's API/runbook. Phases 0–14 were built on **Convex self-hosted + a legacy control-service
> host-agent bridge**; that stack was removed in Phase 15 and later entries describe the
> self-contained Next.js/`lib/host` architecture. For the current implementation start at
> [`docs/README.md`](./README.md) and [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md); keep old
> entries intact as historical evidence even when their commands/counts have been superseded.

## 2026-08-30 — atomic installer bootstrap for WSL / partial-transfer safety (SHIPPED)

A real WSL run of the documented one-liner exposed a gap the earlier isolated tests missed: the
large `scripts/install.sh` was executed directly from the network stream. Replaying only the first
11,981 bytes of that file reproduced the report exactly — Node and Bun printed as healthy, Bash
reached a syntactically complete EOF and returned **0**, but checkout/CLI installation never ran.
A partial HTTP response could therefore look like a successful install even though `mso -h` did
not exist.

The public `scripts/install.sh` is now an intentionally small bootstrap. It downloads the complete
`scripts/install-core.sh` to an owner-private temporary file first, retries the transfer, requires
a minimum payload size and exact EOF marker, verifies the committed SHA-256, runs `bash -n`, and
only then hands off with a final `exec`. The fail-closed `EXIT` trap is the **first executable
statement after the shebang**, before comments or variable setup, and there is deliberately no
earlier "done" assignment. Every later syntactically complete network prefix therefore becomes a
non-zero truncation failure instead of a false success; a regression includes the exact early-prefix
shape (`head -n 16`) that independent review used to reproduce the remaining gap. The core carries phase-only error
reporting (no raw command/secret echo). A second clean-image reproduction found that `bin/mso` also
requires `jq`: Node and Bun alone were not enough, and the old installer never installed that CLI
runtime dependency. The core now verifies/installs `curl`, `jq` and the required coreutils before
creating the launcher, then separately proves the target is executable and that `mso -h` succeeds.

The existing WSL contracts remain intact: CLI setup precedes service setup, PID 1—not the presence
of `systemctl`—decides service availability, caller PATH/cwd semantics are preserved, custom bin
paths are reported honestly, and installer-driven service readiness is tied to a fresh runtime
instance ID. Contract tests execute the local bootstrap/core pair and prove that a syntactically
complete truncated payload is rejected.

## 2026-08-29 — evidence-backed comparison, delegated roles and Service Center (SHIPPED)

The old README comparison mixed unrelated tools into one hand-written scorecard. It is now generated
from `docs/comparison-data.json`: six defined criteria, official-source links for every comparison
product, an existing repository-evidence requirement for every MSO rating, explicit searchable
status words (`Strong`, `Partial`, `Not offered`) instead of icon-only cells, and a 90-day review
freshness gate. The chosen category is deliberately narrow—mobile-first, AI-native private Linux
workspace for an owner or small trusted team—while specialist strengths and unfinished gaps remain
explicit in `docs/COMPARISON.md` and `docs/COMPETITIVE-ROADMAP.md`.

Device approval now carries a live Viewer, Operator or Owner role. The store migrates legacy
role-less devices to Owner, fails malformed roles down to Viewer, prevents browser self-demotion and
last-Owner removal, and re-resolves role/revocation on every request. The shell filters inaccessible
apps for clarity, while a centralized server policy makes the actual decision: explicit reads are Viewer and every unclassified route fails up to Owner; PTY/exec/config/MCP/update remain Owner, and only
explicit bounded operational surfaces are Operator.

A hosted CodeQL follow-up on the first release candidate was not treated as cosmetic backlog.
The release was reopened to harden validated config maps, strict thread identifiers, external iframe
policy, descriptor-bound file reads, dual root containment, private collision fixtures, bounded
models.dev cache writes, exclusive upload staging, and immutable CodeQL workflow pins. The first
PR rescan then reported eight changed-line alerts rather than being called green because the
analyzer process exited successfully: a password-comparison model, five path/race flows, one test
TOCTOU and the intentional ChatGPT file-transfer sink. The comparator now uses fixed-width bytes
without creating a stored/fast password hash; thread IDs and host paths use explicit `path.relative` containment, with every host
filesystem sink kept inside the analyzer-recognized safe branch; the cache test binds mode and read to one file
descriptor; and the ChatGPT bridge now streams under 20 MiB, validates redirect host, MIME and raster
signatures, then enters the guarded atomic upload path. Its remaining network-to-disk data flow is
the documented purpose of `fs_upload_file`; it may be classified only as reviewed `won't fix`, never
as a false positive or by weakening CodeQL. Regression tests accompany each changed boundary; the
replacement SHA must repeat the full repository, build, hosted-analysis, deploy and
ultimate-assurance gates before the branch is considered closed.

The same release reconciles all ten open Dependabot PRs instead of merging them blindly. Seven
minor/patch or action updates with green hosted checks are integrated, and Lucide 1.x is migrated
with its removed GitHub brand glyph replaced by a supported repository glyph. ESLint 10 and
TypeScript 7 remain on a documented compatibility hold because the current Next.js React lint
plugin crashes under ESLint 10 and the current `typescript-eslint` stack rejects TypeScript 7;
Dependabot now suppresses only those semver-major repeats while continuing minor, patch, and
security updates.

System Monitor now includes Services and Updates beside live telemetry. It inventories system/user
`systemd` units, bounds journals, and permits start/stop/restart only for validated exact units in
`OS_SERVICE_CONTROL_UNITS`; no shell or wildcard path exists. Package visibility reads only the
existing local cache for apt/dnf/yum/pacman/zypper and exposes no refresh/install/upgrade action. The
same contracts are available through `mso units`, `mso unit ...`, `mso packages`, and role-aware
device CLI commands. Current-reference docs, env examples, generated CLI/comparison docs, Product
Hunt copy, contributor rules and security boundaries were synchronized in the same release.

Release contract: the exact commit must pass repository verification, an out-of-tree production
build, `bun run ship`, deployment, live health checks and the project security gate. The release
record below is generated from that immutable commit rather than from an uncommitted worktree.

## 2026-08-28 (security) — full-repository Codex remediation (DONE)

The first terminal Codex Security component review completed all 20 tracked-repository
partitions and produced one High, sixteen Medium and three Low groups. Every reported group
was traced to its actual boundary and remediated rather than suppressed: MCP now authenticates
before bounded JSON parsing and reapplies the deployment scope ceiling on every call; durable
Alfa memory requires approval of the exact text; learned recipes are actor-isolated; skill
discovery is symlink-safe with authenticated, bounded cursors and one bounded semantic query
embedding; and mutation approvals disclose the complete canonical arguments.

Browser and media boundaries were hardened as well. Camoufox/noVNC moved off the cockpit origin
to a dedicated authenticated host, strips cockpit credentials, and is torn down when a device
is revoked. Custom provider connections resolve and validate every destination and redirect
against private, loopback, link-local and metadata ranges. Image-editor projects and Reel media
now enforce finite dimension, byte, sample and duration budgets before canvas allocation, decode
or export. CLI/editor cookies and documents live only under verified owner-only 0700/0600 state
with atomic no-symlink writes. Security-store stale recovery now uses one shared acquisition gate
across web and CLI writers, closing the check/unlink ABA race.

Managed-app execution identities are immutable: Hermes installer bytes and checkout commit, the
exact OpenClaw package, and the 9Router OCI digest are committed and verified before execution.
9Router binds loopback unless public exposure is explicitly enabled. The release remains
fail-closed: full regression, isolated build, all 20 Codex components, passive ZAP, scanner gates,
push gates and exact-SHA production health must all terminate successfully before `main` is
promoted; skipped lanes are never reported as the ultimate result.

## 2026-08-28 (mcp) — bounded async exec jobs (DONE)

Added `exec_job_start`, `exec_job_status`, and `exec_job_cancel` so long test/build pipelines no longer need `systemd-run`/sentinel-file orchestration around the 30-second `exec_run` request limit. Jobs reuse the cwd jail and destructive-command filter, are actor/workflow-bound, capped at 20 minutes and four concurrent jobs per actor, cap each output stream at 1 MiB, and retain completed state for 30 minutes. Toolset is now `1.6.0` / `2026.08.28.1`: **31 tools** (16 read, 10 write, 5 exec).

## 2026-08-27 — systematic reverse-engineering + MCP feature playbook (DONE)

Implementation work now has one durable default across Claude, Codex/general agents and MSO:
resolve the canonical source/runtime first, reproduce and preserve evidence, map the end-to-end
pattern and limits, compare a working analogue, test one hypothesis at a time, make the smallest
reversible change, and prove the exact live outcome. This prevents the repeated failure mode where
an agent edits a temporary clone, retries a connector with the same invalid shape, stacks several
speculative fixes, or reports success from a build without checking the running feature.

`docs/MCP-FEATURE-IMPLEMENTATION.md` records the complete MCP implementation contract for tools,
trusted skills and project functions: public schema/name stability, scope, thin `lib/host`
delegation, audit metadata, limits/cursors, Alfa parity, toolset signature, external mappings,
client action refresh, trust/id routing, release handoff and layered runtime/browser proof. The
new official `mso-mcp-feature-engineering` skill makes that workflow searchable and reusable,
while root `AGENTS.md` gives non-Claude agents the same repository routing. Global agent
instruction files point to the same pattern; volatile host facts and secrets remain outside the
skill and repository policy.

## 2026-08-25 — 9Router configured-domain UI + official icon correction (DONE)

The first public-IP fallback pass made the fallback the preference: because every managed
9Router container publishes port 20128, `publicDashboardUrl` was always present and the UI
selected it before the already-configured split-origin host. On deployments such as this one
with `{id}.mso.rahmanef.com`, that replaced the real in-shell dashboard with a card that only
opened a new tab. Source precedence is now explicit: configured split-origin domain first,
public IP only when no embeddable domain exists. UI therefore renders the 9Router dashboard
inside the same managed-feature iframe shell as Hermes/OpenClaw.

9Router also no longer uses the generic Lucide Route placeholder. MSO copies the official
`/app/public/icons/icon-512.svg` from the current 9Router Docker distribution into its local
official-brand asset set and uses it in the shell, launcher, window and Details cards. The
legacy standalone deployment guidance now records the same
existing-domain-first/public-IP-fallback contract so future automation does not recreate this
regression.

## 2026-08-25 — 9Router public-IP-first managed-app correction (DONE)

The first 9Router managed-app pass incorrectly coupled the app surface to MSO's optional
split-origin hostname and documented 9Router as Docker-only. Live inspection disproved both
assumptions: the existing container was healthy on host port 20128 and the older standalone
hostname still worked, while the new `9router.mso...` path was an authenticated MSO proxy;
upstream also ships a real npm `9router` CLI. The result made a healthy app look like a DNS
problem and generated an invalid `9router status` terminal command.

The managed server runtime remains Docker by design (upstream's VPS path), but domain/DNS is
now explicitly optional. Definitions can declare a public host port; MSO derives a global
IPv4 locally and advertises 9Router at `http://<public-ip>:20128`. The UI opens that endpoint
as a separate top-level origin rather than attempting insecure same-origin proxying or an
HTTP iframe inside HTTPS. The CLI view starts with read-only Docker logs and never launches a
second 9Router process. Existing standalone domain routing is left untouched. Install/update/
uninstall continue through the Docker adapter and preserve `~/.9router`; dry-run removal is
part of the verification path.

Current managed-app, install, architecture, troubleshooting, env, README, and dedicated
9Router documentation now agree on the three-layer model: runtime management requires no
domain; direct public access is available where intentionally exposed; split-origin DNS/TLS
is optional embedding infrastructure.

## 2026-08-24 — 9Router joins the managed apps (one-click install/update/uninstall) (DONE)

Third managed app: 9Router (decolua/9router), the Docker-only AI gateway already serving
9-router.rahmanef.com from host port 20128. Unlike Hermes/OpenClaw it ships no CLI, so the
adapter contract is spoken by `scripts/managed-app-9router` — a repo-owned wrapper whose
verbs map onto Docker (`--version` reads the image's OCI version label, `check --json`
relays the app's own `/api/version` self-check, `update --yes` pulls latest and recreates
the container with the `~/.9router` data mount intact, `uninstall --yes [--dry-run]`
removes only the container). Two small seams were added to the definition for it:
`healthPath` (9Router answers `/api/health`, and the default `/health` 404s — which would
read as unhealthy forever) and `commandProvesInstall: false` (the wrapper exists on every
checkout, so its presence must not make an uninstalled 9Router read as "package" and lock
the Install button out). Everything else — install/update/rollback/uninstall jobs, backups,
the split-origin dashboard proxy, the Details panel — is the existing generic machinery;
`9router.mso.rahmanef.com` was added to the Traefik managed-apps file and the wildcard DNS
already covered it. The container itself was updated 0.5.50 → 0.5.55 the same day.



A point-in-time security audit combined Claude Fable 5 in Ultracode mode with an independent
dynamic/manual lane. Fable actually fan-out to 8 workstreams / 27 sub-agents (7 domain finders
plus 20 adversarial verifiers), while the second lane ran the security-relevant tests, route/auth
inventory, dependency audit, trust-boundary review, unauthenticated live probes and targeted race
reproducers. Full evidence and rejected candidates are in `AUDIT-2026-08-24.md`.

Three vulnerability classes survived verification. A nested deploy key named `id_rsa` was not
covered by the fixed `$HOME` credential denylist, and recursive ZIP could carry nested `id_*` /
`*.pem`; both are now basename-aware / force-excluded. More importantly, MCP OAuth/token and
device-approval JSON stores used atomic rename without serializing the enclosing read-modify-write
transaction. Stress proved single-use OAuth codes could be consumed twice, concurrent mints could
lose state, and successful token/device revocations could be overwritten by a simultaneous usage
touch. Security-store mutations now serialize in process and use one fail-closed cross-process
lock protocol shared with the operator device CLI; corrupt CLI store reads also fail closed. The
shared limiter no longer lets attacker-controlled pre-auth IP churn share eviction state with
authenticated token/owner-action buckets; public and privileged pools are separately bounded.

Permanent regressions pin concurrency, kill-switch integrity, nested private-key classification,
ZIP filtering, corrupt-store handling and limiter churn. Pre/post stress evidence is kept in the
audit rather than this running log. Release verification and live post-ship probes are required
before this entry is considered shipped.

## 2026-08-24 — one-line install now ends in terminal onboarding + reviewed skill market (DONE)

The one-line installer previously did the build/service work but stopped at a block of
printed next steps. It created `~/.local/bin/mso` and merely warned when that directory was
not on the current PATH; because `curl | bash` runs in a child process, exporting PATH there
cannot make `mso -h` available in the parent shell. It was also intentionally
non-interactive, so a successful fresh install felt like "nothing happened" once the build
finished.

Fresh service installs now create the user launcher plus a guarded `/usr/local/bin/mso`
symlink (only when the name is free or already points into this install), persist an
idempotent `~/.local/bin` fallback in the normal shell profile, and assert that `mso` is
resolvable before finishing. Uninstall removes only launchers that still point into the
MSO checkout. The bootstrap remains pipe-safe, but a **fresh** interactive install opens
`/dev/tty` after health succeeds and launches new `mso onboard`; existing installs do not
repeat it unless `--onboard` is passed, `--no-onboard` suppresses it, and no-TTY/cloud-init
installs never block. `-y` runs safe minimal onboarding: it leaves external AI accounts,
response style, optional managed apps and community skills untouched.

`mso onboard` is reusable and configures the existing surfaces rather than inventing a
second settings store. It can connect Alfa through OpenAI ChatGPT/Codex device OAuth, or
securely read an Anthropic/OpenAI Platform/OpenRouter/Google/Groq/xAI/DeepSeek/Mistral API
key from the controlling terminal with echo disabled and post it via stdin rather than
process argv. It exposes Normal/Caveman/Ponytail response presets, optionally runs the real
Hermes/OpenClaw managed-app install jobs while streaming their transcripts, then presents
the reviewed skill market. Managed-app provider state remains explicitly separate from
Alfa credentials. Settings' old "Codex is chat-only" copy was removed because the current
Codex Responses adapter forwards Alfa tools.

The new curated skill market is intentionally different from general skill discovery.
`mso skills available/info/install/remove` installs exact committed, SHA-256-checked
`SKILL.md` files into the explicit operator-trust root `~/.mso/skills`, recording
`.mso-market.json` provenance. `-y` confirms only the entries the operator selected; it
will not overwrite a modified/local skill without an additional explicit `--force`, and
removal refuses directories it did not install. Initial reviewed entries are pinned
Ponytail 4.9.0, Caveman 1.0.2, and an MSO-authored safe RTK wrapper. RTK deliberately does
not copy the current upstream auto-setup instructions: it uses RTK only when the binary is
already installed and never runs an unpinned remote installer, edits shell profiles or
enables global hooks without a separate explicit system-change request. Caveman/Ponytail
remain available independently as Alfa response presets; selecting a preset never silently
installs the full skill.

README, `docs/INSTALL.md`, generated `docs/CLI.md`, `skills/README.md`, and the public
`/install` page now describe this same lifecycle. Regression tests pin installer TTY/PATH
behaviour, public install copy, credential transport, safe `-y`, skill hash/provenance,
modified-skill overwrite refusal, and unmanaged-skill deletion refusal. Full verification:
185 test files / 1,585 tests passed (1 expected fail, 4 skipped), typecheck green, lint has
the one pre-existing max-lines warning and zero errors, docs checker reports 38 Markdown
files / 28 MCP tools / 21 slices / 10 AppShell feature dirs, 9 official skills are valid,
value cycles remain zero, contrast has zero AA failures, and the high/critical dependency
audit is clean.

## 2026-08-24 — documentation authority + ChatGPT MCP guide (DONE)

The documentation set was audited against current source and the deployed/public MCP
contract instead of patching isolated stale paragraphs. `docs/README.md` now classifies the
repository into current reference, generated/current records, historical point-in-time
plans/audits, and marketing collateral; `docs/ARCHITECTURE.md` is current again, while the
June audit and old shell/BYOK plans keep their original evidence behind explicit historical
banners. The long-standing `PROGRESS.md` header that incorrectly said Architecture was no
longer maintained was corrected without rewriting old entries.

MCP/ChatGPT documentation is now split by responsibility. `docs/MCP.md` remains the deep
protocol/security/discovery/workflow reference, and new `docs/CHATGPT-PLUGIN.md` is the
operator-facing custom MCP app guide with architecture, OAuth sequence, scope/tool,
tool-snapshot refresh, workflow-id, ChatGPT-file-upload and credential-boundary Mermaid
diagrams. At that 2026-08-24 snapshot it recorded server `1.6.0`, toolset `2026.08.21.1`,
28 tools (15 read / 10 write / 3 exec); those counts are historical, while Settings → MCP and
`GET /mcp` are the current authority. The guide also documents the authorization-code-only PKCE flow and
90-day bearer reauthorization boundary, and clearly separates MSO MCP OAuth from Alfa's
OpenAI Codex/ChatGPT-subscription OAuth. Current OpenAI Developer Mode availability and
frozen-action behaviour are labeled as an external dated dependency rather than an MSO
promise.

Managed-app, Hermes, OpenClaw, install, security, troubleshooting, FAQ, model-provider and
slice references were brought to current behaviour: no runtime `/features` scraping or
workspace modes, no supported same-origin vendor dashboard, restore/update/install jobs are
documented, Camoufox replaces the retired Playwright daemon, current persistent profile
paths are explicit, and deploy/recovery uses `bun run ship` / `mso update run --rebuild`
instead of stale manual production build instructions. Official operational skills were
updated where their managed-app/deploy capability maps had drifted.

A new committed `scripts/check-docs.mjs` now makes common drift a quality-gate failure. It
checks relative Markdown links and generated CLI freshness, requires every `docs/*.md` to
be classified, validates current MCP version/scope/tool **names** in the three contract
docs, and validates actual slice/AppShell feature names/counts. `package.json` and
`scripts/gates.sh` both run it. Verification: full `bun run verify` exit 0; 181 test files
passed (1 skipped), 1573 tests passed (1 expected fail, 4 skipped); 0 value cycles; docs
checker reports 38 Markdown files / 28 MCP tools / 21 slices / 10 AppShell feature dirs;
9 official skills valid; WCAG palette audit 0 AA failures; dependency audit clean at
high/critical. One pre-existing max-lines lint warning remains in `lib/mcp/dispatch.test.ts`.

## 2026-08-21 — opt-in project MCP/function capabilities; stock MSO unchanged (DONE)

Project-specific automation no longer requires a business-specific feature in MSO. A
validated project may opt in with `.mcp.json` (presence only; contents/credentials are
never exposed) and `.mso/functions.json` (versioned public schemas + fixed argv). The
public MCP catalog stays stable: `project_capabilities` discovers one project's declared
surface and `project_function_call` executes one declared function at **exec** scope.
Function names are data, not dynamic MCP tool names, so switching projects does not alter
the model tool prefix or invalidate the prompt cache. Caller input is JSON stdin to
`spawn(argv)` — never shell interpolation — and child processes inherit the existing
credential-scrubbed environment. No manifest means no extra capability.

The same opt-in rule now applies to public machine ingress.
`OS_PROJECT_INGRESS_ROUTES` defaults to empty; when explicitly configured it permits at
most eight exact POST paths on known managed-app hosts, targets loopback HTTP only, and
requires HMAC-V2-shaped JSON traffic before the app-host CSRF gate. The loopback app still
verifies the real secret. There is no project/product name or webhook path compiled into
MSO. Tests pin both sides: stock MSO remains closed, malformed/off-box/wildcard routes fail
closed, `.mso` symlinks are ignored, project commands cannot interpolate caller strings
into a shell, and project function execution remains exec-only. Toolset advances to
`1.6.0` / `2026.08.28.1`: **31 tools** (16 read, 10 write, 5 exec).

## 2026-08-20 — lossless continuation and exact-id project resolution (DONE)

The final fail-closed review found six remaining items. Five were continuation bugs of the
same species — a cursor that *described* where a scan stopped instead of *being* a position
you could resume from.

**Hidden `rootHint` still resolved.** `validateRootHint` checked the final entry for
symlink, shape, uid and credentials but never for a dot-prefixed component, so supplying
`<authorized-root>/.hidden` as the root resolved a project underneath it by exact name
while enumeration refused the same tree. The hidden check is now measured *relative to the
authorized root*: the root's own path may contain dot components (a checkout under
`~/.claude/worktrees` does), but nothing below it may.

**`maxRoots` could not advance, ever.** `listProjectDirs()` rebuilt the same capped
`projectContainers()` on every call, so a 13th configured root stayed pending no matter how
many times a client followed the cursor. Root identity is now an index into the *uncapped*
configured list, `authorizedRoots(startIndex)` slides that window forward, and the
continuation carries the index of the first root the scan could not honour.

**`maxProjects` and `maxProjectSkills` lost entries.** Both derived a readdir position from
sorted accepted rows and a global result count — arithmetic that cannot be truthful, and
which emitted `entriesConsumed=400` for a root holding 250 dirents. Both walks are now a
single streaming pass: each dirent is validated as it arrives, every cap is checked
*before* the entry is touched, and the recorded position advances *only after* the entry is
fully handled. The skill cursor separately records roots that finished cleanly, projects
whose every root finished cleanly, and the exact position inside the one interrupted root —
a partially consumed project is re-listed and resumed rather than marked done.

**Deadlines skipped unprocessed entries.** Both scanners read every name, sorted, then
validated; a deadline expiring during validation left the position past names nothing had
looked at. Same streaming fix — the cursor cannot outrun the work.

**Exact project ids were unusable through `workflow_start`.** `resolveProjectHint` had no
root-qualified-id branch, so `<rootId>/<name>` fell through to fuzzy matching and, with two
same-named projects, returned the *wrong* one. An exact `<32-hex>/<name>` is now parsed and
resolved before alias, package or fuzzy; the rootId maps to exactly one container across
every configured root; an unknown rootId is refused rather than guessed.

The colliding pair from the previous review (`/tmp/mso-root-50323` and
`/tmp/mso-root-125549`, both `51e156ef` at 8 hex) is now an end-to-end regression:
`projects_list`, `skills_list`, `skills_read`, `skills_search` and `workflow_start` each
return the **second** project when handed the second id. Continuation reproducers drain
13 roots, 2×250 projects, a 437-entry root and a 150+160-skill pair to completion and
assert no row is dropped or repeated. Note that there are deliberately two paginations —
`hasMore`/`nextOffset` within one scan, `scan.continuation.cursor` across scans — and the
docs now say so, because conflating them looks exactly like data loss.

The positive suites are unchanged and green: all-agents-all-tools, the exec/read/write
ladder, image generation removed everywhere, `fs_upload_file` with regional ChatGPT import,
and auth/OAuth untouched. `project-identity.ts`, `project-authorized-roots.ts` and
`catalog-cursor.ts` split the work so every file stays under 200 lines and the value-cycle
count stays at zero. The MCP server/toolset advance to `1.5.3` / `2026.08.20.6`; the catalog
stays at **26 tools** (14 read, 10 write, 2 exec).

## 2026-08-20 — one validator, dirent-counted budgets, resumable caps (DONE)

A second fail-closed re-review of the discovery hardening found six things still open.
Five of them share a shape: a rule enforced in *one* code path and assumed everywhere
else.

**UID and symlink rules existed only in the walk.** `listProjectDirs()` rejected a
project owned by another uid, but `resolveProjectHint`'s exact-name, alias and path
strategies did not — so `workflow_start` could resolve, and read metadata from, a project
`projects_list` correctly refused to show. `rootHint` went through `resolveReadable()`,
which canonicalizes and therefore *follows* a symlinked root, and a path hint accepted
hidden or symlink-reached directories inside it. There is now ONE validator
(`lib/host/project-candidate.ts`) and every strategy calls it: hidden component, symlinked
component (target legal or not), container/authorized-root escape, credential path, uid
ownership — ownership before any metadata read. A path hint is checked component by
component from the container down, because canonicalizing first and validating afterwards
is precisely what let a symlinked intermediate through. `rootHint` is validated the same
way, and authorized against *every* configured read root rather than the scan-capped
subset, so naming a root neither widens the jail nor shrinks it.

**`readSkillFile` was nofollow at the wrong path.** It realpath'd the supplied path, saw a
basename of `SKILL.md`, and opened the *target* with `O_NOFOLLOW` — enforcing the promise
against a path the caller never gave us. A `SKILL.md -> other/SKILL.md` symlink sailed
through. The supplied path is now opened directly, so any symlink at that component fails
with ELOOP; parent containment is a separate check, kept separate so the final component
is never dragged back through `realpath`. A symlinked `SKILL.md` is no longer an untrusted
skill — it is not a skill, and it is dropped from the catalog.

**Budgets counted the wrong thing.** Both walks incremented their entry cap only for
*accepted* entries, so a container holding a million regular files still cost a million
iterations before the "400 entry" cap was reached — the cap bounded the result, not the
work. Every dirent now consumes budget, and the deadline is enforced through the
per-entry `lstat`/`realpath`/metadata work as well as the dirent loop. The overall
300-project-skill cap moved inside the candidate loop; checking it only before each root
let one root carry the total from just under 300 to nearly 500.

**Caps were reported but not continuable.** A truncated scan named its reason and stopped.
Every cap now emits `scan.continuation`: pending roots, per-root cursors, and an opaque
`cursor` to pass back to `projects_list` / `skills_list` to resume where the walk stopped.
Cursors are positional in readdir order and say so — name-ordered resume would require
visiting every dirent, which is the unbounded walk the cap exists to prevent. Ordinary
paging within one scan gained `hasMore`/`nextOffset`.

**Eight hex characters is not a unique id.** `rootId` was 32 bits of sha256, and a probe
found a genuine collision: `/tmp/mso-root-50323` and `/tmp/mso-root-125549` both hash to
`51e156ef`, which would have merged two roots' same-named projects back into one row —
the exact bug root-qualified ids were introduced to fix. It is 128 bits now, both sides
share one `shortId` rather than each computing its own, and nothing dedupes on the hash at
all: the internal key is the full canonical path, so even a collision cannot merge two
containers. The collision pair is a regression fixture.

Regressions cover each: exact/path/alias uid mismatch, symlinked and hidden `rootHint`
and path hints, `SKILL.md -> SKILL.md`, a root of non-directory entries exhausting the
cap, `maxProjectSkills` overshoot, resumable continuation for entry and project caps, and
the deliberate root-id collision. The positive suites are unchanged and green:
all-agents-all-tools, the exec/read/write ladder, image generation removed everywhere, and
`fs_upload_file` with regional ChatGPT import. `project-candidate.ts`, `project-cursor.ts`,
`project-list.ts` and `project-scan-types.ts` split the work so every file stays under 200
lines. The MCP server/toolset advance to `1.5.2` / `2026.08.20.5`; the catalog stays at
**26 tools** (14 read, 10 write, 2 exec).

## 2026-08-20 — discovery containment, honest bounds and unique ids (DONE)

A fail-closed review of the discovery release found three things worth blocking on, and
all three came from the same habit: treating "we checked the happy path" as containment.

**A symlinked `projects/` escaped the read jail.** `<root>/projects` was accepted on a
plain `realpath`, so with `OS_FS_READ_ROOTS=/safe` and `/safe/projects -> /outside`, the
enumerator walked `/outside` and project-skill discovery could mark same-uid skills there
`local` — instructions handed to a model from outside the jail entirely. Each configured
root is now canonicalized ONCE into an authorized root; a derived container must be a
REAL non-symlink directory whose realpath stays inside that same root. A symlinked
`projects/` is refused even when its target is currently legal, because accepting it is a
TOCTOU bet. Every project candidate is re-checked too: non-hidden, non-symlink, realpath
still inside its exact container AND an authorized root, and owned by MSO's uid — checked
BEFORE any metadata read, so a directory another user controls never reaches the readers.

**The advertised limits bounded nothing.** `readdir` materialized a whole container
before slicing, global skill roots had no entry budget at all, and `package.json`,
`SKILL.md` and `packed-refs` were read in full and sliced afterwards — so one read-scope
`projects_list` on an attacker-influenced tree was a memory-exhaustion primitive. Both
walks now use `opendir` and stop at the cap, global skill roots got the budget they were
missing, and every metadata read goes through one `O_NOFOLLOW` reader that checks the cap
against `fstat` before any bytes move. Each walk also carries a 4-second wall clock.

**Truncation lied.** `projectRoots()` returned early after 12 roots and each container was
silently sliced to 400 entries, yet only the separate 400-project condition set
`truncated`. A caller could be told the scan was complete while configured containers were
never opened. Every discovery response now carries a scan report: `truncated:false` means
"this is all of it", and any cap sets `truncated:true` with a named reason
(`maxRoots`, `maxEntriesPerRoot:<path>`, `maxProjects`, `maxProjectSkills`, `deadline`)
plus `scannedRoots`, `skippedRoots` and a count of rejected entries. `workflow_start`
carries `discovery.complete` and adds a `[Discovery] partial scan` trace line, and the
tool descriptions tell the client not to conclude something is absent from a truncated
scan.

**Ids were not unique.** A project skill was `<project>/<name>`, deduped by that string,
so two configured roots each holding a `widget` collapsed into one row and a whole
project's skills were unreachable. Identity is now root-qualified: a project is
`<rootId>/<name>` and its skills `<rootId>/<project>/<name>`, where `rootId` is a short
sha256 of the canonical container path. The derived `projects/` container gets its own id
for the same reason, so `~/widget` and `~/projects/widget` no longer collide. `skills_read`
takes the exact id and REFUSES an ambiguous bare name with the candidate list rather than
returning one project's instructions under another's name; `skills_list`'s project filter
accepts an exact projectId, a path or a bare name, reporting `ambiguousProjects` when a
bare name spans roots.

**`rootHint` was half-wired.** Exact names probed the named root, but package and fuzzy
resolution walked the global capped list and filtered — so a readable root absent from
that list could never match by package or fuzzily. All three strategies now run inside the
named root, and a path hint may not leave it. The exact-name probe also refuses a symlink
(target legal or not) and a hidden directory, matching what enumeration excludes.

Regressions cover every one of these: escaping and inside-jail symlinked containers,
symlinked project entries, 13+ configured roots, 401+ entries in one container, duplicate
project basenames across roots, oversized `package.json`/`SKILL.md`, uid mismatch,
`rootHint` package and fuzzy resolution, and truthful truncation. The positive suites are
unchanged and still green: all-agents-all-tools, the exec/read/write scope ladder, image
generation removed everywhere, and `fs_upload_file` with regional ChatGPT import.
`lib/host/project-containers.ts`, `project-roots.ts`, `bounded-read.ts` and
`lib/skills/catalog-scan.ts` split the work so every file is back under 200 lines. The MCP
server/toolset advance to `1.5.1` / `2026.08.20.4`; the catalog stays at **26 tools**
(14 read, 10 write, 2 exec).

## 2026-08-20 — global project/skill discovery, and image generation removed (DONE)

**Capabilities are global now, and the docs say so.** Two invisible scopings shipped
together and were both wrong for the same reason: MSO answered "what projects exist"
and "what skills exist" from `~/projects` and the global skill roots alone. An owner
who configured three read roots got one of them, and an agent working in project X
could not see X's own `SKILL.md`. Nobody decided either; they were defaults nobody
revisited. A capability that silently covers a subset of what the owner configured is
worse than one that refuses.

Three new `read` MCP tools. `projects_list` enumerates project directories across
every configured container — each `OS_FS_READ_ROOTS` entry plus its `projects/` child,
deduped by realpath, in configured order — with name, path, container root, package
name/version and Git branch/head read straight off `.git` with no subprocess. Hidden
dirs, symlinks and credential paths are excluded; the scan is bounded (12 containers,
400 entries each, 400 projects) and paginated (default 50, max 200). `/` is never a
container. `resolveProjectHint` searches the same containers, exact-before-fuzzy: an
absolute/`~` path wins outright, then an exact name or alias probed container by
container, then one bounded scan scoring exact package names above substrings — so an
exact name in the second container beats a substring hit in the first.

`skills_list` and `skills_read` merge the global roots with the **per-project** roots
of every project: `.mso/skills`, `.claude/skills`, `.hermes/skills`, `.agents/skills`,
`.codex/skills`. Skills are now addressed by a catalog **id**: a global skill by bare
name, a project skill as `<project>/<name>`. Two projects may both ship `deploy` and
neither can displace an operator or official skill — the collision is impossible rather
than resolved. `skills_read` takes the exact id and does not fuzzy-resolve into a
project namespace. Project trust is EARNED, not inherited from the path: `local` only
after realpath containment inside the project, ownership by MSO's uid, and a regular
non-symlink `SKILL.md`. Everything else stays `untrusted` — metadata visible,
instructions withheld until the operator reviews and promotes it into `~/.mso/skills`.
The generic HOME agent roots keep their untrusted behaviour unchanged. `workflow_start`
and `skills_search` search the unified catalog and each skill hit carries its project.
Bounds: 60 projects, 100 skills per root, 300 project skills, 24,000 characters per read.

`skills_list`/`skills_read` therefore exist on BOTH surfaces now, and their old
`ALFA_ONLY` parity exemption ("stays off a bearer-reached surface") is gone. That was
the right call for a fuzzy name-resolving reader; it is not for one that takes an exact
catalog id, returns instructions only for trusted tiers, and still opens nothing but a
realpath'd file named `SKILL.md`.

**The global-tools invariant is now pinned, not just described.** Alfa already sent
every tool on every turn; MCP already showed an `exec` token everything. Neither had a
test that would fail if someone added a per-project filter. `lib/mcp/global-tools.test.ts`
and a new block in `registry.test.ts` hold both: the exec catalog equals `TOOLS` exactly,
`read`/`write` are strict prefixes by tier and nothing else, `workflow_id` is optional on
every operational tool, `HOST_AI_TOOLS` is the same whole-catalog object every turn, and
`registry.ts` exports nothing that could narrow it. The `read`/`write` opt-down and the
`exec` consent default are unchanged and covered — the ladder is the security boundary;
which tools exist is not.

**Image generation is removed end-to-end.** `image_generation_status`, `image_generate`,
`lib/image-generation/`, `OS_IMAGE_MODEL`, `OS_IMAGE_OUTPUT_ROOT`, the `image.generate`
audit action and workflow-memory entries, and the Codex provider-side `image_generation`
built-in are all gone. A GPT client already carries its own image generation; offering a
second tool for the same job made the model choose between them, usually wrong, and the
MSO one billed a separate API key. `OS_CODEX_BUILTIN_TOOLS` now defaults to EMPTY and no
longer accepts `image_generation` — naming it explicitly is dropped, not honoured, and a
test pins that. **`fs_upload_file` is deliberately preserved**, regional ChatGPT file
import and `openai/fileParams` binding intact: generating elsewhere and importing here is
the whole remaining flow. No tool description tells a client to prefer a native or
provider image tool, and a test greps for that wording.

`lib/mcp/tools.ts` shed `apps_power`/`browser_power` into `tools-power.ts` and the new
tools live in `tools-discovery.ts`, so every file is back under the 200-line ceiling.
`lib/host/project-meta.ts` and `project-roots.ts` split the symlink-refusing readers from
the container enumeration. The MCP server/toolset advanced to `1.5.0` / `2026.08.20.3`,
with **26 tools** (14 read, 10 write, 2 exec). See the entry above for the containment,
bounds and id-uniqueness fixes that followed the review of this release.

## 2026-08-20 — provider-backed MCP image generation (SUPERSEDED — removed same day)

MCP now exposes `image_generation_status` (read) and `image_generate` (exec).
Generation uses the official OpenAI Images API rather than the prior procedural
icon scripts or the internal unofficial Codex backend. One billed call creates one
lossless PNG sandbox master plus a prompt-free 0600 provenance sidecar containing
provider/model/request id, prompt and byte hashes, dimensions, alpha status and
eligibility findings. The raw prompt is excluded from activity, audit and learned
workflow memory. The output root is write-jailed (`OS_IMAGE_OUTPUT_ROOT`, default
`~/generated-images`), generated filenames are unique, temporary previews remain
authenticated/expiring, and image calls are limited to 5/min. The MCP server/toolset
advance to `1.4.0` / `2026.08.20.1`, with **24 tools**.

## 2026-08-20 — image generation and full-access defaults (image half SUPERSEDED)

Fresh MSO installs now expose Codex provider-side `image_generation` when
`OS_CODEX_BUILTIN_TOOLS` is absent, matching the owner's expected assistant capability.
An explicit empty value still disables every provider built-in, and an explicit list
replaces the default through the existing allowlist. Regression tests cover the default,
the opt-out, and unknown-tool filtering.

MCP now defaults its ceiling to `exec`, and the OAuth consent form preselects the highest
tier that ceiling permits, so “Allow” grants full access without an extra radio change on
the owner's single-user deployment. `OS_MCP_MAX_SCOPE=read|write` still opts the whole
server down, malformed explicit values fail closed to `write`, the form still shows the
full-shell warning, and the server action keeps absent/unknown submitted scopes at `read`.

## 2026-08-19 — isolated parallel workflows and a skill-flow factory (DONE)

The first bootstrap release still had one unsafe fallback: active workflow memory was
keyed only by MCP actor, so a second conversation using the same token silently replaced
the first, and `workflow_finish` could omit its id and close whichever run happened to
be active. A real reconnect had already produced a mismatched learned recipe this way.

Workflow memory is now a v2 multi-run store. Every `workflow_start` receives a unique
id, and multiple conversations may run safely in parallel on the same MCP token. Both
`workflow_finish` and the new `workflow_cancel` require that exact id; cancel removes
only the interrupted run without creating a recipe. Every operational schema carries an
optional `workflow_id`: exact-id calls join that recipe, missing-id calls remain
standalone, and unknown ids are refused before execution. The loader migrates a live v1
actor workflow without dropping it, serializes concurrent cold loads, prunes stale runs,
and bounds each actor to 20 active workflows. Workflow cancel is audited, Activity
renders cancelled runs explicitly, and migration/parallel/wrong-id cases have regression
tests. The reusable best path is also compressed to at most 24 completed steps while the full redacted evidence remains available, preventing a long audit from becoming a 300-call recommendation. The MCP server/toolset advance to `1.3.0` / `2026.08.19.2`, with **22 tools**.

Skill authoring is now repeatable rather than copy-paste. `bun run skill:new` renders
`templates/mso-skill-flow/SKILL.md.template` into a new official skill and refuses an
overwrite. The template standardizes selection boundaries, bounded-vs-terminal routing,
visible operational trace, done conditions, rollback, approvals and recipe redaction.
`bun run skill:check` validates every official skill's directory/name, description,
risk, policy, H1, unresolved placeholders and 200-line ceiling, and is part of the main
`check` gate. The new trusted `mso-skill-authoring` playbook explains the flow.

OAuth consent now also forces a visible top-level callback. The previous success path
called Next's `redirect()` from a Server Action nested inside a client form action. The
authorization callback could run through the action transport—ChatGPT exchanged the code
and created an exec token—while the MSO tab remained on “Connecting…”. The server action
now returns only its already-validated, PKCE-bound callback URL, and the client performs
`window.location.replace()`. This preserves the same-origin approval boundary while making
the browser visibly leave MSO for ChatGPT; non-HTTPS non-loopback targets are refused again
at the browser boundary.

## 2026-08-19 — MCP one-call bootstrap, visible workflows and faster repository work (DONE)

A refreshed ChatGPT connection proved the server really exposed all 21 MCP tools, but
it also made the remaining orchestration cost visible. The client still had to search
skills and start a workflow as separate calls; `os-vps` no longer matched the renamed
`mso` directory; MCP activity was a flat list even though the backend already stored a
`workflowId`; tool descriptions and schemas could change without an operator-visible
signature; and the systemd environment handed `exec_run` no `~/.bun/bin`, so every Bun
command first failed or required an absolute path. The live baseline also returned no
toolset metadata from `GET /mcp`, and `fs_search("os-vps")` returned an empty result.

This release keeps the public catalog at **21 stable names** and makes the existing
`workflow_start` the one bootstrap call for multi-step work. It now starts the
actor-scoped workflow, searches trusted skills/tools/recipes, resolves the project,
returns package and Git context, reports the scoped toolset version/hash/count, and
emits the high-level `[MSO]`, `[Project]`, and `[Plan]` trace. `skills_search` remains the
standalone capability-research route; clients are explicitly told not to call it
immediately before `workflow_start` for the same task. Initialize instructions now
prefer bounded tools for one or two direct operations and one narrow terminal batch for
repository-wide search, Git, tests, builds, or three-plus related checks. They request
feature badges such as Skills, Files, Terminal, Git, Build, Verify and Screenshot—not
private chain-of-thought.

Project resolution now has safe aliases for `os-vps`, Manef Shell OS and MSO, with an
immediate exact-name/alias return instead of parsing every project package. Package and
Git metadata refuse symlinks. `fs_read` returns UTF-8 bytes plus SHA-256, and
`fs_write.expected_sha256` provides an optimistic stale-overwrite guard. Spawned shells
retain secret scrubbing but prepend the owner's `~/.local/bin` and `~/.bun/bin`, so Bun
and owner-installed CLIs work without rediscovery after restart.

The MCP protocol, public `/mcp` descriptor and Settings API now expose server version
`1.2.0` plus a schema-derived toolset signature (`2026.08.19.1`). Settings → MCP displays
that signature and records a browser-local acknowledgement after ChatGPT is refreshed;
a later change becomes a visible stale-snapshot warning. Assistant → MCP now groups
activity by workflow intent/project, collapses start/completion pairs, aggregates steps
and duration, and renders feature-specific icons. Only a completed `workflow_finish`
marks a workflow Verified; standalone calls are merely Completed. Workflow intent and
project are redacted/truncated before persistence.

Three official operational skills were added: `mso-repo-work`, `mso-deploy`, and
`mso-service-debug`. The MCP and external-integration documentation at that checkpoint treated the 21-tool
runtime signature as the cross-client contract and records that the gateway still maps
15 actions. New public `repo_*` or `job_*` names were deliberately not added in this
release: keeping the action catalog stable lets the refreshed connection benefit
immediately, while scoped terminal batching and the existing release/job infrastructure
cover the current bottleneck without another catalog expansion.

Verification before ship: targeted bootstrap, alias, symlink, guarded-write, toolset,
activity and dispatch tests passed; `bun run verify` passed typecheck and lint, **144 test
files / 1,351 tests**, the coverage thresholds (22.51% statements, 20.80% branches,
16.67% functions, 23.02% lines), 765-file cycle scan with zero value cycles, both light
and dark contrast audits with zero AA failures, and a clean high/critical dependency
audit. The committed pre-push gate performs the out-of-tree production build again
before any push, and `bun run ship` preserves the required commit → changelog → push →
build → restart order.

The first live ship exposed one more orchestration fact that tests could not simulate:
`exec_run` is a child of `mso.service`, and the service manager terminates the whole
cgroup when that process is replaced. The new build came up healthy, but the parent
release command died before it could write its exit file or perform its own chunk
check—`nohup` did not move it to a different cgroup. `ship.sh` now detects that
execution context after the gated push and hands rebuild-only
build/restart/verification to the existing owner transient `mso-self-update.service`.
The handoff has no request-derived shell payload, reuses the same fixed script and
one-hour bound as Settings self-update, writes `~/.mso/self-update.log`, and is
regression-tested with a fake `systemd-run` argv capture. SSH releases remain
synchronous; MCP releases must poll the returned unit/log until `UPDATE OK` before
declaring success.

## 2026-08-19 — v0.2.1: self-update stopped assuming passwordless sudo (DONE)

A real 0.2.0 installation exposed the gap: Settings found the incoming commits, but
pressing Update failed immediately with `sudo: a password is required`. Nothing had
been pulled or built, so the running copy stayed safe; the button was nevertheless
unusable on an ordinary VPS account. The installer never created a passwordless
sudo rule — correctly — while `startUpdate()` had silently required one.

The updater is non-root now. `startUpdate()` launches an owner-scoped transient unit
with `systemd-run --user`, which gives the build its own cgroup so it survives
replacing `mso.service`. At the end, the script reads the service's `MainPID`, proves
that PID belongs to the same uid as the updater, sends it `SIGTERM`, and waits for a
new active PID. The installed system unit's existing `Restart=always` starts the
fresh build; no sudo credential or broad sudoers exception is needed.

The preflight also refuses clearly when the per-user systemd manager is unavailable,
when `mso.service` is missing, or when the service belongs to another user. The
installer now starts `user@UID.service` after enabling linger and verifies that the
user bus answers, so a fresh install can use the update button immediately. Argument
construction has regression tests that explicitly reject `sudo` and a root-capable
`User=` property. Typecheck, lint, the architecture/contrast checks, dependency audit,
and the full 1,336-test coverage suite passed before release; the final rebuild-only
path was exercised against the live service and ended in `UPDATE OK`.

Existing 0.2.0 installations need one interactive installer run to receive this fix,
because the broken updater cannot bootstrap its own replacement. After that one-time
migration, future Settings updates run without a sudo prompt.

## 2026-08-17 (audit) — a codebase pass: what was duplicated, what had drifted, what was undefended (DONE)

Not a UI pass. Scanned for dead exports, parallel implementations, unguarded
contracts and untested risk, then fixed what was real. What the scan found and what
it did NOT find are both worth recording.

**Duplication that was also a bug.**

- **Six copies of "download this URL"**, disagreeing on the two details that decide
  whether the file arrives. Two clicked a DETACHED anchor — Firefox ignores
  `download` on one, so it navigates instead of saving, and one of the two was the
  Settings → Backup export. Three disagreed on when to revoke the blob (0 ms / 2000 ms
  / never; same-tick revocation lands a 0-byte file in Firefox and Safari). Now one
  `saveAs()` in appshell, with both rules and a test that asserts the anchor was in
  the document AT THE MOMENT of the click.
- **Three copies of POSIX path math.** Files' `joinPath` did not strip a trailing
  slash, the Code editor's did, Preview's sibling lookup carried a third regex. These
  strings become the `path=` of an `/api/v1/fs` request, so `/a//b` is a different
  path to a host that resolves it literally. One `lib/path.ts` now — `lib/`, not
  appshell, because the framework may not depend on mso's lib and this is the same
  universal category as `cn`.
- **Files' icon + colour tables had drifted from Preview's format table**: a `.heic`
  drew a generic grey icon and a `.m4v` an uncoloured one, because the local sets
  predated the viewer's. Both read `kindForName` now; the dead sets are gone.

**A test-runner bug that was hiding, not helping.** `vitest.config.mts` listed
`"@": root` BEFORE `"@/features"`, and Vite tries aliases in insertion order — so
`@/features/os-shell` resolved to `<root>/features/os-shell`, which does not exist.
No test had happened to pull a slice barrel into its graph, so it read as green
until one did. tsconfig had it right the whole time; only the runner disagreed.

**Contracts nothing was checking, now checked.**

- `media-viewer/lib/kinds.ts` ↔ `lib/host/fs.ts`: every extension Preview points an
  element at must have a real Content-Type, or the element errors and the operator
  is told their browser cannot decode a file it decodes fine. The same test asserts
  the map NEVER grows an executable document type — `text/html` there would make any
  host file an active document on the cockpit's origin.
- `.env.example` ↔ `process.env`: CLAUDE.md carried this as a chore, and the chore
  had slipped. `OS_CODEX_BUILTIN_TOOLS` — which turns on provider-run tools that BILL
  to the owner's account — was readable by the code and documented nowhere. Now a
  test, with an exemption list that is itself checked for staleness (it caught two
  entries for vars nothing reads any more).

**A real hole in the credential denylist.** It blocked shell HISTORY but not the
shell RC and PROFILE files, and `~/.bashrc` on this box holds eight
`export …_TOKEN=` lines — put there by tooling that says "add this to your shell
profile". `fs/read` handed them over, and the assistant's read-tools run with no
approval gate. Blocked now (`.bashrc`, `.zshrc`, `.profile`, fish config, …),
verified against the running service: `.bashrc` → 400 "credential/sensitive files
is blocked", `.gitconfig` and `.vimrc` still readable. `OS_FS_ALLOW_SENSITIVE=1` is
still the escape hatch, and a terminal window is right there.

**The riskiest route had no test.** `/api/v1/sys/update` replaces the code the whole
cockpit runs. It now has six: signed-out gets nothing on either verb AND the host is
never touched, `?check=0` really skips the network round trip, `rebuildOnly` is only
honoured when it is exactly `true` (a hand-rolled client sending `"yes"` must not
mean "rebuild"), a refusal is its sentence and a 400 rather than a 500, and BOTH the
start and the refusal reach the audit log while a read reaches nothing.

**Also:** the update status read its log file twice per poll (every 3 s during a
build); coverage thresholds ratcheted 19/18/14/19 → 20/18.5/15/20.5, a hair under the
measured 20.47/19.2/15.15/20.86, per the rule written above them.

**Deliberately not done**, so the next pass does not re-derive it:

- `verifyAuth(req)` discards its argument — it is a one-line wrapper over
  `requireSession()`, and the parameter invites the reading that the request is
  checked (it is not; `proxy.ts` owns origin). Removing it is ~40 mechanical route
  edits, and another session was pushing to this repo the same hour. Worth doing
  solo, not worth a collision.
- ~180 "unused" exports are mostly types re-exported as the appshell framework's
  public surface, or consumed structurally. Only ONE module was genuinely dead
  (`components/ui/segmented.tsx`) — and it was a false positive: four slices import
  it under a name the scan's regex missed. Left alone.
- Preview's sample gallery (7 files) parallels the real viewer, but the public demo
  is its live consumer — mock data has no bytes to render, so those samples are the
  only thing the demo can show.

## 2026-08-17 — the deploy became a button, and Preview learned the rest of the disk (DONE)

Two PRs from the fork merged first (#2 user bus, #3 dashboard silence), then two
features on top. The audit gate had been failing on `main` before any of it —
`GHSA-2v37-7h3g-55p8`, nanoid `<3.3.18` through postcss — so `main` was unpushable
without `--no-verify`; pinned via `overrides`, which is what the gate's own message
asks for.

**Software update, in Settings → About.** Prod is systemd with no webhook, so a
commit on main changed nothing anyone could see until someone with ssh rebuilt. Now
the panel reports what is on `origin/main`, lists the incoming commits, and runs the
deploy.

Three things about it are load-bearing:

- **The work does not run in `mso.service`.** Replacing that service makes systemd
  kill its whole cgroup — a detached child included. It would die mid-`next build`,
  with `.next` already deleted and nothing to restart into. `startUpdate()` now hands
  the job to the owner's TRANSIENT user unit via `systemd-run --user`; that separate
  cgroup survives while the script signals the same-uid service PID and lets
  `Restart=always` bring MSO back. The original 0.2.0 implementation used a system
  transient unit through `sudo -n`, which failed on normal password-protected sudo
  accounts and was replaced in 0.2.1.
- **It verifies out-of-tree BEFORE building in place.** `scripts/ship.sh` is run by a
  person who is watching; this is run by an operator who pressed a button and walked
  away. `scripts/verify-build.sh` proves the pulled HEAD compiles without touching
  the live `.next`, so a commit that does not build becomes a refusal instead of an
  outage. An in-place build cannot be undone — there is no old `.next` to put back.
- **Nothing from the request reaches a shell.** The only knob is a boolean; the ref
  is hard-coded to `origin/main`. Refusals (dirty checkout, already up to date, one
  already running) are computed in a pure `blockingReason()` so they happen before
  anything is touched, and `sys.update` is a new audit action — this replaces the
  code the whole cockpit runs.

The panel's "Release notes and docs" drawer lists the incoming commits (from
`git log HEAD..origin/main`, because the CHANGELOG in this checkout is by definition
the old one — it arrives WITH the update it describes), then the shipped changelog,
then links to README/CHANGELOG/PROGRESS/CLI. `mso update status|run|log` is the same
surface from a shell.

**Preview now covers the disk, not four formats.** One table
(`media-viewer/lib/kinds.ts`) exported through the slice barrel and used by BOTH the
viewer and Files, so the two can no longer disagree about what a `.heic` is:

- image/video/audio grew the Windows + macOS defaults (heic/heif, tiff, jfif, m4v,
  wmv, mpg, 3gp, opus, aac, wma…). The server MIME map grew to match — **passive
  types only**; `text/html` there would make any host file an active document on the
  cockpit's origin, which is the same hazard the SVG `sandbox` header already exists
  for.
- **text, Markdown, CSV/TSV and HTML** render, and their bytes are FETCHED (Range-
  capped at 512 KB) rather than framed. HTML goes into a `sandbox=""` `srcdoc` frame:
  no scripts, opaque origin, and therefore no relative assets — the price of not
  handing a host file the session's origin.
- **Documents and archives are `none` on purpose** (docx/xlsx/pptx/pages/zip/dmg/exe…).
  A browser cannot render them, and a viewer that pretends otherwise shows a blank
  frame that reads as MSO being broken. They get a card that names the format and
  offers the download.
- **← → through the folder**, plus the arrow keys, on every previewable file. The
  sibling list comes from one `fs.list` of the parent, not from the payload, so a
  window opened by deep link or by the assistant pages exactly like one opened from
  the grid.
- Files gained **Preview** in the context menu and **Space** as its shortcut (the
  macOS Quick Look binding), because a `.md` or `.csv` double-click correctly goes to
  the editor, and reading it is a different verb from editing it.
- **Long-press opens that menu on a phone.** Touch has no contextmenu event worth
  relying on (Chrome Android fires one, iOS Safari mostly does not), so on mobile the
  ENTIRE context menu — Preview, Rename, Download, Move to Trash — had never been
  reachable. 500 ms, 10 px drift cancels, and the click the finger-lift produces is
  swallowed so it neither opens the file underneath nor dismisses the menu it just
  opened. Its rows are 44 px on coarse pointers now, for the same reason.

**Found while verifying, and fixed:** the panel first reported the CHECKOUT's HEAD as
"running", which is only true until someone pulls without rebuilding. `next.config`
now bakes the commit into the bundle (`NEXT_PUBLIC_COMMIT_SHA`, which About already
had a row for and always showed as "not set"), the status carries `buildSha` +
`pendingBuild`, and "already up to date" is no longer returned when the running build
is older than the checkout — it offers the rebuild instead.

**Verified live, not asserted.** `scripts/e2e/preview.mjs` (`bun run e2e:preview
[width]`) drives the real :4005 at 1280 and 390: every format above, paging by button
and by arrow key, and the update panel. It checks that the bytes ARRIVED —
`naturalWidth > 0`, `readyState >= 1`, the text inside the sandboxed frame — because
an element that exists proves nothing. It also asserts the fixture's `<script>` does
NOT run inside that frame. It provisions its own fixtures under
`~/.cache/mso-e2e-preview` and skips what it cannot make (no ffmpeg → no video). The
full self-update path was exercised end to end the same way: the checkout was moved a
commit back, the button pulled, verified out-of-tree, built, restarted, and the CSS
chunk check passed — 6 minutes, `UPDATE OK`.

## 2026-08-11 — shells to their 2026 specs, and a backup for the state that had none (DONE)

Five parallel packages on strictly disjoint file sets, each reviewed against its own
diff. The reviewers caught two packages that reported themselves complete and were
not — Windows had not actually resized Start search results, and the parity package
had fixed half of the adapter bug. Both closed before the gates ran.

**Windows 11** — learn.microsoft.com's icon table (updated 2026-08-05): 16px title
bar / context menu / tray, 24px taskbar + search + all-apps, 32px Start pins, at
100% scale. We had 20px taskbar glyphs, 28px list rows, 40px pins. Title bar was
34px against Win11's 32, which rendered the 46px caption buttons as 46×34.

**A measurement worth recording.** Live it renders 42px bar / 35px buttons / 21px
icons — because `--font-scale` is 0.875 on this box. 42/0.875 = 48, 35/0.875 = 40,
21/0.875 = 24, exactly. **Windows chrome is sized in rem and follows the a11y font
scale; iOS chrome is px and does not.** rem is the better a11y behaviour, so this is
recorded rather than "fixed" — but the two shells answering the same setting
differently is a real inconsistency and the next person should know before they
match one to the other.

**iOS 26** — the home screen is a fixed 6×4 grid, 24 icons per page, horizontal
paging, 4-slot dock. Ours was one vertical scroller with three hardcoded dots. Now
`grid-rows-6` + `overflow-hidden` with pages derived from the app count. Verified in
a real browser: icon 60.00×60.00, six rows, `scrollHeight − clientHeight === 0`.
**The plan for this was wrong** and that is the lesson: it claimed there was no
pagination, when the DOM had always rendered "Go to page 1/2/3". The agent was told
to MEASURE before changing anything, which is the only reason the paging that
already worked survived.

**Android** — M3 Expressive replaced duration+easing with physics springs: spatial
(may overshoot) for movement, effects (must not) for colour/opacity, three speeds
each. CSS has no spring, so each token is a real spring sampled into `linear()`. Six
M3 tokens collapse to three curves — a spring's normalised shape depends only on its
damping ratio; stiffness only scales time, which the durations carry. Durations are
multiples of `--shell-dur` ON PURPOSE: the reduce-motion block collapses that to
1ms, and hard-coded ms would have silently opted every Android animation out of it.
The notification shade had been animating UPWARD against the pull-down that summons
it. Ceiling, written in the CSS: a `linear()` cannot be interrupted and re-targeted
mid-flight the way a real spring can.

**Parity** — `apps_power` exposed three of the four actions `MANAGED_APP_ACTIONS`
declares; it reads the constant now instead of retyping it. `apps_list` returned a
bare array over MCP against the route's `{apps:[…]}`. Underneath both, the real bug:
`lib/os-api/http-adapter` never unwrapped those envelopes AND never translated the
wire's six-value `state` into the `running` boolean the port promises — so Alfa said
"no managed applications", and after a successful start, "undefined: stopped".
**Third drift at that seam this week** (wrong URL in `7ed3ff5`, then unwrapped-but-
untranslated, now the mapping); `lib/os-api/http-adapter.test.ts` is the first thing
pinning any of it.

Alfa rendered every failure as "Couldn't reach the assistant" — including a 429,
which sent people back to Send, the one action guaranteed not to work while the
window is open. Four branches now.

**Backup** — Playbooks, Agents, Automations, window layout and desktop icons were
localStorage-only: clearing site data destroyed them with no recovery path.
Settings → Backup exports every mso-owned key as one versioned JSON and imports it
back. Keys are chosen by prefix rule plus a small allowlist rather than a hardcoded
list that goes stale silently, and `mso.device.id` is denied on purpose — restoring
one machine's device identity onto another is not a backup.
Disclosed in the UI: `mso:tweaks` and `mso:quicklinks` also sync via `/api/prefs`,
where the server wins on initial load, so an import of those two is overwritten at
the next sign-in. The real fix POSTs prefs after a restore.

Gates: typecheck, lint, 1230 tests, coverage 19.7%, cycles clean, browser e2e green
at 1280 and 390 against the deployed build.

## 2026-08-10 (parity) — three tool surfaces, one gate (DONE)

A 13-agent parity audit across Alfa (function calling), MCP (ChatGPT/Claude/Cursor)
and the CLI (`bin/mso`, how an external agent drives the box). 58 claims, **53
survived** adversarial verification. 11 capabilities were parity 3-ways, 7 absences
were documented decisions, and **the rest was drift** — nobody decided it.

**The headline was backwards from the guess.** A remote ChatGPT connector had MORE
reach over this box than the owner's own in-browser assistant: MCP shipped
`apps_logs` / `apps_power` / `browser_status` / `browser_power` this morning and
Alfa had none of them — while Alfa's `apps.list` had been answering "no apps
installed" for months, because `/api/v1/apps` returns `[]` by construction and the
port's `apps.start`/`apps.stop` pointed at routes that do not exist.

Alfa now has all four (power tools park an approval card, which MCP has no
equivalent of), and `lib/mcp/parity.test.ts` is the gate: a capability must exist
in BOTH catalogs or be named with a reason, a stale exemption fails too, and a tool
classified mutate on one surface may not be read on the other. **Unifying the two
catalogs was considered and rejected** — they share zero names, descriptions or
handlers, so a shared registry would be an abstraction over two consumers that
legitimately differ. The defect was never duplication, it was silence.

**Bugs the audit found in code shipped hours earlier:**
- `dispatch.ts` recorded `ok: true` for anything that did not throw. `runCommand`
  REFUSES a destructive command by *returning* code 126 — so a blocked `rm -rf /`
  landed in the trail as a successful `exec.run`, `exec.blocked` could never be
  emitted over MCP, and every non-zero exit read as success. Live proof was in the
  log. Now mirrors the route line for line, with `detail: exit N` it never recorded.
- MCP's token bucket is tool-blind, so a **write**-scope token holding no shell
  could restart a daemon 120×/min against the UI's 12. Each mutating tool now
  mirrors its route's limit on the SAME key, so they share one allowance.
- `POST /api/v1/camoufox/service` had no rate limit at all — fine while a UI toggle
  was the only caller, not fine once a bearer could reach it.
- The camoufox port adapter sent `{enabled}` to a route reading `{action}`. Types
  missed it: the port's body is `unknown`.

**Security, in things that were already live:**
- `/api/skills` followed symlinks with no check, **outside the fs jail and outside
  the credential denylist**, so a symlinked `SKILL.md` served its target from
  anywhere. Now the resolved path must still be named `SKILL.md`. Containment could
  not be the rule — every `~/.claude/skills` entry links into `claude-skills/`,
  deliberately not a scanned root.
- Recalled memories were spliced into the SYSTEM prompt **unframed**, and
  `memory.remember` runs with no card — so any file Alfa read could propose a
  "fact" that then reappeared as system text in every later turn of every thread.
  Now framed as data. `memory.forget` (unbounded substring delete, no backup, no
  card) moved to the mutate catalog.
- `audit.js` and `image-editor.sh` fell back to a device id **committed in a public
  repo**, and `audit.js` printed it with instructions to APPROVE it — which turns
  the device allowlist into password-only for anyone who read the source.

**`~/.claude/skills` was not a skills root**, so the five `/mso*` documents that
describe how to drive mso were the one catalog mso could not see: 89 skills served,
zero of them `mso*`. Adding the root found nothing on its own — those entries are
symlinks and `Dirent.isDirectory()` is an lstat. 115 reachable now, all five among
them.

**CLI**: `bin/mso.test.ts` compared PATHS while promising method coverage, so five
routes had no verb (`mapp power`, `mapp cancel`, `mapp pending`, `threads save`,
`skills <name>`). Tightened to (method, path). `mso build` ran `next build` inside
mso.service's WorkingDirectory without restarting — the exact sequence CLAUDE.md
forbids — and now runs `verify-build.sh`. `mso --base <remote> device approve`
edited the LOCAL allowlist and reported success; it refuses a non-loopback base now.

Doc sweep: `/mso-apps` told an agent to drive the browser with verbs that never
existed (a prior commit rewrote only the left half of the cell, leaving the list
behind a `# ` so pasting it is a silent no-op); `/mso-list` claimed to probe every
endpoint while probing 13 of ~36; `CONTRACT.md`'s "there is no second list" was
falsified the day MCP shipped; `fs.list` advertised sizes that are always 0, so
Alfa would call every file empty; `mso search` was documented as searching file
CONTENTS while it matches directory names.

## 2026-08-10 (mcp, follow-up) — the trail the MCP tools were bypassing (DONE)

Shipping the MCP server, the security story told to the owner was "scope is the
containment, revoke is the kill switch". Both true, both weak without the third
thing — seeing what already went through — and that was **missing**.

`audit()` is called at the ROUTE layer for `/api/v1`. MCP tools call `lib/host`
DIRECTLY (deliberately: that is how they inherit the path bounds and the credential
denylist), so every `fs.write` / `fs.delete` / `fs.move` / `fs.copy` / `fs.mkdir` /
`exec.run` / `camoufox.power` that arrived over MCP was **absent from
`~/.mso/audit.log`, the only forensic record there is.**

The dispatcher records it now — one place, not per tool. `McpTool.audit` names the
action and which argument is the target; `dispatch()` writes it with
`actor: mcp:<id>` (the same id Settings and `mso mcp list` show, so a line maps back
to the revoke button) plus `meta.via="mcp"` and the acting scope. Failures too, with
the reason, so a blocked path is visible rather than silent.

A scope refusal writes `mcp.denied`. Nothing happened, which is exactly why it is
worth a line: **a `read` connector repeatedly reaching for `exec_run` is what a
prompt-injected model looks like from the outside**, and this is the only place that
signal exists. Reads stay unlogged — bounded, high-volume, same rule the routes
follow, and logging them would bury the lines that matter.

`readAuditTail()` had had NO reader outside its own test since it was written, so
the trail was unreadable without `cat`. Added `GET /api/v1/sys/audit` (session-gated,
prefix + actor filters), `mso audit [n] [prefix]`, and a "Recent MCP activity" list
in Settings → MCP. **Deliberately no MCP tool for any of it**: the trail records what
every token did, and letting a token read it would let a compromised one check
whether it had been noticed.

Two tools added, tiered by blast radius rather than by which layer they land in:
`apps_logs` is READ (a daemon's journal changes nothing, so "why is hermes down?" no
longer costs a shell) and `apps_power` is WRITE, not exec (three verbs against known
units — restarting a daemon should not mean handing over the ability to run
anything). The catalog split at the 220-line ceiling along the same tiering:
`tool-kit.ts` (shape + arg helpers), `tools-read.ts`, `tools.ts` (write/exec +
assembly).

**A bug this found in itself:** running the suite after wiring the dispatcher but
before mocking `audit` put two real `mcp.denied` lines into the owner's live
`~/.mso/audit.log` at 08:49:50. They are left in place — editing a tamper-evident
log to hide your own noise is the wrong instinct — and `writeLine` now refuses the
default path under `VITEST` unless `OS_AUDIT_LOG` is stubbed, with a regression test.

Verified on the live :4005 build: `apps_logs` returns real hermes journal lines at
read scope, `fs.write` lands in the trail with actor and target, the scope refusal
lands as `mcp.denied`, `sys_stats` does not appear at all, and `mso audit` reads it
back.

## 2026-08-10 (mcp) — the VPS is drivable from ChatGPT, off by default (DONE)

An MCP server: OAuth 2.1 + PKCE in front of a hand-rolled JSON-RPC endpoint, so
ChatGPT / Claude.ai / Cursor can call the same host operations the web UI does.
Ported from the `models-rahmanef-com` implementation (read `web/convex/mcp*.ts` and
`web/app/{mcp,oauth,.well-known}` for the original) — but that one is Convex-backed
and mso has no database, so clients, codes and tokens live in `~/.mso/mcp.json` under
the same atomic-write + fail-loud-on-corrupt rules as `lib/auth/device-store.ts`.

**The kill switch is real.** Without `OS_MCP_ENABLED=1` every route 404s — `/mcp`,
both `.well-known` documents, all three `/oauth` endpoints. Not an unauthenticated
surface: no surface. Demo mode forces it off regardless.

**Tools are thin calls into `lib/host`, and that is the whole security design.** The
MCP surface inherits `OS_FS_*_ROOTS`, the credential denylist (`~/.ssh`, cloud and AI
tokens, and `~/.mso` itself), the realpath escape checks and `exec.ts`'s destructive
filter for free. Verified live on prod: a read-scope token asking for
`~/.mso/config.json` gets `Access to credential/sensitive files is blocked`, so it
cannot exfiltrate the BYOK key or the device allowlist. `browser_status` withholds the
Camoufox viewer URL and VNC password on purpose — that profile holds a live Google
session, and a tool result is a thing that leaves the box.

Scope ladder `read < write < exec`, chosen per token on the consent screen and capped
by `OS_MCP_MAX_SCOPE`. `tools/list` filters by it AND `tools/call` re-checks it, because
a client can call a name it was never shown.

`/mcp` is deliberately NOT under `/api`: `proxy.ts` blocks mutating `/api` that cannot
prove same-origin and an MCP client is cross-origin by definition. The bearer is the
control, not the CSRF gate. `proxy.ts` exempts `/mcp`, `/oauth/token`, `/oauth/register`
and `/.well-known/oauth-*` from that gate and the document CSP; `/oauth/authorize` is
NOT exempt — it is a real page and keeps its nonce.

**Verified end to end on the live :4005 build**, not just in tests: discovery returns
the right origin, a bearer-less POST 401s with `WWW-Authenticate` + `resource_metadata`,
DCR mints a client and rejects a plaintext redirect_uri, the token endpoint answers a
bogus code with `invalid_grant`, a read token lists exactly 8 read tools and gets real
`sys_stats` back, the same token is refused `exec_run` with a message that says how to
fix it, and `mso mcp revoke` kills it mid-flight. 53 unit tests alongside.

Shipped ON with `OS_MCP_MAX_SCOPE=exec` at the owner's request — the ceiling, not the
default; every token still starts at `read` on the consent screen.

## 2026-08-10 — audit follow-up: −4.4k lines, two eager chains off first load (DONE)

A 13-agent audit (6 dimension scanners, each with an adversarial verifier that had to
refute its own dimension's claims, then a synthesis pass). 48 claims, **41 survived, 7
were killed** — and the kills were worth as much as the finds. Shipped in five commits.

**Behaviour fixes.**
- `/api/prefs` was fetched **twice on every load** — the appearance and quicklinks
  providers each pulled the whole 1.6 KB blob to read one key, both outside AuthGate,
  and both retry on window focus, so a signed-out tab-back fired two 401s. One shared
  in-flight promise, cleared on settle so the retry still refetches.
- **A failed app-chunk import left a spinner forever.** `window-content.tsx` caught the
  rejection and dropped it — which also disabled the recovery its own comment named:
  `register-sw.tsx` self-heals a stale chunk from `unhandledrejection`, and a *handled*
  rejection never fires that event. It now shows the failure with a reload button and
  rethrows. This is the deploy-day path (new build, old chunk ref), so it mattered.
- **Spotlight reported a dead host API as "No matches"** — indistinguishable from an
  empty result, so an expired session looked like an empty folder. It keeps the error.
- `ResponsiveProvider` allocated a fresh state object on every `resize`, so React's
  `Object.is` bailout could never fire — and this value is read at the shell root, so
  every event re-rendered the whole tree, each one paying a synchronous
  `getComputedStyle`. Now one rAF-coalesced measurement that bails when the geometry
  is unchanged. Mobile fires `resize` on every URL-bar collapse and keyboard open.

**a11y** (all pure additions): dock app icons had **no accessible name** at all (a
`<Link>` around a lucide `<svg>`; the hover panel holding the title is `invisible`, so
out of the a11y tree) — ~20 blank links. Login errors had **no live region anywhere in
the auth slice**, so "Incorrect password." was silent; the password field had only a
placeholder. Android recents cards were pointer-only `div`s. The toast stack was pinned
at a hardcoded 36 px while iOS floors `--sai-top` at 44, so it opened under the notch.

**Perf — two eager chains, both measured on the live build.**
1. One **267 KB** chunk (82 KB gzip) in the initial `<script>` set carried macOS chrome
   *and* iOS chrome *and* all 10 shell features to every visitor, because `DesktopChrome`
   shared a module with `Surface`. It moved to `components/shells/macos/`; all five
   shells now register through `register-shells.tsx` with `lazy()`. −68 KB on a phone,
   −42 KB on a desktop.
2. `installAlfaSources()` ran at module scope, so every signed-in load pulled the host-tool
   catalog + its 12 `run()` closures + agent presets (**88 KB**) into the initial bundle
   AND fired `GET /api/skills` — **90 serial `SKILL.md` reads, 602,672 bytes off disk,
   60–80 ms**, for a menu nothing renders until the user types `/`. os-shell registers a
   *loader* now; the composer's first render pulls it, and the skills fetch waits for the
   first `/`. Both needed a subscribe/notify seam, because the composer computes its item
   list during render on purpose — see `chat-composer.tsx:45`, which documents the exact
   bug a `useMemo` reintroduces here.

**Deleted, ~2.0k lines of code + ~1.7k of docs**, each verified to have zero consumers:
the `os-browser` Playwright sidecar's source (unit stopped *and* disabled for months, no
`/api/v1/browser` route, Browser has been Camoufox for two rewrites), the e2e shell
harness (`e2e.sh:12` pointed `$BROWSER` at a script that does not exist, so all 7 checks
aborted on line 17), Share + Quick Look (registries with no producers — the only callers
of `openQuickLook`/`share` were the `?e2e=1` commands), cross-app DnD (the one `setData`
in the tree writes `text/plain`, never the payload mime, so the read half could only ever
return null), `AppHeader`/`AppInspector` + the vaul drawer branch behind it, shell-settings'
unreachable half, the manifest's never-set `routing`/`titleSync` flags, `publicProxyUrl` +
`PROXY_BLOCKED_EXTERNALS`, `hostOf`, `resolveModel`'s `info` option, `assetDir` + two dead
env vars, and 5 finished plan docs. `multipart.ts`'s hand-rolled O(n·m) subsequence scan
and copy-concat became `Buffer#indexOf` / `Buffer.concat` (`buf` had to become a Buffer:
`Uint8Array#indexOf` searches for a single byte value, not a subsequence).

**Two of PROGRESS's own "deliberately NOT cut" entries were reversed** (`os-browser/`,
`scripts/e2e*`) — see the note at the 2026-08-03 entry. `AUDIT-2026-06-11.md` was NOT cut:
its stated reason, five source comments citing it by finding number, still holds.

**What the verifiers killed, which is the more useful half.** Deleting the 3 non-default
OS personas (~2,000 lines) — reachable three ways (Settings picker, desktop right-click
"View as", a palette command each). Spaces + session Profiles — "palette-only" is not
unreachable when ⌘K *is* the launcher. `defineFeature`/`Slot` as dead configurability —
`shell.manifest.ts:80` injects an 11th feature through it and the App Store's feature
toggles filter on it. `SHELL-FIDELITY-PLAN.md` — a live *unstarted* roadmap whose §8 table
is where `globals.css`'s live `--shell-*` tokens come from. A contrast-script "134 hidden
failures" — arithmetic over two JSON keys that never co-occur; acting on it would have
broken four presets. And "optimize `/api/skills?name=X`" — 🔒 `name` is raw user input
validated **nowhere else**; the enumeration allowlist is the only thing making `../`
structurally impossible, so the proposed `path.join` reopens traversal.

## 2026-08-04 (hydration, final) — the fourth cause closed; zero mismatches anywhere (DONE)

The architectural one the previous entry deliberately left open.

**The shell now renders only after mount.** Which shell to draw depends on three things
the server cannot know — the viewport (`useResponsive` measures `window.innerWidth`), the
persisted per-surface choice (`localStorage` `sv:shell`) and the wallpaper preference — so
SSR always guessed desktop/macOS and a phone client then rendered iOS. Two different trees
is a guaranteed mismatch, and React answered by discarding the hydrated tree and
re-rendering the entire shell client-side. Because Radix derives ids from `useId`, the
divergence surfaced in the dev overlay as mismatched `DropdownMenuTrigger` ids — a symptom
that sent the first look at it in the wrong direction.

`Surface` now returns a skeleton (`#main-content` + sizing + `bg-background`) until a
one-shot post-hydration flag flips, so the server HTML and the tree React hydrates are
identical by construction.

**This is an improvement, not a trade-off, on the UX side.** The old behaviour PAINTED the
macOS desktop on a phone and then swapped it for iOS — a flash of the wrong operating
system. A brief flash of the themed background is strictly better, and `bg-background` is
already the right light/dark value because the pre-hydration script in `app/layout.tsx`
sets `data-theme` before first paint. Nothing is lost to SEO: the catch-all is fully
dynamic and auth-gated, and the shell was never usable without JS.

**The measured cost, stated plainly: mobile LCP 160 ms → 320 ms**, because the shell is no
longer painted from SSR. Desktop LCP 380 → 420 ms. Both remain far under the 2500 ms
"good" threshold, and desktop CLS improved 0.008 → 0.001. The old 160 ms was painting a
shell that was then thrown away and rebuilt, so it was never a real 160 ms to the content
the user wanted.

**Verified end to end on the production build:** hydration clean on desktop and mobile,
**0 JS errors across all 17 apps in both mobile shells** (was 17/17 erroring), 17/17 still
render, shell resolution still correct (390 → ios, 412 → ios, 1280 → macos), no horizontal
overflow, skip link and its `#main-content` target both intact, smoke 4/4. Mobile
sub-24 px touch targets are down to one — the `sr-only` skip link, which is 1×1 by design.

## 2026-08-04 (hydration + mobile polish) — three of four hydration mismatches killed (DONE)

Chasing React #418, which had been firing on every page load and every app. A hydration
mismatch is not cosmetic: React discards the hydrated tree and re-renders the whole shell
on the client. Localised with a **non-minified dev build in a throwaway `git archive`
tree on :4007** — the minified production message names nothing. Four distinct causes,
three fixed.

1. **The `nonce` attribute on the theme-restore inline script.** Browsers blank the
   `nonce` content attribute once CSP has consumed it (anti-exfiltration), so the DOM
   reports `nonce=""` while the server HTML carried the real value. Dev build showed it
   verbatim: `+ nonce="NjA3NDAxNWIt…"` / `- nonce=""`. Fixed with
   `suppressHydrationWarning` on that one script. The nonce itself must stay — proxy.ts
   mints it per request and the strict CSP will not run the script without it.
2. **`useWidgetState`'s `getServerSnapshot` returned the live `state`.** React uses
   `getServerSnapshot` for the *first client render while hydrating*, and by then the
   module-level `state` had already been read from `localStorage`. So the server rendered
   the desktop widget layer off and hydration rendered it on, throwing the whole tree
   away. Now returns a frozen SSR default matching `load()`'s no-localStorage branch.
3. **`Clock` could not match, for two independent reasons**: it captures `new Date()` at
   SSR time and again at hydration time, and `toLocaleTimeString`/`toLocaleDateString`
   resolve against the *server's* locale during SSR and the *browser's* on the client.
   Both are named on React's own hydration-mismatch page. `suppressHydrationWarning` on
   each branch — which is precisely the attribute's purpose — keeps the server text (no
   layout shift) and lets the client correct it on the next tick.

**Result: the home route is hydration-clean on desktop and mobile in the production
build.** Verified against :4005, not just dev.

**STILL OPEN, and architectural rather than a bug.** Deep-linking into an app at phone
width still mismatches. The dev trace points at a Radix `DropdownMenuTrigger`'s
`useId`-generated `id`, which is a *symptom*: `responsive-provider.ts`'s `initial()`
deliberately returns **desktop** for SSR, so the server renders the macOS shell (menu bar
full of dropdowns) while the client computes mobile and renders iOS. Different trees →
different `useId` sequence. Closing it means changing what the server renders for the
shell (a neutral skeleton, or no shell until mount), which trades away SSR'd content and
risks a flash. Left for a deliberate decision rather than changed in passing.

**Mobile polish shipped alongside**, all from actually looking at the rendered pixels:
- Android home labels and clock were `foreground` (dark) directly on a dark wallpaper.
  Now white + text-shadow, matching the treatment iOS home/app-library already used.
  The colour is set on the **home grid container**, not inside `AppCell` — that same
  cell is reused by the App Drawer, a light sheet where white would be invisible.
  Caught before shipping by checking the cell's other call site.
- `Clock mode="date"` hard-codes `text-muted-foreground`, correct on a card and invisible
  on a wallpaper. Overridden locally with a `[&_div]:` descendant selector — (0,1,1)
  beats the class deterministically, with no `!important` and no API change to a
  component four shells share.
- Files' history back said `aria-label="Back"`, identical to the two shell-level
  exit-app controls, so a screen reader announced "Back" three times with three
  different meanings. It is now "Previous folder"; "Back" is reserved for leaving an app.

**Feature sweep: 17/17 apps render in both mobile shells**, each with a reachable exit
(iOS "Done", Android NavBar + header). No blank screens, no fatals.

## 2026-08-04 — every `border-<color>` utility in the app was dead, and that is why Android had no visible Back (DONE)

Started from a user report — "stuck in the Android shell, there is no back button, and
the mobile back affordance is hidden generally". Both turned out to share one root cause
that had nothing to do with the shells.

**`app/globals.css` overrode every border-colour utility in the codebase.** The line
`* { box-sizing: border-box; border-color: var(--color-border); }` sat **outside any
`@layer`**, and unlayered CSS beats every layered rule in the cascade. Tailwind 4 emits
all utilities into layers, so that single `*` selector silently won against all of them.
Measured in the live page before the fix — `border-red-500`, `border-primary` and
`border-foreground/70` all computed to `rgba(0,0,0,0.1)`, byte-identical to an element
with no class at all. **64 usages across 48 files**, including 15 `border-primary`
selection states, 10 `border-destructive/*` danger states and 6 `border-ring`. Wrapping
the rule in `@layer base` fixes all of them at once; `box-sizing` moved with it because
`box-border`/`box-content` were subject to the same trap. After: `border-primary` →
`rgb(31,109,240)`. A visible side effect on the desktop shell: the CPU meter bar in the
Today widget now renders — it had been drawing its fill in the default 10% grey.

**The Android NavBar was transparent, so Back/Home/Recents were invisible.** The row
carried `text-foreground` with no background of its own, and the Android wallpaper is
dark — dark-on-dark. It now carries `bg-background/80 backdrop-blur-xl border-t`, which
restores the token contract (background and foreground are a legible pair by
construction, whatever the theme). Home/Recents switched from `border-foreground/70` to
`border-current` so an outline always follows its own button's colour; the back chevron
went `size-5` → `size-6`. Measured after: scrim `oklab(0.968…/0.8)`, icon `rgb(28,28,31)`
— roughly 15:1. The 48×48 targets were already correct; nothing was ever missing, it was
unreadable.

On standardising the two mobile shells: iOS exits an app with a labelled blue **"Done"**
top-right, Android with the bottom NavBar back. Those are the correct platform metaphors
and were deliberately kept — the actual defect was that one of the two could not be seen.
Both are now visible, labelled, and ≥44 px.

## 2026-08-03 (UX) — a real browser pass, a demo instance back, and I broke prod proving it (DONE)

First pass that opened the product in a browser instead of reading the code. Also the
first time this session damaged production, so that first.

**I broke :4005, with the exact hazard I had documented hours earlier.** Measuring bundle
output meant running `bun run build` twice in the prod checkout with no restart after.
`next build` wipes `distDir` first, so the running server was serving 500s with
`Content-Type: text/plain` for its own chunks and the browser refused to execute them.
Fixed by a restart; smoke green after. Two lessons worth more than the measurement:
`scripts/verify-build.sh` exists precisely for this and I did not use it, and **a broken
deploy silently corrupts whatever you are measuring** — see the retraction below.

**RETRACTED: "the mobile-first product renders the desktop shell on phones."** I reported
`data-shell=macos` at 390px, 412px and on a real iPhone UA, with a screenshot of a macOS
menu bar on a phone-sized viewport. It was entirely an artifact of the breakage above:
React never hydrated (its chunks were refused), so the effect that computes responsive
state never ran and the deliberate SSR default — desktop — stayed on screen. After the
restart: **390px → `ios`, 412px → `ios`, 1280px → `macos`, zero horizontal overflow.**
Responsive shell selection works correctly. Nothing was wrong.

**Measured on a healthy prod** (Playwright, `os-browser/node_modules`):

| | desktop 1280 | mobile 390 |
|---|---|---|
| LCP | 380 ms | 160 ms |
| CLS | 0.008 | 0 |
| TTFB | 24 ms | 20 ms |
| transfer / requests | 194 KB / 29 | 231 KB / 30 |

Against a 2500 ms "good" LCP threshold there is nothing meaningful left to win here.

**Fixed: 4 touch targets under the WCAG 2.5.8 24×24 floor, all on mobile** — the three
iOS home-screen page dots were 19×19 (`p-1.5` around a 7px dot) and the home indicator
was 17px tall. Both got a `min-h`/`min-w` floor; the dot and the 134px bar are visually
unchanged, only the hit area grew. Mobile now reports one "tiny" control and it is the
`sr-only` skip link, which is 1×1 by design and expands on focus.

**A11y came back stronger than expected**, recorded so nobody re-audits it: 77 icon
buttons, **zero** without an accessible name; the skip link exists and its
`#main-content` target resolves; the Launchpad overlay is both `inert` and
`aria-hidden`, so its 16 app links are correctly out of the tab order (a naive
`querySelectorAll` sweep counts them as unnamed — mine did, wrongly);
`prefers-reduced-motion` collapses durations to 1ms rather than 0 so `animationend`
still fires. Two of my own grep-based claims were wrong and the browser corrected both.

**`mso-demo.service` is back**, :4006, loopback-only — see CLAUDE.md. Demo mode disables
login, so a public bind would publish an unauthenticated shell; mock-data-only keeps the
blast radius small but exposing it stays the owner's call.

**Hardening:** `/etc/logrotate.d/mso-audit` now rotates `~/.mso/audit.log` (weekly, 5 MB
cap, 8 generations, `su rahman rahman` since the file is 0600). Growth is only ~88 KB/mo
today, but it is append-only with no cap in code and this box serves prod.

**STILL OPEN — React hydration error #418**, reproducible on BOTH mobile and desktop with
clean localStorage, so it is not the theme-restore inline script. A hydration mismatch
makes React discard and re-render the tree client-side. Identifying the offending node
needs a non-minified dev build; not chased here rather than guessed at.

## 2026-08-03 (docs) — reconciling every live doc against what the box actually does (DONE)

A sweep for claims that had quietly become false. History files (`AUDIT-*`,
`SCORECARD-*`, dated plans, this log's older entries) were left alone on purpose —
they describe what was true then. Only *live instructional* docs were touched.

What was actually wrong:

- **`.env.example` was missing 6 settable vars.** Reconciled against `process.env` in
  code: `CAMOUFOX_NOVNC_URL`, `CAMOUFOX_VNC_PASSWD_TEXT`, `OS_MEMORY_STORE`,
  `OS_THREADS_DIR`, `NEXT_PUBLIC_COMMIT_SHA`, `NEXT_DEPLOYMENT_ID`. CLAUDE.md's
  standing caveat ("it is missing several… grep `process.env`") is now a precise list
  of what stays out and why: framework-injected (`NEXT_RUNTIME`,
  `NEXT_PUBLIC_BUILD_ID`), systemd's (`NOTIFY_SOCKET`, `WATCHDOG_USEC`), the OS's
  (`PATH`, `SHELL`), test-only (`E2E_BASE_URL`, `OPENCLAW_HOME`), and `OS_BROWSER_*`,
  which belong to the retired sidecar rather than this app.
- **`CONTRIBUTING.md` told contributors to run `scripts/check-slices.mjs`** — deleted
  earlier the same day — and claimed "280+ tests" (1136). Its checklist now matches the
  four guards that really run, and warns that the hook is untracked and that
  `--skip build` is deliberate.
- **The `/mso-browser-list` skill was the worst offender.** It described `os-browser` as
  *the* Browser app, triggered on "why doesn't the browser work" and "browser status",
  and told the reader to `systemctl restart os-browser`. All false: the Browser app is
  Camoufox, the unit is stopped + `disable`d, `/api/v1/browser/*` was deleted, the
  `OS_BROWSER_URL`/`172.18.0.1` wiring is Dokploy-era (prod is systemd), and its `.env`
  path pointed at `~/projects/os-browser` instead of `~/projects/mso/os-browser`.
  Rewritten, and its `description` now explicitly routes those trigger phrases to
  `/mso-camoufox`. `browser-check.js` printed the same dead architecture line; fixed.
- **`CLAUDE.md` documented a demo that does not exist** — no `mso-demo.service`, no
  `/home/rahman/projects/mso-demo`. The `NEXT_PUBLIC_OS_DEMO=1` flag is still real; the
  second checkout and :4006 unit are not. Its verification recipe also said to drive the
  demo "via os-browser", which is doubly gone — now points at Playwright directly.
- **`docs/SLICE-CATALOG.md` listed 20 slices; there are 21** (`docs` was missing).
- `docs/FAQ.md` still advertised "280+ vitest tests" and only two audit passes.
- `os-browser/README.md` opened "headless Chromium service for the Browser app".

Every claim written in this pass was checked against the box rather than assumed —
including one of my own: I wrote "four guards" and the hook has five `# Guard` lines.
Four run; the fifth is a Convex auto-deploy that no-ops here because there is no
`convex/` dir. Said so rather than rounding.

## 2026-08-03 (later) — the two open items closed, and the health lens finds a silent way to lose the device allowlist (DONE)

Clearing both items the entry below left open.

**Three of the four `rm -rf /` bypasses are closed.** The patterns anchor the catastrophic
argument on `\s`, `$` or `*`, so a `/` followed by `;`, `)` or `"` walked straight past them.
Rather than widen each regex — which leaks a new way in for every character you forget —
`matchDestructive` now splits the command on shell separators (`[;&|()"'\`\n]+`) and tests
each segment, so `echo hi; rm -rf /`, `(rm -rf /) &`, `bash -c "rm -rf /"` and
`echo $(rm -rf /)` all land on a segment where the trailing `/` sits at end-of-string.
**Ordering inside that function is load-bearing and pinned by a test:** the whole string is
tested BEFORE the segments, because the fork-bomb pattern is built out of `(){}|&;:` — the
very characters being split on — so segment-only testing would silently stop detecting it.

The fourth (`HOME=/ rm -rf "$HOME"`) stays an `it.fails()`: the destructive argument only
exists after the shell expands the variable, which no static filter can see. Expected-fails
went 4 → 1 and the suite turns red if that ever starts being caught.

Accepted cost, pinned as its own test: quoted prose is now refused too —
`git commit -m "never run rm -rf / on prod"` is indistinguishable from
`bash -c "rm -rf /"` except by program name. Erring toward refusal; the escape hatch is
`OS_EXEC_ALLOW_DESTRUCTIVE=1`. Ordinary commands (`ls -la /`, `cd / && ls`, `find / -name x`,
`systemctl status mso`) were checked and still pass.

**The health lens (the one that died) found a real data-loss path.**
`lib/auth/device-store.ts`'s `read()` returned an empty store for EVERY failure — and it
feeds a read-modify-write whose callers `recordPending` and `approveDevice` write
unconditionally. So one unparseable byte in `~/.mso/auth-devices.json` meant the next login
attempt from an unapproved device read "no devices", then **persisted that** — wiping every
approved device and locking the owner out of their own host. `recordPending` is reachable
from the internet by anyone holding the password. Now only `ENOENT` (legit first run) yields
an empty store; corrupt JSON or EACCES throws. Costs a 500 on login; the old behaviour cost
the allowlist. `device-store.test.ts` is new (it had none) and its two key cases were
verified to fail against the old code.

**`lib/host/fs-upload.ts` had zero tests** despite being a write boundary behind
`/api/v1/fs/upload`. `fs-upload.test.ts` now pins the two things that matter: a part cannot
escape the destination (parent/deep/mid-path traversal, absolute paths, segment-only inputs)
and the 100 MiB cap stops bytes reaching disk, leaving no `.tmp` behind.

**The rest of the health lens came back clean**, and it is worth recording so nobody re-runs
it: 1 `@ts-expect-error` in total (in a test, justified), **zero** real `any` in non-test code,
1 empty `catch` (the inline theme script in `app/layout.tsx`, where a corrupt localStorage
must not block render), and 21 files with `eslint-disable` — all narrow, single-rule, and
carrying a reason. No secret has ever been committed: the two `OS_SESSION_SECRET=` hits in
git history are `$(openssl …)`, `$SECRET` and a regex, not values. `exec.ts` is NOT untested
as a filename scan suggests — `exec-filter.test.ts` covers it.

1136 tests / 115 files (was 1115 / 113).

## 2026-08-03 — pnpm→bun, a 5-lens audit, and the gates that were never actually gating (DONE)

Four commits: `268747f` (bun + audit fixes), `844eef3` (−836 lines), `674455b` (dependency
+ build gates, sharp CVE), `c201e8f` (cleanup). All live on :4005 and pushed.

**bun replaces pnpm as the installer — the runtime did NOT move.** `bun.lock` is committed,
`pnpm-lock.yaml` is gone, `.nvmrc`/`engines.node` still pin Node 22, and prod's `ExecStart`
is still `/usr/bin/npm run start`. `next`/`tsc`/`eslint`/`vitest` carry `#!/usr/bin/env node`
shebangs and `bun run` honours them, so every tool still executes under Node. Measured, not
assumed: install warm 3.5 s → 2.6 s (marginal), script startup **318 ms → 8 ms** (the actual
win — `verify` chains four). `pnpm.onlyBuiltDependencies` → `trustedDependencies`,
`pnpm.overrides` → `overrides`. Two traps now documented in CLAUDE.md and DEVELOPMENT.md:
`bun test` silently shadows the `test` script and exits 0 having run nothing, and `bunx`
downloads-and-runs a missing package (so `post-deploy-smoke.sh` calls
`node_modules/.bin/vitest` directly, never `bunx`).

**A 5-lens audit ran; the 5th lens died and its ground was never covered.** Lenses:
over-engineering, security, Next16/React19, bun blast-radius, repo health. Each finding was
handed to an adversarial verifier told to refute it. The **repo-health lens hit a
StructuredOutput retry cap and returned nothing** — so test-coverage reality, error
swallowing, eslint gaps and TypeScript escapes remain **unaudited**. The security core came
back clean under four separate attempts: all 51 routes `verifyAuth` first, path bounds
realpath before checking, and the CSRF gate in `proxy.ts` is not spoofable.

**The largest real cost was one line.** `next.config.mjs` is evaluated **twice** (once by
`next build`, once when `next start` boots), so a `Date.now()` `deploymentId` fallback
emitted two different `?dpl=` values for the same chunk — the HTML referenced both and the
browser downloaded, parsed and executed ~160 KB gzip of entry chunks **twice on every cold
load**. Confirmed live, now zero `?dpl=`. Note the key must be **absent**, not `undefined`:
`undefined` still emits an empty `?dpl=`, which leaves `chunk.js` and `chunk.js?dpl=` as two
distinct URLs and the double download intact. `env: { NEXT_PUBLIC_BUILD_ID }` is unaffected —
`env` is inlined at build time for server *and* client, which is why it never had this bug.

Other perf: System Monitor (1.5 s) and Managed Apps (10 s) polled with no visibility gate, so
a backgrounded tab spent host CPU forever; the menu-bar CPU chip ran a *second* poller against
the endpoint the shared store already polled (~55 → ~20 req/min); `hermes --version` (0.44 s
CPU) re-forked every 10 s, now cached 60 s and dropped on any lifecycle action; xterm left the
entry chunk (340 → 334 KB gzip) — `os-terminal/index.ts` eagerly re-exported the module it
also code-split, and `shell.manifest.ts` imports that barrel eagerly.

**Security fixed:** the Camoufox profile (live Google `SID`/`__Secure-1PSID`/`SAPISID` +
LinkedIn `li_at`) and `~/.vnc` were readable through `fs/read` and `fs/zip` — absent from
`SENSITIVE_HOME` while `OS_FS_READ_ROOTS` is `~`; four live session cookie jars sat `0664` at
derivable `/tmp` paths (code fixed *and* the existing files chmod'd); a **distributed** login
lockout where six IPs inside their own 5/min allowance filled the 30/min global budget and the
owner's *correct* password then got 429 — the global budget is now charged only by a failed
password compare, with a regression test verified to fail on the old code; `~/.mso` now created
`mode: 0o700`; the CLI login body moved from argv to stdin.

**−836 net lines.** 20 `slice.json` + `check-slices.mjs` (604 lines; one consumer validating 3
of 12 fields, and `docs/AUDIT-2026-06-11` had already flagged 8 as describing a Convex auth
this app does not have), `layouts.ts` (a strict subset of `profiles.ts`), two `CredentialStore`
impls, `useBadges`/`useProfiles`, three documented-but-unread `ShellManifest`/`Brand`/
`FeatureDescriptor` fields, three image-editor barrel re-exports, and `makeDragProps` — the
*producing* half of the DnD seam, which had no callers, meaning nothing ever wrote `DND_MIME`
and the receiving half was unreachable. `os-browser.service` (retired sidecar, 135 MB, still
autostarting) stopped + disabled; the directory stays as the repo's only Playwright.

**The gates were theatre; now they are not.** Three discoveries, in order of how badly each was
believed:
1. `bun audit` had **never been run**. First run found sharp <0.35.0 HIGH (libvips
   CVE-2026-33327/33328/35590/35591) sitting transitively under next. next@16.2.12 pins
   `^0.34.5` and has **no fixed release** — only canary moved — so `overrides` is the only fix.
   sharp 0.35.3, libvips 8.17.3 → 8.18.3, `/_next/image` still 200. sharp 0.35 also removed its
   install script, so `bun pm untrusted` is now **two** entries, not three.
2. Adding `audit` to `verify` **gates nothing**: sc-git's `ci.js` has a hardcoded
   `STEPS = ['typecheck','lint','test','build']` and never invokes `verify`. The real gate had
   to go in `.git/hooks/pre-push`.
3. **"Just remove `--skip build`" would have been an outage on every push.** `ci.js` builds in
   `process.cwd()`, which for the hook *is* `mso.service`'s WorkingDirectory, and `next build`
   deletes everything in `distDir` except `/^(cache|dev|lock)/` as its first act — and repeat
   builds rename every chunk and mint a new `BUILD_ID`, so already-served HTML stays broken
   afterwards too. `--skip build` is load-bearing safety. `scripts/verify-build.sh` builds a
   throwaway copy of HEAD in `mktemp` instead; `node_modules` is **copied, not symlinked**
   (Turbopack hard-fails on a symlink pointing outside the filesystem root) and `.env.local` is
   deliberately not copied, so no secret lands in `/tmp`.

`scripts/audit.mjs` exists because `bun audit` **fails closed** — offline it exits 1, the same
code as a real advisory — so wired raw into a hook every network blip becomes a fake security
failure. The wrapper treats empty stdout as "unreachable, skip"; CI keeps the raw fail-closed
command on purpose, because a release gate must not pass an audit it could not perform. Also:
`--json` silently ignores both `--audit-level` and `--ignore`, and bun's JSON carries only an
opaque numeric id, so the readable GHSA is parsed out of the advisory URL.

**Also fixed: the post-deploy gate was half dead.** `scripts/e2e/smoke.test.ts` probed
`/api/version` and `/api/v1/sys/cpu` — **neither ever existed in this repo** (no git history for
either path). It had been asserting `404 == 200` since it was written, which is exactly how a
gate stops being run. Repointed at `/api/health` + `/api/v1/sys/stats`; 4/4 green.

Push now costs ~70 s (was ~47 s) and prints `audit: clean at high/critical.` +
`build: HEAD compiles (out-of-tree).` — **if those two lines are missing, the wiring is gone.**
The hook is untracked, so an sc-git hook reinstall silently reverts all of this *and* re-adds
the deleted `check-slices.mjs` line, which would block every push.

**Still open:** (1) `lib/host/exec-filter.test.ts` documents four `it.fails()` bypasses of the
`rm -rf /` guard (`;` chain, subshell, `bash -c "…"`, `HOME=/ rm -rf "$HOME"`). Exec is
human-approval-gated and an authenticated owner has full shell anyway, so this degrades the
DANGER badge rather than being RCE — but a regex over shell strings is the wrong shape; the fix
is to split on shell metacharacters and check each segment. (2) The repo-health lens above.
→ **Both closed the same day; see the entry above this one.**

## 2026-07-30 — v0.2.0: Alfa can act on the host, and a release gate that found four reasons it should not ship yet (DONE)

An adversarial gate before announcing the agentic harness: five probes (contract vs code,
the approval boundary, live behaviour, doc truth, ship blockers), each handed to a skeptic
told to refute it against one bar — *would this embarrass or endanger someone who
self-hosts MSO because the release said the AI can act on their host?* 46 findings, 44
survived, 4 blocked the release. All four are fixed here.

**1. `app.open` was a way around the approval boundary.** It is `effect: "read"` on the
stated grounds that opening a window "touches nothing on the host". True for fourteen apps
and false for two: `claude-code` mounts a PTY that immediately runs
`claude --dangerously-skip-permissions`, and `os-terminal` mounts a login shell. The app
name comes from the model, so prompt injection reached it, and `pty.ts` already records
that keystrokes are unaudited and the destructive-command regex cannot apply there.
`registry.test.ts` kept `pty.open` away from the model; nothing kept away the window that
wraps one. `run()` now refuses both by id, the description no longer advertises a terminal,
and a test pins both halves.

**2. The same tool silently lied about the other twelve.** It called
`openWindow(app, app)` with the model's raw string, but the registry keys by **id** while
`shell.manifest.ts` gives most apps a different **slug** — and the description advertises
the slugs. So "open Files" rendered `Unknown app: files` and returned `opened files`. Both
the user and the model were told it had worked. It now resolves slug-or-id against
`BUILTIN_APPS` using the same predicate as `use-url-sync`, and throws on a name it cannot
resolve.

**3. The Agents UI asserted a permission boundary that did not exist.** A "Generalist /
Curated — by skill" switch, a per-agent Skills grant list, and counters reading
"Ops · 2 skills · 11 tools" — while `use-host-commands.ts` returns `HOST_AI_TOOLS`
unconditionally, with no agent in scope. All 18 tools went every time. Not exploitable —
mutating tools still park a card — but someone who curated a System-only agent was handing
the model `fs.read` over their entire read jail and believing they had not. CONTRACT.md
already required this removal in writing; this commit performs it and marks it done.

**4. The zero-friction provider turns the headline feature off.** The ChatGPT OAuth path
never forwards the tools array (`codex-stream.ts` sends no `tools` field), so Alfa answers
fluently and cannot call anything — and "chat-only" appeared only in code comments. The
sign-in button now says so. **This is what the live instance was running**, which is why
the harness was doing nothing there.

**Docs.** README's Security warning said nothing about the assistant being able to act on
the host; it now names all 18 tools by tier, says that everything Alfa reads goes to the
model provider on every turn, states that a read file is untrusted input and the card is
the only thing between it and an `exec.run`, and says plainly that Agents and Skills are
organisation rather than permissions. Also removed a shipped pre-launch TODO that called
the maintainer's own auth-gated cockpit a demo.

Version 0.2.0 — first tag since `wave1-safety`, 191 commits back. typecheck + lint + 1,096
tests + build green; the manual `workflow_dispatch` CI passed from a clean checkout at
run 30564867120, which is the only lockfile-drift check that exists.

## 2026-07-30 — A repo-wide dead-weight sweep before the agentic-harness release (DONE)

`bccd0b1`..HEAD. An adversarial audit — six parallel sweeps (orphan modules, whole
directories, dependencies, dead code in live files, docs, assets), each one's findings then
handed to a skeptic whose job was to REFUTE them. 47 candidates, 22 survived. The skeptic
earned its keep: it killed a proposed 21-line barrel trim that would have been a build
break (appshell's own `features/*` subtree imports the barrel BY ALIAS, so a
"used outside this directory?" predicate reports live exports as dead), and it saved
`os-browser/` by *starting* it — dormant, not dead, and still the repo's only Playwright
install, which `scripts/gen-readme-media.mjs` imports.

**Cut, in order of size.** `mock-os/` (101 files, 5.7k lines, 6.6 MB) — an HTML+babel design
prototype deliberately excluded from the build, the lint pass and the coverage report, i.e.
excluded from everything, which is the definition of weight without load. `docs/PLAN.md` and
`docs/MULTISHELL-PLAN.md`: the first contradicted by shipped code in every section, the
second's sibling repo gone and its one unique decision reversed by PROGRESS.md:574. 15
`slice.manifest.json` stubs (`"generated": "stub"`, 8 naming a `convex/` directory that does
not exist) — `image-picker` and `quicklinks` stay, being hand-written docs rather than
stubs. `rr.json`, an inert consumer manifest describing the Convex stack removed in Phase
15. `appshellConfig`, a config export declaring no config. Six symbols with exactly one
repo-wide hit each, their own declaration. `docs/media/hero-desktop.png`, 1.2 MB the README
stopped referencing when it moved to `mso-hero.webp`, plus `openApp()` and the throwaway
`~/readme-showcase` folder that existed only to dress that one screenshot.

**Two comments that were simply false**, which is worse than dead code because it is read as
fact: `vitest.config.mts` said coverage was inert pending an install that had already
happened, and `CONTRIBUTING.md` said there is no CI.

**One bug the sweep surfaced.** The service worker cached `/icon-192.png` and
`/icon-512.png`, which have never existed — `app/manifest.ts` has always pointed at the
SVGs. Next's catch-all answers an unknown path with the app HTML and a 200, so `addAll()`
never threw; it cached the HTML shell under two icon URLs, which is precisely what the
comment above it promises the SW never does.

**CI moved off hosted runners.** `ci.yml` ran on every push to `main` at ~80 s of billed
runner time, duplicating a `pre-push` hook that already gates typecheck/lint/test/check
locally. It is `workflow_dispatch` now. Three of its steps are genuinely not reproducible
locally — clean-checkout `pnpm install --frozen-lockfile` (the only lockfile-drift check),
`bash -n scripts/install.sh`, and `pnpm build` — so the file says to run it by hand before a
release rather than being deleted.

**Deliberately NOT cut**, each with a reason: `os-browser/` (a documented, whitelisted,
working service); `docs/{ARCHITECTURE,AUDIT-2026-06-11,SCORECARD-2026-06-14}.md`
(banner-kept history, and AUDIT-06-11 is cited by name from three source files);
`scripts/e2e*` (dormant, revived by one `node os-browser/server.mjs`);
[**REVERSED 2026-08-10**: `os-browser/`'s source, `scripts/e2e*` and
`SCORECARD-2026-06-14.md` were deleted. The service had been stopped AND disabled
for months with no `/api/v1/browser` route left to call it, which took the e2e
harness with it — `e2e.sh` also pointed at a `$BROWSER` script that does not exist,
so all 7 checks aborted on line 17. `AUDIT-2026-06-11.md` stays, for exactly the
reason given here.]
`useBadges`/`useLayouts`/`useProfiles`/`listProfiles` (dead here, but rr's `appshell` calls
`listProfiles` — cutting forks the lifted slice and they return on the next merge); the
3,060 unread token entries in `registry-data.json` (a verbatim upstream mirror; pruning it
forks the file and breaks `check-contrast`'s pairs); the `postcss` devDependency (a one-line
win that costs a 258 KB lockfile regeneration on the eve of a release).

Deleted docs and trees are recoverable with `git show bccd0b1:<path>`; the untracked ones —
`mock-os/Apple-clone-app/`, `public/MSO_Brand_Assets_Current/`, 13 one-shot June probe
scripts — are in `~/archive/mso-cleanup-2026-07-30/`, since git could never bring those
back. Net: 1,047 → 930 tracked files, −6.3k lines, −9 MB. typecheck + lint + 1,095 tests +
build + cycles + slices green.

## 2026-07-30 — Hermes reached the iframe; three gates were closing it (DONE)

The Hermes window rendered `{"error":"managed application upstream unavailable"}`. Three
separate gates, each one uncovered only after the previous was open, and each one a real
gap in the install path rather than a fault in a running app.

**1. The install never installed the dashboard** (`scripts/managed-app-install`).
`hermes gateway install` creates `hermes-gateway.service` — Telegram/Discord/WhatsApp
plumbing — and binds nothing on 9119, which is the port `HERMES_DASHBOARD_URL` points at.
So a Hermes MSO had just reported as *installed, running, healthy* served a connection
refused. This host hid the gap for months because its 9119 unit was hand-written and
predates the installer; deleting it on 2026-07-29 is what exposed the bug. There is no
`hermes dashboard install` upstream, so the unit is ours now, written at install time.
`hermes serve` is not a substitute — it answers `/api/*` and 404s the web UI by design.
No `--skip-build`: the first start builds `web_dist` in ~1 min, every later start finds
it current and is up in 2 s, and `--skip-build` would turn a missing dist into a
permanently broken service instead of a slow first boot.

**2. The proxy stripped the credential the SPA needs** (`lib/managed-apps/proxy-headers.ts`).
On a loopback bind Hermes mints an ephemeral token per process, injects it into the SPA
HTML, and requires it back as `X-Hermes-Session-Token` on every `/api/*` fetch. It was not
on the request allowlist, so the shell rendered perfectly and every request under it 401'd:
sidebar, no data. Forwarded per-app (`APP_REQUEST_HEADERS`), not globally — it is one
upstream's credential. Safe in a way `authorization` is not: no browser attaches this header
on its own, so it can never become ambient credential.

**3. The WebSocket upgrade failed Hermes' own rebinding guard** (`proxy.ts`,
`upstreamSocketHeaders`). FastAPI runs no HTTP middleware for WebSocket routes, so Hermes
repeats the DNS-rebinding Host/Origin check inside the handler and closed every chat socket
`4403` → "connection interrupted (code 1006)", reconnecting forever, while every plain fetch
on the same page worked. The upgrade now presents the loopback Host/Origin **for Hermes
only**: OpenClaw matches its `allowedOrigins` against the origin AS PRESENTED, so the same
rewrite would break it. Rewriting these two headers gives an attacker nothing — `?token=` /
`?ticket=` in the query is the credential, and it rides through untouched. The test that
asserted the opposite was asserting a false premise (that Hermes binds `0.0.0.0`).

**OpenClaw, found while testing.** Its Control UI refused the socket with "Browser origin not
allowed": `gateway.controlUi.allowedOrigins` held only the retired `oc.rahmanef.com`, restored
from a 2026-07-25 backup by the `job.restore.succeeded` at 19:55 on 2026-07-29 — config
restore replaying pre-split state. `onboard` has no flag for it, so the installer sets it from
`MSO_INSTALL_APP_ORIGIN` (`managedAppOrigin(id)`), origin only, never a wildcard. Remaining
step is auth by design: the Control UI wants the gateway token pasted (`reason=token_missing`).

Verified end to end against the live cockpit with Playwright as an approved device: Sessions,
Models, Skills, Cron and Chat all load, all three sockets (`/api/ws`, `/api/events`,
`/api/pty`) stay open, model badge reads *live*, zero failed requests.

## 2026-07-28 — Alfa becomes one assistant; the browser becomes real; four security fixes (DONE)

`ab03b3e`..`c30e6e6`, 18 commits. Three threads: reversing a design that had drifted into
fiction, making the browser and the assistant actually work on a phone, and closing four
security holes. **Read the failures section at the end — four of these commits shipped
defects that only a later audit caught, and that pattern is the most useful thing here.**

**Hermes and OpenClaw are ordinary apps, not shell modes** (`a2c3882`). MSO could swap its
entire shell into a per-app "workspace mode": localStorage picked a mode, the app list was
filtered to a per-mode set, and a pipeline scraped each upstream's BUILT SPA bundle with six
regexes to spawn one MSO window per upstream nav route. Both dashboards already ship their own
sidebar, so all of that rebuilt navigation they hand us for free — held up by regexes against
minified third-party JS. Deleted: `os-shell/workspace-mode.ts`, the `WorkspaceModeControl`
capability, the Dashboard `<select>`, the Control Centre tile, the right-click submenu, and the
whole discovery pipeline (`features.ts`, `feature-parser.ts`, `dynamic-features.tsx`,
`feature-icons.ts`, the `/features` route). −1,048 net. `noDock` came off both descriptors first,
or they would have vanished from the dock, start menu, Android home and Dashboard sidebar.

**The Browser is a real Firefox** (`5017353`, `c8be397`, `779f2ba`). The iframe browser could
only ever render the minority of the web that permits framing — X-Frame-Options refuses the
rest — so it was chrome around a blank rectangle. It is now Camoufox (anti-fingerprinting
Firefox) on a headless X display, streamed over noVNC. Two mobile blockers had to go with it:
`vnc_lite.html` has no focusable input at all, so on touch the OS keyboard never opened and the
remote browser could not receive a keystroke; and `scale=true` painted a 1440x920 desktop at
0.273x inside a 393px window with ~60% empty letterbox — the "black rectangle" the owner
reported. `vnc.html` + `resize=remote` gives 1:1 pixels, and needs a window manager on the
display (matchbox) or the browser window never reflows on the RANDR change. `779f2ba` gave the
window power over the host session, so hiding the app no longer leaves a browser, an Xvfb and an
x11vnc running for nobody.

**Alfa is one conversation across every feature** (`5e025ff`, `818a77d`, `ed8e8fd`). It used to
be two disconnected chats: the Assistant app ran the real agent, while the Inspector ran a
second toolless chat whose state was thrown away on every app switch (`key={appId}` remount).
Now one module store, one engine registered lazily by the panel, and many views onto it —
including a bottom sheet on mobile, where Alfa did not exist at all because `rightPanel` is
rendered only by the macOS and Windows shells. Every turn is tagged with the app it came from, so
a task carried Files → Terminal → Browser reads as one story. `@agent` and `/skill` completion
landed in ONE composer every AI input shares; `/` fires only as the first character, because this
is a VPS cockpit and `ls /home/rahman` must not open a menu.

**The AI subsystem stopped lying** (`52949ec`, `badef71`, `3287f61`, `79938be`, `87ac78a`,
`c30e6e6`). There were two tool catalogs: 45 hand-written descriptors beside 18 executable tools,
sharing exactly ONE name (`apps.list`) and disagreeing about what it did. The other 44 described
capabilities the model could never call. `OS_TOOLS` is a VIEW of `HOST_TOOLS` now. The agent was a
per-mount hook, so the sheet and dock could not read it — which is why `@agent` was cosmetic; it
is a module store now and a pick actually switches, with "Answering as <name>" so the switch is
visible. The persona moved from a fake user turn (injected once, when history was empty, freezing
turn zero's agent forever) into a per-request system prompt. `CONTRACT.md` in the assistant slice
now states what an Agent, Tool, Skill and Playbook each are, and lists the gaps rather than hiding
them.

**Security** (`a8a3c72`, `a980729`, `c8be397`, `5017353`):
- An **unauthenticated permanent lockout of the owner**. The login limiter incremented its global
  counter before the per-IP check and unconditionally, so one flooding IP burned the process-wide
  budget and every other caller — including the owner, from a different address, with the correct
  password — got 429 for as long as the flood ran. No credential, from the public internet,
  indefinitely.
- A **credential-copy escape**. `copy(~/projects → ~/backup)` duplicated the cockpit's own
  `.env.local` past the credential gate, and `/api/v1/fs/read` would then serve
  `OS_SESSION_SECRET`. Reachable on the DEFAULT roots.
- The **camoufox VNC bridge** was gated only by the presence of a cookie NAMED `session`, so
  `Cookie: session=x` from anywhere reached a live keyboard and mouse. It is behind the same
  verified-session check as `/api/v1/exec` now.
- **x11vnc ran `-nopw`** fronting a logged-in browser profile. Password set, and the launcher now
  refuses to start without one.

**Also**: real product marks for Hermes/OpenClaw/Camoufox instead of approximate lucide glyphs;
skills bundled in-repo so a fresh install has a catalog; `zip` exit 18 no longer throws away a
complete archive over one unreadable file; `-x */name/*` fixed to also match at the archive root.

**What broke, and how it was caught.** Four commits shipped defects that passed typecheck, ~1000
tests AND a live browser check, and were found only by a later adversarial audit:
- `52949ec` pruned unknown tool ids from saved data. `mergeBuiltins` lets a SAVED copy win over
  the fresh preset, so every existing install would have had its five builtin skills emptied.
  Fresh installs were fine — which is exactly why nothing caught it. Fixed in `badef71` by
  MIGRATING ids instead of dropping them.
- `5e025ff` cached the resolved engine forever and kept two busy flags, so sends went to a dead
  closure and a send mid-run was swallowed after the composer had cleared the text. A mutate tool
  asked for from the mobile sheet hung the agent forever with no Approve button anywhere. Fixed in
  `ed8e8fd`.
- `3287f61` put the store on the eager client entry chain with an unguarded `localStorage` read,
  so a browser with site data blocked would lose the whole cockpit rather than one window — and
  `79938be`, meant to fix it, did not: `typeof localStorage` ALSO throws when the getter throws.
  It also froze the store at page load, so a second tab silently clobbered agents created in the
  first. Both fixed in `c30e6e6`.

Every one failed only for a returning user, a second tab, a denied-storage browser, or a second
interaction. **A fresh-install happy path proves nothing in this codebase.**

**Deliberately not done**: agent tool scoping stays fiction-free by deletion rather than
enforcement (a per-agent tool array would also cold-miss the prompt cache on every switch, and the
per-call approval card is a better lock); the `Skill` → `Playbook` rename; wiring
`Skill.starters`; caching `/api/skills` (~90 files per call).

## 2026-07-24/25 — Managed applications: Hermes + OpenClaw, each on its own origin (DONE)

> **Partly superseded by `a2c3882` (2026-07-28):** the *workspace modes* and *feature
> discovery* work below was REVERSED — Hermes and OpenClaw are ordinary app windows now,
> and the SPA-bundle parsers are deleted. The origin split, the proxy hardening, the
> update centre and the registry all stand unchanged. Kept because the work happened and
> the reasoning is why the reversal was right.

MSO becomes the **control plane** for applications that stay separate. Hermes and OpenClaw keep
their own runtime, config, data, versions, health, logs and backups; nothing is copied, forked or
merged into this repo, no DOM is scraped, and nothing under `~/.hermes/` or `~/.openclaw/` is ever
written — the only writes land in `~/.mso/`. Everything goes through their own CLIs, their own
loopback HTTP surfaces, and systemd/docker. Shipped as `c411187` → `52cfff5` → `0feaab4` →
`5b4b5c9` → `d1fbd85` → `c597d08` → `d880f68`. (`3b45b8e`, same session, closed an unrelated
hole: the camoufox VNC rewrite was gated only by the *presence* of a cookie named `session`, so it
is commented out and answers 403 until a real check can run in the nodejs middleware runtime.)
`tsc` + `eslint` clean, vitest **90 files / 965 passing**, deployed on `:4005`.

- **Registry** (`c411187`) — `lib/managed-apps/`: catalog (command, candidate unit + container
  names, loopback dashboard URL, state dir, env overrides), manager (detect → state → health →
  version → actions → backup → logs, one in-flight action per app), runner (`execFile`,
  `shell: false`, argv arrays, 128 KB cap, timeouts — no string ever reaches a shell). Four routes
  under `/api/v1/managed-apps`, every one `verifyAuth()` first; actions are demo-blocked,
  rate-limited 12/min and audited as `managed-app.action`. Backup copies `~/<stateDir>` into
  `~/.mso/backups/<id>/<stamp>/` and (as first shipped) refused a tree containing symlinks —
  replaced later this phase, see the fix bullet; logs are journalctl / `docker logs` with
  bearer/token/secret/password redaction.
- **Workspace modes + real feature discovery** — **REVERSED in `a2c3882`, all of this is deleted.** (`52cfff5`, `0feaab4`, `5b4b5c9`) — `plain | hermes
  | openclaw` in `localStorage` (`mso:workspace-mode`), orthogonal to Shell Style, with a
  right-click Workspace submenu on all five shells sharing one store with the Dashboard select.
  Each app's navigation is parsed from **its own installed bundle + plugin API**, not hard-coded:
  Hermes 18 nav entries + 2 plugin tabs (verified against `web_dist/assets/index-*.js` and
  `/api/dashboard/plugins`), OpenClaw 26 routes from `app-route-paths-*.js` of which 24 are
  offered (`workboard`/`plugin` are flag-gated → `available:false`). 60 s cache, min-length parse
  guard, and an unreachable upstream yields nothing rather than tiles that 404.
- **Proxy hardening** (`5b4b5c9`, `c597d08`) — upstream must be loopback; cookies namespaced
  `mapp_<id>_` and pinned to the mount so the mso `session` never crosses; `authorization` /
  `www-authenticate` never relayed; off-origin redirects refused (open redirect **and** a CSP
  path-matching bypass); upstream service workers 404'd; request bodies counted as they stream
  (a chunked body has no `content-length`); route errors carry `frame-ancestors` or the browser
  refuses to display them. The emitted CSP is now **intersected** with the upstream's own per
  directive — OpenClaw's sha256-pinned inline scripts and narrow `connect-src` survive, its
  `frame-ancestors 'none'` does not, and only hashes are ever copied, never nonces.
- **Every session cookie verified** (`d1fbd85`) — cookies are isolated by neither port nor path, so
  a planted second `session=` sorting first made every request fail HMAC and logged the owner out
  of their own cockpit. Each candidate is checked; the first that holds up wins.
- **Origin split** (`d880f68`) — the iframe needs `allow-same-origin` or the SPAs do not boot, and
  on the cockpit origin that made upstream JS same-origin *with the cockpit*: `window.top.fetch`
  → `/api/v1/exec/run` with the user's session, which no CSP can stop (a policy binds a realm, not
  a reference across realms). Each dashboard now has its **own host on this same process**
  (`{id}.mso.rahmanef.com`, DNS + `/etc/dokploy/traefik/dynamic/mso-managed-apps.yml`), so
  `window.top` is opaque — measured in Chromium 148, with a same-origin control that still breaks
  through. `proxy.ts` rewrites every path on an app host into that app's proxy and 404s the rest
  (matcher widened to `/(.*)`, CSRF check moved ahead of the rewrite, `Host` authoritative over
  `x-forwarded-host`); an unclaimed name in the namespace 404s so a DNS edit alone cannot hand out
  an authenticated cockpit. Root-mounted means the document is no longer rewritten at all (no
  `<base href>`, no rebasing, no fetch shim, nothing to pin), the policy is origin-scoped,
  `frame-ancestors` names the cockpit from deployment env only, and `img-src` drops its `https:`
  wildcard (the widened cookie would make `new Image().src` an existence oracle). The session
  cookie gained an optional `Domain` and is cleared with **and** without it; `SameSite=Strict` is
  unchanged and still correct because the app hosts share the registrable domain.
- **Verified live**, not just unit-tested: `https://hermes.mso.rahmanef.com/` and
  `openclaw.…` answer over TLS with a valid cert; `/api/v1/exec/run` and `/api/v1/sys/stats` on an
  app host come back as the proxy's own 401 with `x-middleware-rewrite:
  /api/v1/managed-apps/<id>/proxy/…` (the cockpit route is not reachable there); `staging.os.…`
  and `/_next/*` on an app host 404; the cockpit itself is untouched.
- **Env is one decision in two variables** — `NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE` +
  `OS_SESSION_COOKIE_DOMAIN`, set **before** `pnpm build` (the `NEXT_PUBLIC_` one is inlined into
  the client bundle). Unset = single-origin mode, still the dev/demo/rollback path, with the
  `window.top` reach open and the path-scoped CSP as the only containment.
- **Two defects found by writing the docs, and fixed in the same phase.** Documenting the
  subsystem against the live host is what surfaced them; both were live in a shipped build and both
  were invisible without a test, so `lib/managed-apps/manager.test.ts` (5 cases) now pins them.
  (1) **Detection** ran `systemctl is-active <unit>` and treated anything that was not "could not be
  found" as "the unit exists but is inactive" — but on systemd 255 an *unknown* unit prints
  `inactive` with rc 4 and an empty stderr, so the first configured name always won. OpenClaw's
  catalog led with `openclaw.service`, which does not exist here, so its card read `stopped` with
  `healthy: null`, empty logs (`-- No entries --`) and 409 on every lifecycle action while its
  gateway served. Now `systemctl [--user] show -p LoadState -p ActiveState` per scope: rc ≠ 0 is "no
  answer" and falls through, `LoadState=not-found` skips the name, otherwise `ActiveState` decides.
  `catalog.ts` also lists `openclaw-gateway.service` first, though ordering no longer decides
  correctness. Live after the fix, both apps through the real `listManagedApps()`: `hermes | systemd
  | running | healthy=true | dash=true` and `openclaw | systemd | running | healthy=true |
  dash=true`. (2) **Backup** walked the tree and threw on the first symlink; `~/.hermes` has 58 and
  `~/.openclaw` 2063, so the action failed for every real install and `~/.mso/backups/` was never
  created (a success would have copied 2.7 GB + 1.7 GB). The guard is gone; `fs.cp` now takes a
  filter that skips `node_modules`/`.venv`/`venv`/`__pycache__`/`.git`/`.cache`/`backups` — the last
  being the app's *own* 1.1 GB backup dir — and skips symlinks (neither followed, which would copy
  bytes from outside the app, nor recreated, which would let a restore write outside the tree). The
  source now honours `homeDir`, so `HERMES_HOME` is no longer ignored, and `manifest.json` gained
  `source` + `skipped: {symlinks, dirs, dirNames}`. Measured with those exclusions: 366 MB and
  237 MB, on 227 GB free.
- **Open, and documented as open**: no restore code, so a rollback is a manual `cp -a` and the
  manifest has no inventory or checksum to verify a snapshot; no update center (check-update,
  channels, update, rollback, uninstall, install wizard); OpenClaw's control UI is WebSocket-driven
  and a route handler cannot service an `Upgrade`, so its panels stay empty and those features open
  on a CLI view with the reason stated; the docker and `package` detection branches have no test and
  no install here to exercise them; no notifications, no resource-aware behaviour, no start-on-boot;
  no integration or journey tests; `state: "error"` is never produced and `managed-app.action` audit
  lines still carry `actor: null`; the workspace switcher is not yet a visible control in the
  macOS/Windows/iOS/Android chrome; an upstream can still broaden its own `connect-src` to a
  third-party https host it declares (never to the cockpit). **The split is a browser-realm boundary
  only** — a plugin installed into either app runs inside that daemon and can run host commands.
- Docs: `ARCHITECTURE.md` (request-path diagram + the managed-app section), `SECURITY.md`
  (origin split as a first-class boundary + operational tripwires), `README.md`, the operator guide
  in `docs/MANAGED-APPS.md`, and per-app `docs/HERMES-INTEGRATION.md` +
  `docs/OPENCLAW-INTEGRATION.md` (units, ports, auth models, discovery, upgrade tripwires). All
  re-checked against the code and the live host after the two fixes above.

## 2026-07-16 (round 8) — iOS editors long-tail: a11y + Dialog→sheet (DONE)

Closed the round-7 logged editor tail (owner-requested). Presentation-only (canvases untouched per
§6). **a11y:** coarse-pointer 44px across editor chrome in 10 files (code-editor, image-editor,
reel-editor, media-viewer, image-picker). **Dialog→sheet:** 6 raw `<Dialog>`s → house
`ResponsiveDialog`/FormDrawer (bottom sheet on touch) — reel settings + file-browser, media-studio
save-image, files zip, os-settings model-catalog (trigger-hoist + ScrollArea→Body), image-picker
(h-[440px]→flex-1); code-editor close-guard keeps its correct centered iOS alert. Added `select` to
the globals coarse rule. tsc + eslint clean, vitest 689, deployed `:4005` health 200. Detail in
`IOS-PARITY-REFACTOR-PLAN.md` §8, round 8 (doc deleted 2026-08-10).

## 2026-07-16 (round 7) — iOS touch-target a11y sweep (P4 long-tail) (DONE)

Owner requested the iOS-parity optional long-tail. A **10-agent adversarial re-audit** found **0
mis-gates** (seam discipline held — the other four shells are provably unaffected) + **63 gaps** (49
sub-44px touch targets, 8 dialog→sheet, 6 regressions from the round 1–6 AI work — the 14px app root
makes `h-8`=28px / `h-9`=31.5px fall short). Fixed the high-ROI subset: one `@media(pointer:coarse)`
`globals.css` rule for all inputs/selects/menuitems (~25 targets), 2 shared primitives
(`responsive-toolbar`, file-tree `dir`), **46 per-slice button/row 44px appends** (6-agent disjoint
fan-out), and widget-picker Dialog→`ResponsiveDialog` sheet. Editors long-tail + the model-catalog
scroll-restructure logged as remaining. `tsc` + `eslint` clean, vitest **689** green, deployed `:4005`
health 200. Full detail was in `IOS-PARITY-REFACTOR-PLAN.md` §8, round 7 (doc deleted 2026-08-10).

## 2026-07-16 (round 6) — "Alfa, forget this" tool (DONE)

Twin of `memory.remember`: a `memory.forget` host-tool (read-tier) that matches saved
facts by phrase (substring), deletes each match via `/api/memory`, and reports what it
removed. Catalog entry + HOST_SYSTEM guidance + registry test. tsc + lint + vitest green.
Also added the gitignored root `progress.md` (local session log).

## 2026-07-16 (round 5) — "Alfa, remember this" tool (DONE)

Alfa can now save facts to memory itself, not just via Settings: a `memory.remember`
host-tool (read-tier — runs immediately, no approval card, since it's a benign owner-scoped
write) that POSTs to `/api/memory`. One catalog entry (`host-tools/catalog.ts`) + a HOST_SYSTEM
guidance line; the registry test covers it as a read tool. tsc + lint + vitest green. It
complements the manual Settings → Alfa memory panel (both write the same `~/.mso/memory.json`).
**Not redeployed** — build + restart to activate.

## 2026-07-16 (round 4) — Alfa chat history (YAML threads) + cross-session memory (DONE)

Ports 2 & 3 of the models-rahmanef-com picks. tsc + lint + vitest (full suite + 4 new store
tests) green. Store logic is unit-tested; the full UI click-through (send → persist → resume;
add fact → Alfa recalls it) is best exercised on the deploy (it needs a real provider key to stream).

- **Chat history** — Alfa was stateless; now every completed turn persists to a YAML thread under
  `~/.mso/threads/` (`lib/ai/threads.ts` — path-jailed filenames, atomic write). `/api/threads`
  (list/get/save/delete). A History drawer (`thread-list.tsx`) in the Alfa header lists saved chats;
  resume restores BOTH the display bubbles and the wire history so the chat continues; New starts
  fresh. Persistence factored into a `use-thread-persistence` hook. YAML (not JSON) per the owner's
  request — readable session files (`yaml` dep added).
- **Cross-session memory** — durable facts recalled into Alfa's system prompt, matched to the latest
  user turn by word overlap (`lib/ai/memory.ts`; `~/.mso/memory.json`). `/api/memory`
  (list/add/delete). The assistant route recalls + injects for EVERY provider path (codex/anthropic/openai).
- **Token savers** — Settings → AI → Output style: Normal / Caveman (terse) / Ponytail (lazy senior
  dev) → appended to the system prompt (`OsConfig.tokenSaver`).
- New Settings **"Alfa memory"** panel (`memory-section.tsx`) under the AI section: output-style
  picker + add/delete facts. **Not redeployed** — build + restart to activate.

## 2026-07-16 (round 3) — Model catalog browser (DONE)

First of three models-rahmanef-com feature ports the owner picked (catalog browser ·
chat history · cross-session memory). tsc + lint + vitest green.

- **Model catalog browser** — `/api/models` now carries capability/pricing meta (context
  window, $/M input+output, tool/reasoning/vision support) from the models.dev catalog; a
  searchable **Browse** dialog (`model-catalog.tsx`) in Settings → AI lists the selected
  provider's models with that meta, click to set the model. Pure UI over the vendored
  `@rahmanef/models` catalog; degrades to "No catalog" for custom/OAuth providers (not in
  models.dev). **Not redeployed** — build + restart to activate.

Chat history (YAML thread store) + cross-session memory are next.

## 2026-07-16 (round 2) — BYOK OAuth: "Sign in with OpenAI" (Codex device-code) (DONE)

Phase D1 of DRAWER-MENU-BYOK-PLAN — the explicit ask ("oauth ai openai"). tsc + lint +
vitest (301) green; the Codex device-flow **start verified against the live OpenAI
endpoint** (HTTP 200 + user_code). The poll→token→chat round-trip needs the owner's
ChatGPT authorization to exercise.

- **OAuth framework** — token bundles in the 0600 host config (`OsConfig.oauthTokens`),
  transient handshake state in-memory (`lib/ai/oauth/flow-state.ts`), a per-provider
  start/poll route (`app/api/oauth/[provider]/route.ts`). OAuth providers surface in the
  connected-list (kind `oauth`), selectable + deletable.
- **OpenAI Codex** (device-code) — `lib/ai/oauth/codex.ts` (start/poll/exchange/refresh +
  `decodeAccountId` + models) + a **bespoke ChatGPT-backend Responses streamer**
  (`lib/ai/codex-stream.ts`): the platform `/chat/completions` path does NOT work — Codex
  hits `chatgpt.com/backend-api/codex/responses` with the OAuth bearer, the account id
  decoded from the token JWT, and SSE `response.output_text.delta`. Public Codex-CLI client
  id (no secret, no registration). The assistant route bypasses `resolveModel` for
  `openai-codex`, refreshes the token (120 s margin) before each call, streams via `streamCodex`.
- **UI** — Settings AI panel: "Sign in with OpenAI (ChatGPT)" → device-code (shows the user
  code, opens the verification page, polls to completion). `oauth-connect.tsx`; the active
  provider's key row + Test hide for OAuth providers.
- **Caveats (documented):** Codex is a reverse-engineered CONSUMER endpoint — needs a ChatGPT
  Plus/Pro subscription, can break if OpenAI changes it, and is **chat-only (no Alfa tools)**.
  Tokens are stored plaintext in the 0600 host file (mso's existing posture; at-rest
  encryption is a later pass). **Not redeployed** — build + restart to activate.

## 2026-07-16 — Shell action contract (drawer + OS menu) + BYOK add-provider (DONE)

Closed the gap the Apple mock flagged: feature slices now feed the shell's
menu/drawer format, and BYOK matches models-rahmanef-com's "add provider". Built
from a 3-probe audit → `DRAWER-MENU-BYOK-PLAN.md`. tsc + lint + vitest (299) green;
behaviorally verified on an isolated `:4011` dev server (prod never touched).

- **Shell action contract — one bus, both surfaces.** The AI-Inspector bus already
  publishes live per-app `actions` (all 14 apps). Surfaced them as (a) the desktop
  menu-bar app menu (`menu-bar.tsx` reads `useInspectorInfo(focusedId).actions`) and
  (b) a mobile in-app bottom-sheet drawer — a trailing "•••" in the iOS
  (`mobile-shell.tsx`) + Android (`android-shell.tsx`) app headers opens the new
  `AppActionsSheet` (shadcn Sheet side=bottom). No per-slice edits, no new bus. Did
  NOT rebuild to the mock's `prepare(ctx)→os` merge model. Verified: iOS/Android
  "•••" → New folder/Refresh/Empty Trash for Files; desktop Files menu lists the same.
- **BYOK add-provider — custom endpoint + validate + list/delete.** Streaming already
  consumed `resolved.baseUrl`+`protocol`; added the storage+UI: `OsConfig.customProviders`
  (`lib/config/store.ts`), SSRF guard (`lib/host/ssrf.ts` + test), a `protocol` override on
  `resolveModel` (`lib/models/resolve.js`), `/api/config` GET-list / POST-custom / DELETE,
  `/api/models/test` (1-token validation), and the Settings AI panel: custom-provider form
  (`custom-provider-form.tsx` + `custom-provider-config.ts` + test, ported from
  models-rahmanef-com), connected-provider list with delete (`provider-list.tsx`), Test badge.
  **OAuth deferred** (Phase D — big lift; the mock's "Sign in with OpenAI" is Codex device-code,
  not the platform API).
- Guards: iOS/Android edits live in their single-mount shells; the desktop menu addition is
  additive (empty actions → nothing renders); a null custom conn keeps built-ins registry-pinned
  → macOS/Windows/Dashboard byte-unchanged. **Not redeployed** — `pnpm build` + `sudo systemctl
  restart mso.service` to activate.

---

*34 older entries (2026-05-29 → 2026-06-15) were trimmed on 2026-08-10 to keep
this file readable as the source of truth it claims to be. Nothing referenced them
by line, and they are one command away: `git show 421ab7f:docs/PROGRESS.md`.*

## 2026-08-20 — ChatGPT generated-file → VPS bridge (DONE)

MCP now exposes `fs_upload_file` with `_meta["openai/fileParams"]`, so ChatGPT can generate or receive an image first and then transfer the exact file bytes into an existing bounded VPS directory. The server accepts only temporary HTTPS OpenAI file references, caps imports at 20 MiB, validates image MIME types, inherits the existing write-root and credential denylist through `uploadInto`, audits as `fs.upload`, and returns byte count plus SHA-256 without persisting the temporary download URL.

## 2026-09-05 — Session-scoped screenshot evidence

Screenshot evidence previously lived in unrelated scratch directories or only in MCP image responses. Added one derived session path policy, a private manifest, explicit image/report reads, and bounded registration/retention. Exec receives non-secret session directories; original bytes remain private and session responses compute paths instead of persisting absolute homes. Cleanup is lazy, lease-aware and fail-closed for unknown files; it does not run during builds or remove durable history. User/client isolation, retry de-duplication and existing integration changes are preserved. See SESSION-ARTIFACTS.md for limits and verification scope.
