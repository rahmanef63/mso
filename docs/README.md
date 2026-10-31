# MSO documentation map

This index separates **current reference** from **historical evidence** so a dated plan
cannot quietly become today's architecture documentation.

## Authority order

1. Current code and live descriptors (`/api/health`, `GET /mcp`).
2. Generated contracts (`CLI.md`, `CHANGELOG.md`).
3. Current reference docs below.
4. `PROGRESS.md` for why/when a change shipped.
5. Historical plans/audits for their dated context only.

Run `node scripts/check-docs.mjs` to validate relative links plus selected
machine-verifiable facts, and `node scripts/gen-comparison.mjs --check` to validate comparison
evidence and review freshness. The repository quality gate runs both automatically.

## Current reference

| Document | Contract |
|---|---|
| [`../README.md`](../README.md) | Product overview and quickstart |
| [`QUICKSTART.md`](./QUICKSTART.md) | Canonical first-10-minutes tutorial: install → doctor → provider → project → safe first agent action → evidence |
| [`LAUNCH-READINESS.md`](./LAUNCH-READINESS.md) | 20 measurable product/launch gates, P0/P1 policy and truthful launch-label contract |
| [`LAUNCH-QA.md`](./LAUNCH-QA.md) | Concise launch answers for category, competitors, agent concepts, security, memory, recovery and readiness |
| [`SOURCE-CONCURRENCY.md`](./SOURCE-CONCURRENCY.md) | One-task-one-worktree, canonical integration authority, remote protection and concurrency acceptance tests |
| [`AGENT-SECURITY.md`](./AGENT-SECURITY.md) | Agent-specific threat model, tool risk classes, abuse cases and memory-admission security contract |
| [`DISASTER-RECOVERY.md`](./DISASTER-RECOVERY.md) | 3-2-1 target, RPO/RTO objectives, backup classes and restore-drill acceptance |
| [`RELIABILITY.md`](./RELIABILITY.md) | Initial SLIs/SLO targets, error-budget policy, disk thresholds and release reliability contract |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Current runtime, shell, role, host, Agent/Local Agent/subagent, MCP and deployment architecture |
| [`GATEWAY.md`](./GATEWAY.md) | Provider-neutral gateway state, health, ownership, supervisor and deployment contract |
| [`COGNITIVE-RUNTIME.md`](./COGNITIVE-RUNTIME.md) | Provider-neutral MCP/session/context/tool-routing runtime and benchmark contract |
| [`AGENT-BOOTSTRAP.md`](./AGENT-BOOTSTRAP.md) | Canonical first-call sequence and capability-parity matrix across CLI, MCP, and Alfa |
| [`AGENT-CODING-PLAN.md`](./AGENT-CODING-PLAN.md) | Audited coding-capability gaps in the MCP catalog, the four tools added to close them, and what stays out of scope |
| [`AGENT-PTY-DESIGN.md`](./AGENT-PTY-DESIGN.md) | Why an agent-driven PTY is the highest-blast-radius tool in the catalog, and the bounds that keep it equal to exec_run |
| [`AGENT-EDIT-PREVIEW.md`](./AGENT-EDIT-PREVIEW.md) | Why fs_edit returns the diff it applied, what a dry run promises, and how the TUI renders it |
| [`RASMIC.md`](./RASMIC.md) | Risk-aware orchestration, repo-local memory/evidence, collision detection and recipe/script promotion |
| [`MEMORY-GRAPH.md`](./MEMORY-GRAPH.md) | Owner Memory app: vault notes, project knowledge, agent memory, layouts and limits |
| [`AGENT-VAULT.md`](./AGENT-VAULT.md) | Separate private repository agent-progress vaults, source/data boundaries and Obsidian use |
| [`MEMORY-SAFETY.md`](./MEMORY-SAFETY.md) | Session-source preservation, owner cleanup previews, local memory backups, learning/discovery visibility and remaining limits |
| [`COMPARISON.md`](./COMPARISON.md) | Generated product comparison methodology, evidence and notes |
| [`references/README.md`](./references/README.md) | One file per upstream project MSO studies or pins: license, pin, what was used and what was not copied |
| [`LICENSE-HISTORY.md`](./LICENSE-HISTORY.md) | Current PolyForm Noncommercial license, the permanent prior MIT grant, and open contribution questions |
| [`COMPETITIVE-ROADMAP.md`](./COMPETITIVE-ROADMAP.md) | Executed comparison plan, deliberate specialist boundaries and next investments |
| [`INSTALL.md`](./INSTALL.md) | Owner installation, TLS, updates, backup and uninstall |
| [`PLATFORMS.md`](./PLATFORMS.md) | Linux/macOS/Windows/Android/iOS support modes and machine adapters |
| [`TERMUX.md`](./TERMUX.md) | Android/Termux bootstrap through Ubuntu PRoot, repair path and verification |
| [`INFRASTRUCTURE-PROVIDERS.md`](./INFRASTRUCTURE-PROVIDERS.md) | Interactive MSO Agent TUI/approval/error contract plus Dokploy/Cloudflare/Hostinger/Composio credentials, tools and deployment boundary |
| [`DEVELOPMENT.md`](./DEVELOPMENT.md) | Development and release workflow |
| [`SECURITY-ASSURANCE.md`](./SECURITY-ASSURANCE.md) | Repeatable security verification lanes, public evidence, and claim boundaries |
| [`CLI.md`](./CLI.md) | Generated `mso` CLI contract |
| [`INTEGRATION-PORTABILITY.md`](./INTEGRATION-PORTABILITY.md) | Reviewed JSON identity transfers, encrypted credentials, SC interoperability and receiver limits |
| [`INTEGRATIONS.md`](./INTEGRATIONS.md) | Native temporary credential forms, direct HTTPS secret submission, CLI and ChatGPT Page |
| [`INTEGRATIONS-NATIVE-GOOGLE.md`](./INTEGRATIONS-NATIVE-GOOGLE.md) | Native Google OAuth app/account separation, Search Console and GA4 reads, browser binding, scope and parity limits |
| [`CHANNELS.md`](./CHANNELS.md) | Provider-neutral Telegram/Discord messaging, inbound verification, outbound send and Workflow bridge |
| [`PROJECT-MCP-CONNECTIONS.md`](./PROJECT-MCP-CONNECTIONS.md) | Named private connections, endpoint binding and identity for modular project MCPs |
| [`BATONLY-FEDERATION.md`](./BATONLY-FEDERATION.md) | Pull-based Batonly capability federation worker, MSO/SI-Coder execution boundary, polling, security and acceptance contract |
| [`AUTOMATION-FLOWS.md`](./AUTOMATION-FLOWS.md) | Versioned project API/MCP flows, CLI, sessions, Add MCP, assets and limits |
| [`WORKFLOW-SCHEDULES.md`](./WORKFLOW-SCHEDULES.md) | Interval, cron and durable one-shot scheduling semantics, missed ticks and recovery limits |
| [`WORKFLOW-GRAPH.md`](./WORKFLOW-GRAPH.md) | Private server-native Workflow Graph v2 with n8n-core triggers/flow control, versions/history, variables, integrations, visual execution and automatic learning |
| [`SHARED-GRAPH-FOUNDATION.md`](./SHARED-GRAPH-FOUNDATION.md) | Canonical shared graph mechanics, feature adapters, ownership matrix and dense-graph Focus/Map interaction boundary |
| [`NAKAMA-PARITY.md`](./NAKAMA-PARITY.md) | Frozen Nakama scope, current implementation mappings and candidate evidence limits |
| [`N8N-PARITY.md`](./N8N-PARITY.md) | Core n8n capability map across native Workflows, Organization, Integrations and the dedicated external n8n workspace |
| [`TUI-PARITY-PLAN.md`](./TUI-PARITY-PLAN.md) | MSO Agent TUI parity program: per-item status, the server seam each item uses, and the items deliberately refused |
| [`TUI-RENDERER-PLAN.md`](./TUI-RENDERER-PLAN.md) | What the TUI is today, why a retained renderer is the only path to panels and tabs, and the M0 to M8 order that keeps every gate green |
| [`TUI-HANDOVER.md`](./TUI-HANDOVER.md) | Where the TUI panel track stands, the state of the one in-progress branch, and what must be true before the alternate screen becomes the default |
| [`ORGANIZATION.md`](./ORGANIZATION.md) | Owner-private organization units, seats, reporting lines, live agent bindings, and workflow routing references |
| [`MCP-HOW-TO.md`](./MCP-HOW-TO.md) | Bahasa Indonesia onboarding: client connection, prompts, workflow, project MCP and troubleshooting |
| [`MCP.md`](./MCP.md) | MCP/OAuth internals and full external-tool security model |
| [`A2A.md`](./A2A.md) | A2A v1 peer discovery, delegation/task lifecycle, CLI/MCP surface and trust boundary |
| [`LOCAL-AGENTS.md`](./LOCAL-AGENTS.md) | Native same-host session presence, identity, mailbox delivery, TUI/tools/API and isolation |
| [`SUBAGENTS.md`](./SUBAGENTS.md) | Same-session foreground isolated worker lifecycle, context, tool authority and limits |
| [`AGENT-PROFILES.md`](./AGENT-PROFILES.md) | Saved Owner profiles, exact model binding, revision history and bounded read tasks |
| [`MCP-FEATURE-IMPLEMENTATION.md`](./MCP-FEATURE-IMPLEMENTATION.md) | Stepwise reverse-engineering workflow for MCP tools, trusted skills and project capabilities |
| [`CHATGPT-PLUGIN.md`](./CHATGPT-PLUGIN.md) | ChatGPT custom MCP app setup, diagrams, scopes and file bridge |
| [`PLUGIN-REFERENCE-MATRIX.md`](./PLUGIN-REFERENCE-MATRIX.md) | Living cross-plugin architecture matrix, audit decisions and candidate generic primitives |
| [`CONNECTED-APPS.md`](./CONNECTED-APPS.md) | Server-persisted external app connections, dynamic shell windows and lifecycle boundaries |
| [`MANAGED-APPS.md`](./MANAGED-APPS.md) | Hermes/OpenClaw/9Router lifecycle, jobs, backup/restore and dashboard access boundary |
| [`MANAGED-DOMAINS.md`](./MANAGED-DOMAINS.md) | Automatic app DNS/tunnel routes, named Integrations, HTTPS verification and durable setup recovery |
| [`HERMES-INTEGRATION.md`](./HERMES-INTEGRATION.md) | Hermes-specific integration behaviour |
| [`OPENCLAW-INTEGRATION.md`](./OPENCLAW-INTEGRATION.md) | OpenClaw-specific integration behaviour |
| [`9ROUTER-INTEGRATION.md`](./9ROUTER-INTEGRATION.md) | 9Router immutable Docker ownership, loopback default and explicit dashboard exposure |
| [`ORCA-INTEGRATION.md`](./ORCA-INTEGRATION.md) | Orca web bridge readiness/identity contract, private state root and shared-runtime operator limits |
| [`MODELS-INTEGRATION.md`](./MODELS-INTEGRATION.md) | Alfa BYOK/custom/Codex provider model |
| [`SLICE-CATALOG.md`](./SLICE-CATALOG.md) | Current slice/AppShell feature inventory |
| [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) | Symptom → cause → supported recovery |
| [`FAQ.md`](./FAQ.md) | Product/security/operator boundaries |
| [`../SECURITY.md`](../SECURITY.md) | Security posture and vulnerability reporting |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Contributor setup and gates |
| [`../CLAUDE.md`](../CLAUDE.md) | Repository/operator implementation rules |
| [`../skills/README.md`](../skills/README.md) | Skill catalog, trust and discovery semantics |

