# External feature registry audit — 2026-09-27

> **Historical source audit.** Baseline: `330d0cb45539088e0cd9add712c408c38ef91181`.
> This review examines source boundaries; it does not reproduce a browser exploit or
> certify every third-party deployment. Target rules: [contract v1](./EXTERNAL-FEATURE-CONTRACT.md).
> Deliverable: architecture contract and migration backlog, not an implemented plugin engine.

## Inventory and findings

| ID / priority | Evidence at baseline | Finding and required change |
|---|---|---|
| A01 / P1 | [ShellManifest and FeatureDescriptor](../frontend/slices/appshell/registry/types.ts), [AppDescriptor](../frontend/slices/appshell/lib/types.ts) | Good dependency injection seam, but descriptors contain React components/functions and no schema version. Keep executable descriptors internal; add a validated serializable definition plus resolver. |
| A02 / P1 | [App registry](../frontend/slices/appshell/lib/registry.tsx), [composition](../app/os-root.tsx) | Built-ins and dynamic apps concatenate; Map registration uses last ID wins. Reject collisions in the assembled snapshot, including slugs and aliases. This is a collision risk at the assembly boundary; upstream creation constraints were not exhaustively audited. |
| A03 / P1 | [Shell registry](../frontend/slices/appshell/registry/shells.tsx), [registration](../frontend/slices/appshell/registry/register-shells.tsx) | registerShell is extensible in shape, but ShellId, display order and desktop/mobile preference allowlists are fixed. Derive enumeration and preference validation from reviewed descriptors before advertising dynamic shells. |
| A04 / P1 | [Feature slots](../frontend/slices/appshell/registry/feature-registry.tsx), [provider composition](../frontend/slices/appshell/provider/app-shell.tsx) | Slots render in manifest order; no slot cardinality/dependency validation here. Feature providers wrap the entire desktop. Live provider changes can remount descendants; define reload/cleanup and local failure boundaries before dynamic activation. |
| A05 / P0 before external catalogs | [Runtime manifest](../frontend/slices/app-store/components/runtime-app-types.ts), [renderer](../frontend/slices/app-store/components/runtime-app.tsx), [console](../frontend/slices/app-store/components/app-console.tsx) | One string entry means URL or host command. Execution requires Run and the existing exec API; this is not evidence of unauthenticated execution. Imported feature definitions must instead reference reviewed adapters/actions. Preserve explicit owner custom scripts as a separate advanced capability. |
| A06 / P0 before external catalogs | [Runtime HTML renderer](../frontend/slices/app-store/components/runtime-app.tsx), [n8n admission](../lib/host/workflow-embeds-api.ts), [cookie policy](../lib/surfaces/cookie-policy.ts) | Runtime HTML accepts HTTP(S) entry directly with scripts + same-origin sandbox and does not call the reviewed cookie/origin policy. n8n has a separate stricter path. Unify admission for external frames; test actual CSP, cookies and redirects before calling this exploitable. |
| A07 / P1 | [Surface contract](../lib/contracts/surface-app.ts), [config](../lib/surfaces/config.ts), [owner mutation](../lib/surfaces/manage.ts) | Already dynamic per request, bounded and owner-revision-guarded on save. Yet unversioned; placements limited to workflows/n8n/mcp-page, HTTPS-only; parse drops invalid rows. Add version migration and diagnostics without weakening Page approval. |
| A08 / P1 | [Managed types](../lib/managed-apps/types.ts), [catalog](../lib/managed-apps/catalog.ts), [host support](../lib/managed-apps/host-compatibility.ts) | Three static IDs, declared Docker/systemd backends and live preflight are useful foundations. Host needs, adapter versions, bindings and contribution references are not a generic manifest yet. Preserve reviewed installers while extracting metadata. |
| A09 / P1 | [Managed origin](../lib/managed-apps/origin.ts), [external panel](../frontend/slices/managed-apps/feature-app.tsx) | Managed frames already use a separate app namespace and refuse same-origin fallback. Origin template uses NEXT_PUBLIC configuration, unlike the runtime SurfaceApp registry. Dynamic routing/CSP must be added server-side before promising no-rebuild managed origins. |
| A10 / P2 | [Installed app resolver](../frontend/slices/app-store/lib/use-installed-apps.ts) | Descriptor memo signature omits source although the resolved manifest reads it. Future revision-based snapshots avoid stale metadata; preserve stable component identity to prevent remount churn. |
| A11 / P1 | [Project Plugin manifest](../lib/plugins/manifest.ts), [extension taxonomy](./ARCHITECTURE.md) | Existing strict versioned plugin validator is a useful pattern, but that package owns project skills/MCP, not shell/runtime authority. Do not overload it with install commands or embed grants. |
| A12 / P1 | [n8n panel](../frontend/slices/n8n/components/n8n-embed-panel.tsx), [Managed jobs](../lib/managed-apps/types.ts) | Frame loading and service/job readiness are different observations. Use common readiness reasons and receipts; iframe onLoad alone cannot prove editor login or health. |

