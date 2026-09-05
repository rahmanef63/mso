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
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Current runtime, shell, role, host, Agent/Local Agent/subagent, MCP and deployment architecture |
| [`COGNITIVE-RUNTIME.md`](./COGNITIVE-RUNTIME.md) | Provider-neutral MCP/session/context/tool-routing runtime and benchmark contract |
| [`RASMIC.md`](./RASMIC.md) | Risk-aware orchestration, repo-local memory/evidence, collision detection and recipe/script promotion |
| [`COMPARISON.md`](./COMPARISON.md) | Generated product comparison methodology, evidence and notes |
| [`COMPETITIVE-ROADMAP.md`](./COMPETITIVE-ROADMAP.md) | Executed comparison plan, deliberate specialist boundaries and next investments |
| [`INSTALL.md`](./INSTALL.md) | Owner installation, TLS, updates, backup and uninstall |
| [`INFRASTRUCTURE-PROVIDERS.md`](./INFRASTRUCTURE-PROVIDERS.md) | Interactive MSO Agent TUI/approval/error contract plus Dokploy/Cloudflare/Hostinger/Composio credentials, tools and deployment boundary |
| [`DEVELOPMENT.md`](./DEVELOPMENT.md) | Development and release workflow |
| [`SECURITY-ASSURANCE.md`](./SECURITY-ASSURANCE.md) | Repeatable security verification lanes, public evidence, and claim boundaries |
| [`CLI.md`](./CLI.md) | Generated `mso` CLI contract |
| [`INTEGRATIONS.md`](./INTEGRATIONS.md) | Native temporary credential forms, direct HTTPS secret submission, CLI and ChatGPT Page |
| [`MCP.md`](./MCP.md) | MCP/OAuth internals and full external-tool security model |
| [`A2A.md`](./A2A.md) | A2A v1 peer discovery, delegation/task lifecycle, CLI/MCP surface and trust boundary |
| [`LOCAL-AGENTS.md`](./LOCAL-AGENTS.md) | Native same-host session presence, identity, mailbox delivery, TUI/tools/API and isolation |
| [`SUBAGENTS.md`](./SUBAGENTS.md) | Same-session foreground isolated worker lifecycle, context, tool authority and limits |
| [`MCP-FEATURE-IMPLEMENTATION.md`](./MCP-FEATURE-IMPLEMENTATION.md) | Stepwise reverse-engineering workflow for MCP tools, trusted skills and project capabilities |
| [`CHATGPT-PLUGIN.md`](./CHATGPT-PLUGIN.md) | ChatGPT custom MCP app setup, diagrams, scopes and file bridge |
| [`MANAGED-APPS.md`](./MANAGED-APPS.md) | Hermes/OpenClaw/9Router lifecycle, jobs, backup/restore and dashboard access boundary |
| [`HERMES-INTEGRATION.md`](./HERMES-INTEGRATION.md) | Hermes-specific integration behaviour |
| [`OPENCLAW-INTEGRATION.md`](./OPENCLAW-INTEGRATION.md) | OpenClaw-specific integration behaviour |
| [`9ROUTER-INTEGRATION.md`](./9ROUTER-INTEGRATION.md) | 9Router immutable Docker ownership, loopback default and explicit dashboard exposure |
| [`MODELS-INTEGRATION.md`](./MODELS-INTEGRATION.md) | Alfa BYOK/custom/Codex provider model |
| [`SLICE-CATALOG.md`](./SLICE-CATALOG.md) | Current slice/AppShell feature inventory |
| [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) | Symptom → cause → supported recovery |
| [`FAQ.md`](./FAQ.md) | Product/security/operator boundaries |
| [`../SECURITY.md`](../SECURITY.md) | Security posture and vulnerability reporting |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Contributor setup and gates |
| [`../CLAUDE.md`](../CLAUDE.md) | Repository/operator implementation rules |
| [`../skills/README.md`](../skills/README.md) | Skill catalog, trust and discovery semantics |

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
| [`AUDIT-2026-08-24.md`](./AUDIT-2026-08-24.md) | Fable/Ultracode + dynamic security audit at its named commit; includes reproduced findings and release remediation |
| [`AUDIT-2026-06-11.md`](./AUDIT-2026-06-11.md) | Archived audit at its named date; later fixes changed many findings |
| [`SHELL-FIDELITY-PLAN.md`](./SHELL-FIDELITY-PLAN.md) | Historical design backlog/baseline; current shell design lives in code + architecture |
| [`DRAWER-MENU-BYOK-PLAN.md`](./DRAWER-MENU-BYOK-PLAN.md) | Historical implementation plan; phases A–C and OpenAI Codex D1 shipped; remaining ideas are not promises |

## Marketing/demo collateral

These files are copy/script drafts, not technical authority:

- [`PRODUCT_HUNT.md`](./PRODUCT_HUNT.md)
- [`DEMO-SCRIPT.md`](./DEMO-SCRIPT.md)

When a current-reference doc and one of these drafts disagree, update the draft or follow
the current-reference doc.

## Reset and removal

[Maintenance, factory reset and clean uninstall](./MAINTENANCE.md) · [Extended workspace reference](./reference/WORKSPACE-GUIDE.md)