## Design contracts awaiting implementation

| Document | Status |
|---|---|
| [`EXTERNAL-FEATURE-CONTRACT.md`](./EXTERNAL-FEATURE-CONTRACT.md) | v1 target contract for modular shell/external features; implementation status is explicit |
| [`TENANT-PREVIEW.md`](./TENANT-PREVIEW.md) | Disabled identity and scoped-memory runtime; live activation and full production isolation remain unimplemented |
| [`TENANT-PERSISTENCE.md`](./TENANT-PERSISTENCE.md) | Source-only durable registry, scoped memory and audit; transactions, recovery limits and operational gates |
| [`TENANT-ROLLOUT.md`](./TENANT-ROLLOUT.md) | Finite engineering, operational approval and acceptance gates for shared-gateway multiuser deployment |
| [`NATIVE-HOST-RELAY.md`](./NATIVE-HOST-RELAY.md) | Requested native macOS/Windows hosts and shared no-domain MCP relay; implementation and verification gates remain explicit |

## Generated/current records

| Document | Source |
|---|---|
| [`CLI.md`](./CLI.md) | `node scripts/gen-cli-docs.mjs` / `bin/mso --help` |
| [`CHANGELOG.md`](./CHANGELOG.md) | Git subjects via `scripts/gen-changelog.mjs`; never hand-edit |
| [`COMPARISON.md`](./COMPARISON.md) | `docs/comparison-data.json` via `scripts/gen-comparison.mjs`; never hand-edit |
| [`PROGRESS.md`](./PROGRESS.md) | Hand-written shipping rationale; newest first; canonical historical WHY |
| [`TESTING-HANDOFF.md`](./TESTING-HANDOFF.md) | Factual manual/automated test handoff; observed issues and resolved/remaining verification, never architecture authority |