P0 here means a prerequisite for accepting externally supplied catalogs, not a verified
critical vulnerability in the deployed installation. Existing safeguards must remain in place.

## Decisions

1. Use one portable feature definition identity with separate server-owned binding/grant/state.
   Generate presentation projections from it; do not merge credentials, MCP authority,
   shell preferences and service ownership into a single writable registry.
2. Support external products as apps, views inside other apps, API-only integrations,
   or managed runtimes. Those contributions can coexist without forcing every product
   to implement every lifecycle operation.
3. Keep AppShell generic. Consumer adapters supply MSO policy through existing seams.
4. Runtime JSON may configure reviewed implementations; it cannot load arbitrary JS,
   create shell providers or introduce a new privileged installer.
5. Domain is optional. Hosting on a capable tablet is distinct from using a mobile shell.
   Origin isolation and backend capability still determine which contributions can run.
6. Preserve existing feature IDs, routes, saved layouts and connection identities during migration.
7. Do not claim Orca/Termul adapters until their exact upstream identities are established.

## Ordered implementation plan

| Phase | Work and ownership | Exit evidence |
|---|---|---|
| 0 — Contract (this change) | Document envelope, authority, embedded-view and shell contracts; classify source gaps | Linked contract and audit; documentation/architecture checks pass |
| 1 — Admission | lib/contracts owns wire DTO/schema; lib/surfaces owns reviewed frame admission; add collision/reason diagnostics | Negative schema/collision/cookie/origin tests; legacy apps keep working; no imported command execution |
| 2 — Registry snapshots | Consumer resolver produces AppDescriptor/FeatureDescriptor; server stores revisioned bindings/grants; reviewed shell metadata drives enumeration | Multiple bindings, atomic activation, missing dependency/cycle refusal; migration keeps routes/layout; failed activation retains previous snapshot |
| 3 — External views | n8n and Managed App presentation consume the shared resolved-view contract; retain separate proxy versus direct-frame trust paths | Mobile/desktop login and direct-open tests; CSP/cookie/redirect rejection; disabled/revoked view stops bridge access |
| 4 — Lifecycle adapters | Move Hermes/OpenClaw/9Router metadata behind reviewed adapter descriptors; Integrations references replace portable secrets | Backend preflight, per-binding ownership/idempotency, interrupted job reconciliation, backup/restore and uninstall-preserves-data tests |
| 5 — Shell features | Slots gain cardinality/order/surface/dependency rules; add local failure containment and controlled provider reload | Shell switching, focus/keyboard/touch, disable/re-enable and recovery tests; one broken feature does not blank shell |
| 6 — Catalog expansion | Add reviewed n8n lifecycle and other identified upstream adapters, then host/device portability trials | Real install/update/restart/restore on each claimed host/backend; independently report unsupported combinations |

Do not gate phase 1 on a full marketplace or multi-host scheduler. First migrate existing
definitions and consumers. Multi-host placement can later reuse hostRef and capability
requirements without introducing a second registry.

## Migration and rollback procedure

- Export the old configuration/layout version and preserve server registry bytes before conversion.
- Give built-in definitions stable IDs; namespace new imported IDs and detect slug aliases.
- Convert SurfaceApp entries into endpoint bindings plus their existing approved placements.
  Legacy missing placements retain only their current reviewed Page semantics; do not broaden access.
- Convert local App Store HTML entries into unapproved presentation candidates; require endpoint
  review before granting a trusted frame. Keep custom commands in the explicit owner-script path.
- Preserve managed runtime ownership; detection of a service does not adopt it.
- Stage a full converted snapshot, validate, then atomically change the active revision.
  Failed conversion keeps the prior runtime available and returns per-entry diagnostics.
- Roll back configuration using the preserved snapshot/revision. Runtime/data migration rollback
  remains adapter-specific and must be verified independently.
- Remove old tables only after consumers and parity tests use the canonical projection.

## Required implementation artifacts

Future implementation PRs must include: the versioned schema and validator, reviewed adapter
registry, definition/binding resolver, migration fixtures, permission/embedding negative tests,
operational receipts, compatibility diagnostics and UI/API/CLI/MCP parity notes where applicable.
The contract's JSON example is intentionally illustrative; no runtime accepts that format yet.
