# External feature contract v1

> **Design contract, 2026-09-27.** Normative requirements for new modular feature work.
> This document does not claim a v1 loader or schema validator is implemented.
> Current implementation and gaps: [registry audit](./EXTERNAL-FEATURE-AUDIT-2026-09-27.md).
> Existing authority: [architecture](./ARCHITECTURE.md), [Managed Apps](./MANAGED-APPS.md),
> [Integrations](./INTEGRATIONS.md), [platforms](./PLATFORMS.md).

## 1. Terms and authority

An external product may contribute several features. Installing a feature in the workspace does not mean installing that product's runtime on the machine.

| Object | Owns | Never grants |
|---|---|---|
| FeatureDefinition | Portable identity, presentation, requirements and adapter references | Credentials, host execution or origin trust |
| FeatureBinding | Exact installation/project/host, selected connection and endpoint references | Permission to adopt an existing service |
| FeatureGrant | Owner-reviewed origin, action, placement and permission policy | Arbitrary executable code |
| FeatureState | Desired enablement, observed readiness, job and health evidence | Authority inferred from browser storage |
| Reviewed adapter | Bundled executable implementation and typed inputs | Permission beyond the caller's live policy |

Keep these records separate. A canonical definition resolves into AppDescriptor, FeatureDescriptor and managed-runtime views; it must not replace their security authorities. Project Plugin, Skill, Integration and MCP retain their existing meanings.

## 2. Portable definition envelope

Proposed wire format: JSON, schema identifier `urn:mso:feature:v1`. Reject unknown schema majors, unknown keys and malformed fields before any side effect. v1 maximums: 64 KiB per definition, 128 contributions, 32 dependencies, 128 action references. Identifiers use lowercase letters, digits and hyphens, at most 64 characters. Existing built-in IDs/slugs remain stable through explicit migration aliases.

| Required field | Contract |
|---|---|
| schemaVersion | Integer `1`; independent from product and adapter versions |
| id | Globally unique feature ID within the installation; duplicate registration is an error |
| version | Semantic version of the definition; prerelease/build suffixes supported |
| metadata | Plain-text title, description, publisher, optional reviewed homepage; no raw HTML |
| compatibility | Supported MSO and adapter API version ranges; unknown/incompatible fails closed |
| dependencies | Required/optional feature IDs with version ranges; cycles and missing required dependencies fail |
| contributions | Discriminated list described below; each has a unique local ID |
| actions | References to registered typed capabilities; empty is valid |
| requirements | Required/optional host and client capabilities with explicit constraints |

Executable adapters, component loaders, icon keys, action IDs and slots are resolved from reviewed code registries. No import URL, JavaScript source, shell command, environment variables, credential values or arbitrary filesystem path belongs here. Publisher text and a digest alone do not establish trust; activation requires a reviewed local definition or verified package provenance under an explicit installation policy.

### Contribution variants

| kind | Required payload | Runtime rules |
|---|---|---|
| app | slug, title, iconKey, renderer | Opens an AppShell window; renderer is native, external-frame, external-tab or api-only |
| shell-feature | slots, componentKey, optional providerKey | Trusted bundled code only; provider topology is fixed for the current shell session |
| shell | surface, componentKey, supportedSlots, windowed | Trusted bundled chrome; reuses window store, routing and accessibility services |
| managed-runtime | adapterKey, backend alternatives, lifecycle action refs | Server adapter controls installation; host requirements checked live |
| embedded-view | targetFeatureId, placement, renderer | Adds an external view inside an existing feature, e.g. n8n inside Workflows |

Each renderer is a tagged object. `native` requires componentKey; `external-frame` and `external-tab` require endpointRef; `api-only` has no window component. No implicit fallback from missing native code to executing a URL or command. Frames declare a sandboxProfileKey and fallback policy. A target feature explicitly accepts an embedded-view placement; a definition cannot invent new shell slots or attach to privileged chrome.

### Illustrative external n8n definition

This is a target-format example, not input for today's SurfaceApp registry. The named renderer/profile implementations must be reviewed before activation.

```json
{
  "schemaVersion": 1,
  "id": "n8n-editor",
  "version": "1.0.0",
  "metadata": {
    "title": "n8n editor",
    "description": "Open a connected n8n editor",
    "publisher": "installation-owner"
  },
  "compatibility": { "mso": ">=0.2.23 <1.0.0", "adapterApi": "^1.0.0" },
  "dependencies": [],
  "contributions": [{
    "id": "editor",
    "kind": "embedded-view",
    "targetFeatureId": "workflows",
    "placement": "editor",
    "renderer": {
      "kind": "external-frame",
      "endpointRef": "editor",
      "sandboxProfileKey": "external-editor-v1",
      "fallback": "external-tab"
    }
  }],
  "actions": [],
  "requirements": { "host": [], "client": ["browser.iframe"] }
}
```

## 3. Binding and installation state

A FeatureBinding has bindingId, featureId, definitionVersion, revision, scope (host or exact project), hostRef, ownership (managed or connected), endpoint references and explicit connection references (credential owner → provider → named connection). Endpoints are installation state, never maintainer domains baked into portable source. Support multiple bindings of one definition without ID, storage or port collisions. The example above uses connected ownership and needs no lifecycle adapter.

A browser receives only a sanitized resolved view. Server persistence is owner-local, atomic, revision-guarded and redacted. Browser storage contains layout/preferences only. Changing an origin, credential owner, adapter or permission invalidates the old approval. Removing a connection revokes dependent action readiness; do not silently select another.