## Historical point-in-time documents

These are retained because they contain design reasoning or finding numbers referenced by
source comments. They are **not current implementation contracts**.

| Document | Status |
|---|---|
| [`EXTERNAL-FEATURE-AUDIT-2026-09-27.md`](./EXTERNAL-FEATURE-AUDIT-2026-09-27.md) | Registry/manifest/embed source audit at 330d0cb4; migration phases remain pending |
| [`9ROUTER-MSO-APPHOST-RFC.md`](./9ROUTER-MSO-APPHOST-RFC.md) | Historical app-host proposal; current setup/authentication contract is in MANAGED-DOMAINS and MANAGED-APPS |
| [`AUDIT-2026-08-24.md`](./AUDIT-2026-08-24.md) | Fable/Ultracode + dynamic security audit at its named commit; includes reproduced findings and release remediation |
| [`AUDIT-2026-06-11.md`](./AUDIT-2026-06-11.md) | Archived audit at its named date; later fixes changed many findings |
| [`R10-GLASS-AUDIT.md`](./R10-GLASS-AUDIT.md) | Point-in-time antislop R-10 glass dose audit; current rule compliance lives in the code |
| [`SHELL-FIDELITY-PLAN.md`](./SHELL-FIDELITY-PLAN.md) | Historical design backlog/baseline; current shell design lives in code + architecture |
| [`DRAWER-MENU-BYOK-PLAN.md`](./DRAWER-MENU-BYOK-PLAN.md) | Historical implementation plan; phases A–C and OpenAI Codex D1 shipped; remaining ideas are not promises |
| [`OS-SETTINGS-ICON-UPDATE-DEVICE-PLAN.md`](./OS-SETTINGS-ICON-UPDATE-DEVICE-PLAN.md) | **Open plan, not implemented**: auto-update opt-in, stable channel, Devices/Server merge, account icon picker, upload→WebP/ICO pipeline |
| [`HANDOVER.md`](./HANDOVER.md) | **Start here for a new session**: current repo state, what shipped, what was cancelled and why, the numbers that decide things, and the traps that cost time |
| [`MSO-MIGRATION.md`](./MSO-MIGRATION.md) | Phased Next→Svelte/Bun/Rust plan with its phase table: 0/1/2 shipped, 3/4 cancelled by measurement, 6 no-go, 5 not started. Authoritative over BENCH-AFTER.md |
| [`BENCH-BEFORE.md`](./BENCH-BEFORE.md) | **Measured baseline, 2026-10-29**: bundle, LCP/TBT, hydration chain, per-app open cost and code surface, captured on an idle host as the "before" side of the Phase 4/5 comparison |
| [`BENCH-AFTER.md`](./BENCH-AFTER.md) | **Measured comparison, 2026-10-30**: the same eight measures two days later, side by side, including the deltas that are zero and the ones inside the noise band |
| [`MIGRATION-GATE-PLAN.md`](./MIGRATION-GATE-PLAN.md) | Executed migration-gate work: which §3 items landed with measurements, which were blocked and why, and the `lib/` framework-import debt |

## Marketing/demo collateral

These files are copy/script drafts, not technical authority:

- [`PRODUCT_HUNT.md`](./PRODUCT_HUNT.md)
- [`DEMO-SCRIPT.md`](./DEMO-SCRIPT.md)

When a current-reference doc and one of these drafts disagree, update the draft or follow
the current-reference doc.

## Reset and removal

[Maintenance, factory reset and clean uninstall](./MAINTENANCE.md) · [Extended workspace reference](./reference/WORKSPACE-GUIDE.md)

- [Session screenshots and temporary artifacts](./SESSION-ARTIFACTS.md) — private per-session paths, MCP/CLI reads, quotas and safe retention.

## Independent CI pilot

[SELF-HOSTED-CI.md](./SELF-HOSTED-CI.md) is the current manual-runner reference and Actions migration gap matrix. It does not claim completed security parity or deployment automation.
