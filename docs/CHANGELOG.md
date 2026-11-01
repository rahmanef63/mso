# Changelog

**Generated — do not edit.** `node scripts/gen-changelog.mjs`, run by `bun run ship`.
Newest first. `docs/PROGRESS.md` is the source of truth for *why* a change was made;
this is the *what*, and it is what Settings → Account → About shows as “What's new”.

## 2026-11-01

**Added**

- `ci` three security scanners that actually run, and lanes that fail closed (#210)
- `tui` the panel is the default, and the banner lives in the transcript (#209)

**Fixed**

- `tui` an approval prompt must leave the alternate screen, or it is erased before it is read (#213)
- `tooling` align the postcss override with its devDependency, so npx runs
- `ci` give semgrep a writable HOME, which --user removed
- `ci` run every security scanner as the runner's uid, not root
- `deps` one minimatch, the patched one, via the existing override block

**Faster**

- `baseline` regenerate on an idle host, which the old one was not

**Docs**

- `dev` regenerate the changelog before the commit, not after the gate
- `progress` correct why CI looks silent on a feature branch

## 2026-10-31

**Added**

- `tui` install the print sink the last change forgot, and migrate the modules that still print (#206)
- `tui` a suspended panel really leaves the alternate screen, so an approval is readable (#205)
- `tui` mid-turn writes go into the panel, and prompts suspend it instead of fighting it (#204)
- `tui` the composer reports its height, so the panel stops guessing how much to reserve (#203)
- `tui` one print sink, so command output lands in the panel instead of on top of it (#202)
- `tui` a right-hand side pane for todos, the last diff and changed files (#198)
- `tui` mouse wheel scrolling and tab clicks, only inside the alternate screen (#197)
- `tui` a transcript viewport with a scrollbar, so the alternate screen has a reason (#193)
- `tui` an alternate screen behind a flag, with teardown on every exit path (#192)
- `tui` a tab row and a footer that stay put, painted through the frame writer (#191)
- `tui` a transcript model, because scrollback is the only transcript that exists (#187)

**Fixed**

- `security` allow the socket-policy route-test fixture in the history scan
- `tui` the two bugs a real pty found, and the test that found them (#201)
- `ci` apply the same parser workaround to the last two mock call sites (#196)
- `ci` stop the semgrep scan failing on a generic argument in a test mock (#195)

**Changed**

- `tui` paint the composer through a frame writer instead of appending (#189)

**Tests**

- `api` every route now has a test — 117 of 117
- `api` cover 30 more routes, and close the one fs route with no rate limit

**Docs**

- `progress` record the LCP measurement, the eager-graph trim and the traps
- `tui` a handover for the panel track, so a pause costs nothing (#208)
- handover for the next session, plus the entry this session was missing
- `tui` name the four things between here and an alternate screen default (#199)

## 2026-10-30

**Added**

- `agent` /jobs, so background subagents are visible instead of fire and forget (#183)
- `tui` configurable keybinds, with the defaults kept byte-identical (#182)
- `agent` show the todo checklist in the TUI and in the status row (#179)

**Changed**

- `tui` share the cell and pane primitives instead of growing a second copy (#186)

**Tests**

- `api` lock the status-code contract on the routes where a dropped gate is an RCE
- `perf,api` prove the gate catches regressions, and restore the rationale the refactor dropped

**Docs**

- `tui` plan the retained renderer, M0 (#185)
- `migration` correct the "2.8x" claim that justified cancelling Phase 4
- `bench` the after-side comparison, and a status header that was no longer true

## 2026-10-29

**Added**

- `agent` fs_edit reports the diff it applied and can preview without writing (#178)
- `agent` a bounded pty_session tool, so an agent can drive an interactive process (#176)
- `agent` background subagents, so a parent can keep working in parallel (#175)
- `agent` surgical edit, content search, glob and a todo list (#173)
- `perf` hydration mark chain, and the LCP conclusion it overturns
- `tui` close the opencode TUI gap on the seams MSO already owns (#166)

**Fixed**

- `gates` make the full local gate match CI, fixing three real defects it exposed
- `perf` compare TBT only on the same machine, not just the same load
- `shell, gates` restore the artwork reveal rule, and make the instance guard actually read files (#171)
- `install` make bun install compile node-pty without a global node-gyp
- `api` restore the models provider name the route extraction dropped (#169)
- `api` restore the models provider name the route extraction dropped (#168)
- `build` restore the turbopackIgnore annotation the route extraction dropped

**Faster**

- `gate` run it in CI, and make the timing half load-aware
- `shell` take hidden app artwork off the layout and paint path (#167)
- close two eager leaks, cancel the island plan, budget from arithmetic
- `app-store` load RuntimeApp lazily so vaul leaves the first-load chunk

**Changed**

- `api` every route handler is a thin adapter, and lib is next-free
- `lib` drop static next/* imports, plus three measured perf findings

**Docs**

- `migration` Phase 5 edge-behaviour spike, verified with curl
- `progress` record Phase 2 completion, the bun install fix and the Phase 6 no-go
- `progress` record the perf gate and the numbers it retracted

**Chores**

- `gates` restore the CI-parity runner lost in the rebase
- `gates` re-add the 12-gate runner and regenerate the changelog

## 2026-10-28

**Added**

- `perf` phase 0 perceived-performance gate and migration baseline
- `cli` close the opencode parity gap on run/session/stats/pair/doctor --json/completion (#165)

**Docs**

- `agents` refresh AGENTS.md and add .mso/KNOWLEDGE.md for #154-#162 (#164)
- `antislop` design direction, agent pointer, and the R-10 glass audit (#163)

## 2026-10-27

**Added**

- `infra` collapse Convex into one provider with a real self-hosted kind

**Fixed**

- `copy` replace em dashes across user-visible strings (antislop R-02) (#162)
- `update` one Settings cue, no toast and no floating badge (#161)
- `build` keep Convex project linking out of Turbopack's traced filesystem

**Tests**

- `infra` make Convex fixtures unambiguously synthetic for the secret scanner
- `e2e` select the collapsed Convex card in the release journey

**Build**

- `deps` bump the actions-minor-patch group with 3 updates (#159)
- `deps` bump the production-minor-patch group with 16 updates (#157)
- `deps-dev` bump the test-toolchain group with 2 updates (#156)

## 2026-10-26

**Docs**

- `license` switch to PolyForm Noncommercial and add per-repo references (#155)

## 2026-10-25

**Added**

- `agent` one live activity row and env-tunable turn budgets (#154)

## 2026-10-24

**Added**

- `infra` deterministic Convex project linker and per-project provider view

**Fixed**

- `deps` clear undici + zod advisories blocking every merge (#153)

## 2026-10-23

**Added**

- `integrations` workspace-scoped demo logins and on-demand secret reveal (#150)
- `composio` route ck_ Connect keys to connect.composio.dev/mcp (#146)

**Fixed**

- `settings` bounded provider picker, auto-discovery, honest model switching (#151)
- `infra` validate Composio Connect keys at the Connect MCP endpoint (#148)
- `deps` bump next 16.4.0 -> 16.4.2 for unauthenticated RCE advisories (#147)

## 2026-10-22

**Added**

- `mcp` add an Orca board bridge over MCP stdio
- `agent` drive installed agent CLIs over ACP (#143)
- `composio` per-end-user session with the credential its MCP endpoint needs (#142)
- `update` keep user changes, name conflicts, and drop the install pill (#140)
- consolidate shell-app domain provisioning and Orca integration (#138)
- `settings` account icon picker, nightly auto-update, stable channel (#139)
- one-click install and connect converge on a shared shell-app domain step (#136)
- `settings` explain update refusals, merge Server into Devices (#135)

**Fixed**

- `systemd` stop quoting WorkingDirectory, restore install exec bit
- `ci` break profile taint, drop test race, bound registry probe (#141)

**Changed**

- `infra` split composio session into contract, store and orchestration (#145)
- `agent` split ACP client into framing, rpc, permission and process (#144)

**Tests**

- `git` isolate remote-authority assertions from operator git config
- `env` list ORCA_BIN as a bridge-only knob

## 2026-10-21

**Added**

- `cli` print the mso ai reply text instead of SSE frames
- `infra` add Linear provider and route Composio key kinds by header

**Fixed**

- `deps` pin vite 8.2.4 to clear GHSA-587h-7wmj-h5pm

## 2026-10-20

**Fixed**

- `assistant` accept OpenAI-shaped {content} messages and harden recall
- `build` keep convex CLI config path out of asset tracing

## 2026-10-19

**Build**

- `deps` bump the production-minor-patch group across 1 directory with 15 updates
- `deps-dev` bump the test-toolchain group across 1 directory with 2 updates
- `deps` bump the actions-minor-patch group with 6 updates
- `deps-dev` bump the development-minor-patch group with 3 updates

## 2026-10-18

**Added**

- establish Nakama traceability and first Owner workflows
- `mcp` bump toolset version and regenerate MCP catalog for fs_stat
- `mcp` add fs_stat read capability and parity exemption
- `mcp` reclaim ChatGPT profile budget by lowering compact description cap
- `host` add statReadableMeta for bounded path metadata
- `cli` named `threads rename` verb for PATCH /api/threads
- `assistant` render per-turn token usage and running thread total
- `ai` parse and propagate provider usage from stream turn
- `workflow` bind graph agent node to durable sessions via sessionRef
- `agent` add durable session turn runner with lease and persistence
- `assistant` add search, rename, recency, and confirm-gated delete to thread drawer
- `assistant` add title override support to useThreadPersistence
- `skills` wire catalog TTL cache into /api/skills list route
- `skills` implement createCatalogTtl memo with injected clock
- `api` add PATCH endpoint to rename threads
- `ai` add renameThread helper with atomic save

**Fixed**

- `ci` keep secure CLI fixtures compatible with validation
- `workflow` retain completion during status receipt reads
- `security` guard model discovery and isolate CodeQL findings
- close domain integration regressions and preserve strict gates
- satisfy strict CLI and source parsing checks
- `assistant` reset thread drawer state during render, not in effect
- `update` treat a proven service-owned listener as update-safe
- `assistant` keep the eager shell CSS rule set unchanged

**Changed**

- `assistant` move chat turn-usage state into use-turn-usage hook

**Tests**

- `terminal` isolate real PTY fixture from owner shell state
- `mcp` add unit tests for fs_stat read capability
- `api` cover GET and POST handlers in threads route test

**Docs**

- record stopped MSO deep QA checkpoint
- record the service-owned update fix and the lint restoration
- `progress` record the fs_stat revival and the tighter compact cap
- `progress` record the fs_stat revert and the threads rename CLI verb
- `progress` record the 2026-10-18 agent-surface batch and the no-change bench
- `workflows` document proactive turns on durable sessions in workflow graphs

**Chores**

- `mcp` version preserved observation contract
- `repo` reconcile preserved laptop work on current main
- `ci` require agent PR readiness evidence

**Other**

- Revert "feat(mcp): add fs_stat read capability for bounded path metadata"

## 2026-10-17

**Added**

- `cli` add hidden local password setup
- `domains` provision persistent managed-app subdomains from CLI
- `models` discover model ids from custom endpoints

**Fixed**

- `cli` include passwd in command discovery
- `mcp` repair observation workflows and connection diagnostics

**Docs**

- `progress` preserve managed-domain CLI handoff and remaining gates
- `progress` record custom-endpoint discovery deploy and no-service ship limitation

**Chores**

- `cli` normalize password test file modes

## 2026-10-15

**Fixed**

- `security-core` parse the provider case arm on its own lines
- `oauth` re-register a cached public client id on demand

**Faster**

- `appshell` memoise chat rows and show human tool identity

## 2026-10-14

**Added**

- `tenancy` owner-only enrollment CLI for tenant bindings

**Fixed**

- `cli` repair provider picker and make models add scriptable
- `config` keep tenant config path traceable by Turbopack

## 2026-10-13

**Added**

- `config` per-tenant credential store under OS_MULTIUSER_ROOT

**Tests**

- `e2e` right-click the desktop from its measured box
- `e2e` scope workflow directory assertions to the panel

**Build**

- `deps-dev` bump the development-minor-patch group with 3 updates
- `deps` bump the production-minor-patch group with 15 updates
- `deps-dev` bump the test-toolchain group with 2 updates

## 2026-10-12

**Added**

- `channels` start an Agent group from a bound Telegram group
- `agent-group` multi-agent discussion groups over Hermes profiles

**Fixed**

- `agent-group` spawn hermes by name to keep build tracing static

## 2026-10-10

**Added**

- `vault` read agent knowledge natively in MSO

**Fixed**

- `security` preserve worker grants and bound file reads
- `mcp` retain scanner limits and document mailbox parity
- `security` close credential sinks and revoke pending sessions
- `mcp` preserve managed configuration behind credential guards
- `security` bind receipts to authority and pin browser artifacts
- `security` keep connected app bootstrap code static
- `security` protect public admission and OAuth registration trust

**Faster**

- `vault` bound unfinished Markdown link matching

**Tests**

- `security` keep raw stream fixture fully parseable
- `e2e` scope MCP refresh to its tab panel
- `managed-apps` wait for durable job finalization before cleanup
- `workflows` complete waited receipt fixture schema
- `oauth` receive consent callbacks outside the shell
- `security` exercise webhook admission with explicit proxy trust
- `auth` isolate default proxy policy from host configuration

**Other**

- `mcp` keep local agent tools within architecture limit

## 2026-10-09

**Added**

- `apps` reuse MSO sessions for private connected apps
- `agent-vault` isolate repository progress in private Obsidian vaults

**Fixed**

- `security` close rescan authorization and isolation gaps
- `agent-vault` reuse shared styles within the shell bundle budget
- `security` pin bounded MCP store reads to one descriptor
- `oauth` keep registered consent within narrow viewports
- `security` enforce live delegated grants and bound provider and OAuth state
- `security` close remaining repository scan trust boundaries

**Tests**

- `security` assert oversized admission before body transfer
- `security` preserve regressions without synthetic scanner matches
- `security` exercise managed app authorization on its actual host
- `workflow` pin grant fixture time during revocation checks
- `security` run app cookie proof in the browser release lane

**Docs**

- `security` document legacy cookie cleanup configuration

## 2026-10-08

**Fixed**

- `macos` align window title and control edges
- `appshell` inherit macOS menu colors without extra CSS
- `appshell` align macOS menu symbol colors
- `macos` unify shared menu glass material
- `macos` unify shared menu typography with Figma reference
- `fs` cap the complete enumeration response
- `security` revalidate durable authority and bound follow-up scan paths
- `heartbeat` preserve relative env paths in cron
- `ux` reuse existing loading and glass styles within the shell budget
- `heartbeat` use parseable multiline shell case statements
- `ux` stack install notice above the update badge without overlap
- `build` keep guarded host runtime paths out of asset tracing
- `security` close resource and launcher gaps and repair gates
- `security` inspect ZIP output through pinned descriptor
- `ci` close gateway typing and audit file races
- `security` pin NodeSource bootstrap bytes
- `security` bound managed-app backup retention
- `security` bound audit growth and tail reads
- `security` bind gateway tunnels to proven local runtime
- `ux` Spotlight contrast, cold-load splash, and safe P2 polish
- `security` fail closed on mutable managed-app updates
- `security` keep OpenClaw provider keys out of argv
- `security` serialize managed-app lifecycle cross-process
- `security` bound archive generation resources
- `security` serialize bounded image imports
- `security` require exec for A2A loopback discovery
- `security` isolate PAT principals and revoke refresh replay
- `ci` clear typecheck, OSV, and reviewed history gates
- `security` require authenticated workflow webhooks
- `security` block delegated writes to control plane

**Changed**

- `macos` centralize shared chrome geometry and typography
- `security` keep authority fixes within architecture line limits

**Tests**

- `macos` measure menu width after opening animation
- `security` distinguish synthetic A2A redaction fixture
- `security` verify production sockets and preserve bounded project scans
- `lock` wait for the privacy curtain keyboard listener before unlocking

## 2026-10-07

**Fixed**

- `security` bound public ingress bodies
- `security` enforce live workflow authority
- `security` harden credential and A2A boundaries

**Docs**

- `security` record scan hardening boundaries

## 2026-10-06

**Added**

- `runtime` add opt-in cron heartbeat for fallback recovery
- integrate verified MSO shell and tenant changes

**Fixed**

- `deps` update sharp override for librsvg security patch
- `deps` update source-map-js to patched 1.2.2
- `agent` preserve overlapping standby wakeups

**Tests**

- `e2e` wait for deferred lock keyboard listener

**Docs**

- reconcile reviewed 9Router app-host proposal

## 2026-10-05

**Chores**

- `deps-dev` bump simple-icons

**CI**

- preserve strict audit and require native audit and shell journeys

## 2026-10-04

**Added**

- `appearance` refresh default light and dark wallpapers

**Fixed**

- `appearance` version immutable default wallpaper URLs
- `appearance` refine default 27 desktop wallpapers
- `security` clear unfixed dependency and Semgrep audit gates

**Chores**

- `deps` bump the actions-minor-patch group with 3 updates
- `deps` bump the production-minor-patch group with 5 updates
- `deps-dev` bump the test-toolchain group with 2 updates

## 2026-10-02

**Fixed**

- `alfa` preserve provider configuration and verify inference

## 2026-09-30

**Added**

- `settings` surface MSO updates in footer
- `assistant` show explicit run state and scoped approvals

**Fixed**

- `security` validate trace metadata and use atomic file descriptors
- `security` bound code-scanning filesystem paths and CLI test execution
- `organization` memoize focused groups and retain group search
- `deps` update brace-expansion within supported major lines
- `reconciliation` close combined environment and fixture contracts

**Changed**

- `local-agent` keep lifecycle initialization within source gate
- `alfa` extract dated transcript within source size gate

**Tests**

- `security` isolate count and identity scans from elapsed deadlines
- `store` align standalone assertions with page readiness budget

**Docs**

- `progress` record verified reconciliation takeover

## 2026-09-29

**Added**

- `a2a` add provider-neutral workflow trace skill

## 2026-09-28

**Added**

- `app-store` read bounded MANEF catalog metadata
- `host` begin native platform runtime adapters
- `store` import portable connected app manifests

**Tests**

- `host` exercise native macOS and Windows candidate build
- `projects` isolate count and deadline continuation budgets

**Chores**

- `deps-dev` bump the development-minor-patch group across 1 directory with 3 updates
- `deps` bump the actions-minor-patch group with 3 updates
- `deps` bump the production-minor-patch group with 5 updates
- `deps-dev` bump the test-toolchain group with 2 updates

## 2026-09-27

**Added**

- `shell` persist and embed external app connections
- `managed-apps` preflight install backend on host
- `jev` persist reusable session capsules
- `settings` nest version and updates under About

**Fixed**

- `settings` keep action labels readable on dark cards
- `install` preserve portable host commits and validate WSL2
- `jev` validate decision release contract
- `jev` open responsive session details in release journey
- `settings` align MCP release journey with breadcrumbs
- `settings` scroll MCP pages without reading a ref during render

**Docs**

- `features` define modular external feature contract
- `release` record Windows taskbar fidelity

## 2026-09-26

**Added**

- `jev` productionize decision plane
- `settings` add an Account section for profile, password, devices, and about
- `jev` add policy-bound MCP actions
- `workflows` isolate source-changing agents
- `agent` recover interrupted sessions automatically
- connect OpenRouter for JEV without switching model
- route JEV through OpenRouter and preserve sessions
- `integrations` clarify DOKU credential fields
- `memory` expose backup history and checksum-bound verification receipts

**Fixed**

- `jev` close release contract gaps
- `auth` rebuild the account profile before writing it
- `windows` match native taskbar proportions
- `worktrees` keep runtime paths out of build tracing
- `memory` keep runtime backup paths out of build tracing
- `tests` make recovery fixtures portable
- `workflows` close source isolation bypasses
- `config` document agent worktree root
- tolerate bounded session name contention

**Changed**

- `mcp` preserve architecture line ratchet

**Tests**

- `memory` isolate backup panel accessibility and preserve failure evidence

**Docs**

- refresh changelog for Windows taskbar fidelity
- `launch` focus demo on one verifiable agent journey
- `launch` define measurable MSO readiness contract

## 2026-09-25

**Added**

- `memory` preserve session sources and expose owner second brain
- `integrations` add native Google OAuth and read-only APIs

**Fixed**

- `memory` exclude guarded runtime backup paths from build tracing
- `integrations` expose native Google through MCP schemas

**Docs**

- `integrations` finalize native Google MCP verification
- `integrations` record native Google verification

**Other**

- `memory` preserve non-destructive backup worker checkpoint
- `memory` preserve bounded discovery worker checkpoint

## 2026-09-24

**Added**

- `memory-graph` add an owner knowledge graph
- `integrations` add JEV variables and AI providers tab
- `workflows` add Jev flow optimizer

**Changed**

- `workflows` remove optimizer type cycle

**Docs**

- `integrations` record release verification

**Chores**

- `workflows` finalize Jev flow optimizer release

## 2026-09-23

**Added**

- `mcp` add personal access tokens and auto-session fallback

**Fixed**

- `security` pin Termux guest installer payload
- `architecture` keep Dokploy adapter within ratchet
- `dokploy` sync public Docker build args
- `security` restore federation gate checks
- `dns` support wildcard staging hosts
- `termux` pin guest bootstrap and align platform contracts
- `ci` keep PAT scope case parseable by strict Semgrep

**Tests**

- `channels` avoid secret-like Discord fixture
- `termux` avoid check then read race in launcher fixture

**Docs**

- `mcp` record restored PAT quality gates
- `termux` record PRoot isolation and verification

**Other**

- `channels` allowlist synthetic Discord fixtures

## 2026-09-22

**Added**

- `channels` add Telegram and Discord channels
- `federation` bridge Batonly to MSO and SI-Coder
- `workflows` split n8n and improve org automation ux

**Fixed**

- `cli` cover federation status and PAT creation
- `termux` make partial installs resumable on low memory
- `mcp` restore main quality gates
- `termux` replace legacy launcher symlink safely
- `termux` isolate Linux runtime inside PRoot
- `mcp` publish modern cache hints
- `workflows` reopen details on node selection
- `mcp` normalize widget resource discovery

**Changed**

- `graph` establish shared flow foundation
- `ui` reduce organization and workflow chrome

**Tests**

- `workflows` update details selection contract

## 2026-09-21

**Added**

- `workflows` refine builder and organization focus UX

**Fixed**

- `mcp` negotiate native app ui

**Chores**

- `deps-dev` bump the development-minor-patch group with 3 updates
- `deps` bump the production-minor-patch group with 4 updates

## 2026-09-20

**Added**

- `workflows` add bounded repeat-until loops
- `agent` add durable local-agent standby

**Fixed**

- `alfa` restore mobile text selection and copy
- `mcp` add native UI host probe
- `chatgpt` stage portable OpenAI plugin package
- `memory` keep large typed projections mutable

## 2026-09-19

**Added**

- `memory` close self-improvement loop
- `cognitive` add bounded replay and candidate reuse
- `install` add detailed platform tabs
- `mcp` encode agent bootstrap and capability-parity map

**Fixed**

- `integrations` classify resend scope-limited doctor safely
- `browser` stop Camoufox session cleanly
- `plugin` distinguish staging from ChatGPT app install
- `memory` persist workflow and organization actions
- `browser` settle Camoufox viewer auth before reload
- `browser` keep Camoufox viewer transport clean
- `plugin` bind ChatGPT app by stable app id only
- `cli` keep candidate command parser strict
- `plugin` keep OpenAI app binding private per install
- `security` keep remote-authority test shell path trusted
- `security` keep installer sources strict-semgrep parseable
- `browser` reload viewer after ticket exchange
- `mcp` harden native UI and plugin bindings
- `ai` separate provider connect from selection
- `security` bind Convex snapshot path identity
- `browser` derive isolated Camoufox viewer origin
- `browser` probe cache-isolated Camoufox path
- `security` pin Convex snapshot import bytes
- `security` keep macOS installer fully parseable
- `mcp` keep architecture ratchet and bootstrap tests green
- `browser` route Camoufox websocket through viewer namespace
- `browser` isolate Camoufox viewer cache

**Changed**

- `security` isolate Convex snapshot staging

**Tests**

- `browser` keep viewer reload regression within architecture ratchet
- `security` keep snapshot regression descriptor-only

**Chores**

- `mcp` advance graph toolset signature

## 2026-09-18

**Added**

- `install` add cross-platform host adapters
- `integrations` add safe Convex Cloud deploy runner
- `ci` add independent exact-SHA verification runner
- `workflows` add reviewed external editor tabs
- `graph` add selected custom nodes and readable connection routing
- `organization` add internal project flows with callable CRUD

**Fixed**

- `browser` isolate sibling Camoufox viewer auth
- `integrations` allow Convex snapshot imports
- `security` cover reviewed static asset variants
- `review` preserve session and surface store invariants
- `security` validate cache exceptions from raw report
- `security` scope passive cache review by path
- `auth` permanently revoke retired cookie sessions
- `workflows` preserve explicit empty sandbox
- `security` review cache-only passive signal
- `graph` close routing and compact focus review
- `auth` bind sessions to cookie scope
- `workflows` remount editors when sandbox policy changes
- `workflows` retain approved shared surface placements
- `browser` keep Camoufox automation on demand
- `workflows` isolate external editors from cockpit session cookies
- `ci` preserve repository-owned local gate environment
- `graph` reconcile controlled selection and preserve routing groundwork
- `workflows` keep runtime registry out of deployment tracing
- `security` apply existing ZAP informational policy explicitly
- `security` require executed passive scan evidence
- `security` restore native dependency update cooldown
- `browser` retain private viewer connectivity without server access
- `release` align Node support and read-only browser reconnects
- `extensions` lock project controls until initial inspection
- `browser` diagnose secure viewer failures without losing power state

**Tests**

- `security` track reviewed cache signal
- `browser` make viewer fixtures independent of host configuration
- `security` inspect organization fixture through one descriptor

**Docs**

- `progress` preserve merged release order
- `ci` document independent runner state directory
- `security` document the hosted passive scan target

**Chores**

- `deps-dev` bump @types/node
- `deps` bump the production-minor-patch group across 1 directory with 7 updates

## 2026-09-17

**Added**

- `workflows` add exact session artifact history
- `store` unify VPS MCP and skills installation with dynamic host harness

**Fixed**

- `ci` reconcile dependency updates as matched toolchains
- `security` retain cooldown for native dependency updates
- `installer` lock isolated native build tool dependencies
- `proxy` finish portable managed-app loopback relay
- `workflows` pin private storage reads and atomic writes
- `ci` preserve strict scanner coverage on hosted release
- `forge` make sandbox bootstrap portable on hosted Linux
- `integrations` preserve implicit direct connection compatibility
- `doctor` respect no-systemd and remote runtimes
- `workflows` harden reconciled artifact history reads
- `integrations` prefer GitHub OAuth
- `hosted` restore updates and Hermes runtime
- `update` recover no-systemd container installs
- `installer` build node-pty reliably on Codespaces
- `managed-apps` support Hermes without systemd

**Faster**

- `workflows` keep runtime artifacts out of build tracing
- `shell` defer optional surfaces and bound cold-load bundles

**Changed**

- `gateway` isolate provider adapter boundary
- `gateway` make lifecycle provider agnostic

**Tests**

- `security` drain lock contenders before fixture cleanup
- `gateway` reap lock holder fixtures without orphan processes
- `workflows` stabilize repeated artifact inspection journeys

**Docs**

- `comparison` refresh product audit

**Chores**

- `deps` bump the actions-minor-patch group with 3 updates
- `deps-dev` bump postcss in the development-minor-patch group
- `deps` bump the production-minor-patch group with 7 updates
- `release` bump app version to 0.2.18
- `release` bump app version to 0.2.17

## 2026-09-16

**Added**

- `workflows` close session self-improvement loop
- `mcp` add compact ChatGPT list surface
- `plugins` add structured OpenAI skill contracts
- `workflows` stabilize semantic action references
- `workflows` add semantic session flows
- `workflows` visualize agent sessions
- `ai` add dynamic free provider discovery
- `workflows` maximize script and search automation

**Fixed**

- `plugin` support optional connector bindings
- `workflows` keep session nodes clear on compact canvas
- `workflows` dismiss session inspector on handoff
- `canvas` isolate react flow accessibility ids
- `workflows` keep compact session nodes clickable

**Changed**

- `workflows` satisfy session graph release gates

**Tests**

- `workflows` count hidden terminal sessions during inspector
- `workflows` expand semantic action receipt reliably
- `workflows` target semantic action summary
- `workflows` expand session actions before launch
- `mcp` close mobile session windows
- `canvas` scope graph controls per app
- `mcp` clean workflow window after session journey
- `mcp` restore settings after terminal handoff
- `mcp` preserve preexisting terminal state
- `mcp` close session terminal across shells
- `mcp` close terminal after session graph check

**Docs**

- `plugin` clarify extension taxonomy

## 2026-09-15

**Added**

- `workflows` finish edge controls and directory
- `workflows` complete canvas runtime
- `canvas` unify organization and workflow navigation
- `organization` surface as first-class app
- `organization` add agent org chart and routing
- `workflows` complete server-native automation parity
- `workflows` add server-native workflow graph

**Fixed**

- `responsive` reflow feature panes
- `workflows` separate runtime input from graph secret guards
- `workflows` allow inbound webhook trigger boundary
- `workflows` honor responsive shell modal policy
- `workflows` compact graph mcp surface
- `workflows` complete cli and release gates
- `mcp` expose downstream project tool results (#43)

**Tests**

- `mcp` register organization parity boundaries
- `cli` include organization command module in route coverage

## 2026-09-14

**Added**

- `integrations` simplify UI and secure credential exports
- `mcp` add original-byte file transfer

**Fixed**

- `shell` place server status in native chrome
- `integrations` use contrast-safe action tokens
- `integrations` inherit shell design tokens
- `integrations` align layout with Settings sidebar
- `mcp` harden bidirectional file transfer
- `mcp` bind ChatGPT Azure file trust to OAuth provenance
- `mcp` make project plugins explicit opt-in installs
- `mcp` trust verified ChatGPT Azure file host
- `integrations` preserve strict SC bundle validation
- `integrations` make shell embed frameable
- `integrations` add shell app and detect SC worktrees
- `integrations` expose native shell and managed SC project bindings
- `mcp` fall back when project MCP discover returns -32601

**Changed**

- `integrations` source compact width from responsive SSOT

## 2026-09-12

**Added**

- `mcp` unify responsive previews and recover session storage
- `mcp` add project automation flows and dynamic MCP sessions

**Fixed**

- `update` report latest builds without systemd
- `ui` theme native scrollbars across the MSO shell
- `ui` fill MCP Page height and apply MSO branding
- `flows` enforce canonical paths and bounded waits

**Tests**

- `ui` constrain simulated host message origins

**Docs**

- `mcp` add README quickstart and practical how-to
- `progress` record native scrollbar verification

## 2026-09-11

**Added**

- `install` enable MCP exec + document stable Cloudflare tunnel defaults

**Fixed**

- `ci` resolve synthetic history findings and await exact CodeQL evidence

**Tests**

- `forge` use node fixture commands under Bun runner

**Docs**

- `termux` add one-pass Android installer
- `security` document fresh-install MCP exec exposure

## 2026-09-10

**Added**

- `mcp` expose complete ChatGPT tool surface

## 2026-09-09

**Added**

- `integrations` unify semantic credential management
- add bounded Dokploy Dockerfile build operation
- `mcp` add session cards, readable logs and handover guide
- split MCP access and add plugin registry

**Fixed**

- `mcp` keep ChatGPT Page iframe-free
- `mcp` make Page surface registry instance-dynamic
- `update` harden release verification and settings UX
- `auth` harden browser session persistence
- `integrations` synchronize owner-local SC credential snapshots
- `security` eliminate parser gaps and enforce strict SAST coverage
- `gateway` wait for launcher handoff before tracking tunnel identity
- `build` separate runtime inputs and clarify mobile MCP guides
- `a11y` label settings controls and expose selected options
- `settings` clarify MCP navigation and enforce zero-warning tests
- persist the ready tunnel process identity after launcher exec
- reject login redirects normalized into external destinations
- isolate legacy browser credentials and close scanner findings
- keep the session mode badge clear of mobile navigation
- harden audited execution, integrations and release journeys

**Faster**

- `mcp` bound active session refresh to live leases

**Changed**

- `gateway` keep provisional readiness with pending lifecycle

**Tests**

- `pty` wait for terminal output to drain after exit
- remove obsolete preview directory configuration
- validate the bundle fixture before checking tag rejection
- stabilize authenticated release journeys and retain build failure logs
- distinguish desktop dock launch from icon selection
- target accessible launchers and clarify delegated sign-in

**Docs**

- record extended production browser verification
- record audit remediation verification and limits

## 2026-09-08

**Added**

- `desktop` give Finder, Explorer and Settings native platform layouts

**Fixed**

- `portability` allow configured auth query
- `portability` derive instance MCP context
- `integrations` verify self-hosted Convex admin keys

**Chores**

- standardize bun 1.4.2

## 2026-09-07

**Added**

- `integrations` share a responsive connection workbench
- `mcp` bind modular project tools to private integrations
- `infra` ensure Dokploy GitHub applications

**Fixed**

- `infra` allow Baton build SHA metadata

## 2026-09-06

**Added**

- `infra` add bounded Dokploy application deploy
- `infra` separate DOKU payment and MCP credentials
- `infra` add private DOKU MCP connections
- `infra` add private Convex env presence checks
- `infra` add safe Dokploy deployment recovery
- `infra` manage Convex Cloud custom domains safely
- `infra` add bounded Dokploy public env rollout

**Fixed**

- `infra` allow bounded Dokploy public env values
- `mcp` preserve compact integration headroom
- `infra` expose bounded Dokploy integration operations
- `infra` support modern pinned DNS lookups

## 2026-09-05

**Added**

- `integrations` detect local SI-Coder migration
- `agent` add native integrations slash skill
- `integrations` polish Finder TUI frame and UX
- `integrations` use Finder-style column browser
- `integrations` add interactive terminal navigator
- `hostinger` add Mail API connection operations
- `integrations` add portable JSON transfer and standalone import adapter
- `integrations` unify native users connections and source-aware execution
- `artifacts` add private per-session screenshot storage and retention
- `integrations` add native secure credential setup in browser and MCP Page
- add safe local maintenance and visual README
- `mcp` preserve restricted project service bridge

**Fixed**

- `security` enforce actual branch code-scanning alerts
- `security` make import preview confirmations opaque
- `security` key portable import preview confirmations
- `mcp` render one bounded inline Page preview
- preserve home-relative stores and prove tunnel rollback completion
- `security` verify exact branch dispositions and narrow message origins
- `security` retain artifact-lock compatibility and require fresh scan evidence
- `security` pin store paths and eliminate unsafe file-read patterns
- `mcp` add explicit browser sign-in for reviewed embedded apps
- `security` gate on actual GitHub open findings
- `integrations` repair embedded setup and complete native provider catalog
- `integrations` recover setup UI and cached chat links
- `release` wait for HTTP readiness before validating served assets
- `mcp` initialize page previews and verify embedded app readiness
- reconcile maintenance handoff and CLI version contracts
- `security` close exec expansion gap and exact test discovery
- `security` harden share audit and release verification
- `update` handle diverged checkout explicitly

**Changed**

- remove unused symbols and enforce compiler checks

**Tests**

- make insecure-permission fixture explicit under private umask
- validate PR integration and maintenance safety boundaries

**Docs**

- show the interactive mso terminal in README
- restore inline demo and lead with agent capabilities
- `mcp` document service tokens and update reconciliation

**Chores**

- `security` expose sanitized alert annotations
- release security and visual documentation fixes as app 0.2.4

## 2026-09-04

**Added**

- `mcp` simplify ChatGPT UI to Block and Page
- `assistant` turn Alfa into MSO cockpit

**Fixed**

- `mcp` align widgets with rahmanef palette
- `release` bound local dependency audit

**Changed**

- `mcp` dedupe ChatGPT CSP metadata

## 2026-09-03

**Added**

- `mcp` embed Play Together securely
- `mcp` add secure ChatGPT MSO Surface
- `agent` add P10 memory lifecycle calibration
- `mcp` complete Fresh 3 plugin contracts
- `mcp` maximize Fresh 3 operator capabilities
- `mcp` harden ChatGPT profile and project bridge

**Fixed**

- `mcp` correct Fresh 3 Surface scope
- `mcp` open contextual MSO views
- `runtime` prevent live Next build corruption
- `mcp` harden Open in MSO navigation
- `agent` calibrate correction memory semantics
- `agent` compare normalized token proofs per row
- `mcp` advertise implemented protocol era
- `mcp` support trusted browser probes
- `oauth` issue distinct dynamic client ids
- `mcp` make read pipeline schema portable

**Faster**

- `agent` add P8 calibration harness
- `agent` add repeatable corpus runner
- `agent` expand objective repo corpus

**Changed**

- `mcp` unify ChatGPT Surface UI

**Tests**

- `agent` calibrate local semantic memory retrieval
- separate corpus accounting ownership
- keep Fresh 3 within architecture ratchets
- `gateway` await complete browser argv capture

**Docs**

- bound Cognitive Runtime claims to verified evidence
- refresh maintainability changelog
- `agent` record P9 memory calibration
- `agent` record P8 calibration baseline
- `agent` record P7 repeated corpus baseline

## 2026-09-02

**Added**

- `mcp` add two-way local agent receive
- `mcp` add read-only result pipeline
- add RASMIC orchestration memory automation
- `agent` section terminal and recover API errors
- `agent` name sessions and wrap composer
- `agent` correlate local replies and add subagents
- `agent` add native local session messaging
- `agent` add restart and new session
- `a2a` enable local and inbound defaults
- ship authenticated and local A2A
- `agent` add eval-gated tool forge
- `agent` add interactive permissions and a2a v1

**Fixed**

- make modular shell ownership explicit
- `agent` wake on local requests
- `cli` clear ShellCheck warnings
- `agent` require live receiver for mentions
- `agent` make restart process-safe
- `a2a` harden remote v1 delegation

**Faster**

- `agent` normalize provider usage semantics
- `agent` add comparable quality corpus
- `agent` route capabilities before model reasoning

**Changed**

- split installer phases and lock release lifecycle
- split CLI into bounded command modules
- separate shared client server contracts
- segment host capability facades
- separate workflow and memory ownership
- enforce one-way shell dependencies
- extract capability kernel and architecture ratchets

**Tests**

- lock security coverage for new boundaries
- follow modular onboarding owner
- follow RASMIC storage split

**Docs**

- generate MCP catalog and lock architecture ownership
- reconcile RASMIC with latest agent docs
- publish catalog-first RASMIC runtime
- publish RASMIC MCP contract
- `testing` record 1.12 live verification

**Chores**

- `agent` sync docs and trim internal exports

**Other**

- cover maintainability architecture boundaries
- pin ZAP Docker Hub mirror
- cover RASMIC orchestration

## 2026-09-01

**Added**

- `agent` ship cognitive runtime p1
- `agent` humanize sessions and add yolo mode
- `mcp` ship cognitive runtime p0
- `agent` add interrupt-safe terminal controls
- `agent` add arrow picker and skill states
- `agent` align model and session terminal UX
- `install` make upgrades agent-friendly
- `agent` add interactive slash palette
- `agent` add project-aware slash skills
- `agent` persist terminal and MCP sessions
- `mcp` render live workflow progress in ChatGPT
- `cli` add MSO folder ASCII icon

**Fixed**

- `agent` resolve resumes across full session store
- `mcp` remove session lookup contention
- `agent` wake prompt after child tty sigint
- `cli` clarify version and update labels
- `agent` stabilize terminal banner navigation
- `cli` make updates visible and idempotent
- `9router` proxy over internal Docker network
- `mcp` preserve app-only workflow status schema

## 2026-08-31

**Added**

- `cli` add MSO agent and infrastructure providers
- `mcp` add guided client setup

**Fixed**

- `update` wait through systemd restart drain
- `cli` diagnose HTTPS login and add doctor --fix
- `mcp` validate browser origins
- `security` avoid recovery guard fsync convoy
- `runtime` verify service readiness before handoff
- `jobs` finish retention before releasing runtime
- `runtime` preserve fallback recovery readiness
- `runtime` keep service starts on shared exclusion
- `service` bound lifecycle exclusion wait
- `settings` hide premature update warning
- `update` enforce main and raise MCP daily limit
- `mcp` raise daily token call limit
- `gateway` canonicalize public origin assignment
- `git` restore executable script modes
- `runtime` close service installer and notice races
- `install` hold update lock across checkout refresh
- `install` restore service after pre-mutation abort

**Tests**

- `security` remove recovery marker TOCTOU
- `gateway` assert one live tunnel after concurrent start
- `install` read abort capture by descriptor
- `install` align bootstrap and abort harness
- `install` make abort recovery harness static

**Docs**

- `mcp` mark guided setup shipped

**Chores**

- `deps` bump aquasecurity/trivy-action (#32)
- `deps` bump actions/checkout from 6.1.0 to 7.0.1 (#31)
- `deps-dev` bump @types/react-dom (#29)

## 2026-08-30

**Added**

- `gateway` secure laptop public access lifecycle
- `gateway` add loopback-only public web gateway

**Fixed**

- `runtime` close update authority and stop races
- `runtime` preserve installer and env lifecycles
- `runtime` serialize deploy and service starts
- `gateway` recheck web state under lock
- `update` reject unowned live runtimes
- `runtime` verify live update identities
- `runtime` close final update web edges
- `update` emit success after runtime restore
- `update` serialize all checkout runtimes
- `gateway` reject active named tunnel switches
- `gateway` serialize runtime recovery and updates
- `gateway` close final lifecycle boundaries
- `gateway` close tunnel fork signal race
- `gateway` serialize offline recovery state
- `gateway` harden update and proxy edges
- `gateway` close lifecycle review gaps
- `security` harden gateway scanner fixtures
- `install` survive Bun bin metadata corruption
- `install` keep bootstrap guard shellcheck-clean
- `install` guard earliest bootstrap prefix
- `install` make bootstrap handoff truncation-safe
- `install` make one-line bootstrap atomic
- `install` bind readiness to runtime instance
- `install` preserve caller path semantics
- `install` prove stable-id service takeover
- `install` keep security hint literal
- `install` make WSL CLI setup reliable
- `security` harden GitHub quality controls
- `security` canonicalize writable path containment

**Tests**

- `gateway` treat zombie children as stopped
- `gateway` isolate lifecycle fixtures
- `cli` lock offline update dispatch
- `gateway` harden hosted security fixtures

**Docs**

- `security` disclose scorecard posture gaps

## 2026-08-29

**Fixed**

- `security` keep path sinks in validated branches
- `security` make root containment explicit
- `security` close follow-up CodeQL flows

**Docs**

- `comparison` use explicit SEO-friendly ratings

**Chores**

- `deps` hold incompatible toolchain majors
- `deps` migrate to lucide-react 1.33.0