State axes are independent: installed definition, enabled presentation, owned runtime, runtime health, endpoint reachability and authorization. Use explicit reason codes such as unsupported_host, missing_connection, origin_blocked, dependency_missing, version_incompatible and runtime_unhealthy. A hidden app may still have a running service.

## 4. Host lifecycle contract

Reviewed adapters expose describe, probe, plan and execute through existing bounded host APIs. Plans identify target host/binding, ownership, backend, version, resource needs, changes, data impact, required permission and rollback/compensation before execution. Recheck authorization, revision, actual host requirements and service ownership at execution. Backend alternatives must list OS/runtime, CPU, supervisor/container support, RAM, free disk, ports and required tooling. Unknown measurements are reported, never assumed passed. Client OS and host runtime are distinct: a tablet may host MSO, but a visual shell selection does not make Docker/systemd available.

Install, start, stop, restart, update, backup, restore and uninstall are separate capabilities. Unsupported operations return a reason; an adapter need not implement all of them. Connected services default to probe/open only; management requires explicit adoption. Long operations have jobId, idempotency key, per-binding lock, bounded redacted logs, progress, timeout, terminal outcome and postcondition evidence. Duplicate requests must not repeat side effects. On interruption, reconcile observed state before retry; do not claim cancellation if the child continues running.

Updates pin reviewed artifacts/digests, check compatibility and backup before state migration. Restore validates ownership, backup format/version and target compatibility. Uninstall preserves user data by default; purge is a separately authorized operation. A rollback is claimed only for steps that actually support it; irreversible migrations need a restore path and explicit data-loss implications.

## 5. Embedding and communication contract

Three distinct trust paths remain explicit:
- Native components are reviewed MSO code.
- Direct external frames must be outside cockpit cookie scope and use approved exact origins.
- Managed proxy frames may use MSO gateway authentication, but the proxy must strip cockpit
  credentials upstream and restrict the app host to that app's routes. They never expose the cockpit.

Resolve endpoints server-side with exact origin/path and redirect policy. Server-side probes/proxies also enforce SSRF and bounded network policy, including DNS rebinding checks. No wildcard origin approval, same-origin vendor fallback, token in URL or secret in manifest. Different ports on one hostname do not isolate cookies. IP/LAN/no-domain access is valid; if safe framing cannot be established, return an explained external-tab or management-only view. Existing direct SurfaceApp admission currently requires HTTPS; HTTP/IP support is separate implementation work, not permission to weaken that gate.

Sandbox/Permissions Policy is selected from reviewed profiles with minimum capabilities. Preserve CSP and upstream framing/auth rules. Use no-referrer and noopener links. A frame load event proves navigation only, not authenticated readiness or healthy service. Show loading, timeout, blocked, login-required and direct-open fallback states. Do not remove vendor frame restrictions merely to make an editor appear embedded.

Optional bridge v1 uses explicit messages: ready, resize, theme, locale, navigate-request and capability-request. Validate exact event.origin AND event.source, protocol version, binding/session nonce, requestId, payload schema and size/rate limits. Reply only to the exact approved origin. Reject replay, stale/unmounted sessions and unknown messages. No wildcard targetOrigin, eval or generic exec bridge. Every capability-request passes the server's live permission/connection policy; a handshake or user gesture never supplies authority. Unsupported bridge = no bridge. An opaque-origin srcDoc app receives no privileged bridge.

## 6. Shell and activation contract

Slot definitions declare supported surfaces, cardinality (single/multiple), ordering and fallback. Single-slot collisions fail before activation; multi-slot order is priority then stable ID. Apps declare single/multi-window policy, payload schema, default size and deep-link validation. Menus/shortcuts reference registered actions; global shortcut conflicts are diagnosed. Shell chrome reuses the existing store and supports keyboard, focus restoration, close guards, touch, reduced motion and narrow/landscape layouts.

Validate definition → resolve dependencies/adapters → evaluate binding/grants → stage complete registry snapshot → activate atomically. Keep the last valid snapshot on failure. Discovery never installs, enables or executes. Optional dependency failure degrades explicitly. Disabling/removing a feature closes its views through close guards, revokes bridge sessions and cleans subscriptions/timers. It does not stop/purge a managed service. Provider topology changes require a controlled shell reload with saved layout until a tested provider lifecycle exists. Each app/slot needs a local error boundary so failures do not blank the entire shell. Essential navigation/recovery cannot be disabled without a safe alternative.

Dynamic declarative configuration can activate without a rebuild. New native components, shell chrome and lifecycle adapters require a reviewed code release in v1. Remote executable modules are outside v1. Do not describe lazy loading as hot installation.

## 7. Acceptance and migration

All surfaces use the same resolved binding and capability semantics. API/CLI/MCP retain their own authentication and transport schemas; do not auto-publish tools from untrusted JSON. Contract tests cover invalid schemas, duplicate IDs/slugs, dependency cycles, revoked grants, concurrent revision conflict, forged bridge events, cookie/redirect isolation and permission denial. Operational tests cover interrupted install/update, rollback/restore, preserved uninstall data, multiple bindings and unsupported host diagnostics. Browser tests cover shells, mobile, blocked frames, login fallback, feature failure and disable/re-enable without state loss.

Implement in the ordered phases and measurable gates in the [audit](./EXTERNAL-FEATURE-AUDIT-2026-09-27.md). Until each gate is proven, report it as pending rather than claiming fully dynamic plugins.
