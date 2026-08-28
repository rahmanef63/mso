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
machine-verifiable facts. The repository quality gate runs it automatically.

## Current reference

| Document | Contract |
|---|---|
| [`../README.md`](../README.md) | Product overview and quickstart |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Current runtime, shell, host, MCP and deployment architecture |
| [`INSTALL.md`](./INSTALL.md) | Owner installation, TLS, updates, backup and uninstall |
| [`DEVELOPMENT.md`](./DEVELOPMENT.md) | Development and release workflow |
| [`SECURITY-ASSURANCE.md`](./SECURITY-ASSURANCE.md) | Repeatable security verification lanes, public evidence, and claim boundaries |
| [`CLI.md`](./CLI.md) | Generated `mso` CLI contract |
| [`MCP.md`](./MCP.md) | MCP/OAuth internals and full external-tool security model |
| [`MCP-FEATURE-IMPLEMENTATION.md`](./MCP-FEATURE-IMPLEMENTATION.md) | Stepwise reverse-engineering workflow for MCP tools, trusted skills and project capabilities |
| [`CHATGPT-PLUGIN.md`](./CHATGPT-PLUGIN.md) | ChatGPT custom MCP app setup, diagrams, scopes and file bridge |
| [`CONNECTORS-GATEWAY-INTEGRATION.md`](./CONNECTORS-GATEWAY-INTEGRATION.md) | MSO ↔ connectors-gateway action-name contract |
| [`MANAGED-APPS.md`](./MANAGED-APPS.md) | Hermes/OpenClaw/9Router lifecycle, jobs, backup/restore and dashboard access boundary |
| [`HERMES-INTEGRATION.md`](./HERMES-INTEGRATION.md) | Hermes-specific integration behaviour |
| [`OPENCLAW-INTEGRATION.md`](./OPENCLAW-INTEGRATION.md) | OpenClaw-specific integration behaviour |
| [`9ROUTER-INTEGRATION.md`](./9ROUTER-INTEGRATION.md) | 9Router Docker/CLI ownership, domain-first embedded UI and public-IP fallback |
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
| [`PROGRESS.md`](./PROGRESS.md) | Hand-written shipping rationale; newest first; canonical historical WHY |

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
