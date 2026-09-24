# MSO architecture

> **Current reference.** This document describes `main` as of the current checkout.
> `docs/PROGRESS.md` records why the architecture changed; dated plans and audits are
> historical inputs, not runtime contracts.

MSO is one self-hosted Next.js application running under a non-root Linux runtime.
On Linux that runtime is native; macOS, Windows and Android can supply it through the platform
adapters documented in [PLATFORMS.md](./PLATFORMS.md). iOS/iPadOS is a client/PWA surface.
The browser UI, CLI, Alfa assistant, and optional MCP connector all converge on the same bounded
host layer rather than each implementing filesystem or process access.

```mermaid
flowchart LR
  B[Browser / phone] -->|HTTPS + live device role| N[MSO Next.js :4005]
  C[CLI `mso`] -->|local HTTP + approved device role| N
  T[Terminal MSO Agent] -->|SSE chat| N
  T -->|owner-only agent-tools bridge| M[/mcp dispatcher]
  A[Alfa] -->|HostTool catalog + per-call approvals| H[lib/host]
  X[ChatGPT / Claude / Cursor] -->|OAuth bearer + MCP| M[/mcp dispatcher]
  N --> API[/api/v1/*]
  API --> H
  M --> H
  M --> I[lib/infra]
  I --> DP[Dokploy]
  I --> CFAPI[Cloudflare]
  I --> HA[Hostinger]
  M --> D[project + skill discovery]
  H --> F[filesystem jail]
  H --> P[PTY / exec / metrics / services / packages]
  H --> MA[managed apps]
  MA --> HE[Hermes]
  MA --> OC[OpenClaw]
  N --> CF[Camoufox viewer proxy]
```

## 1. Runtime boundaries

| Boundary | Authority | Notes |
|---|---|---|
| Browser device session | `lib/auth/*`, `/api/auth/*` | Password + approved device + HMAC-signed cookie; live Viewer/Operator/Owner role. |
| Host operations | `lib/host/*` | Filesystem roots, credential denylist, process/system operations, audit. |
| Web host API | `/api/v1/*` | Live-role-gated routes; unknown mutations fail up to Owner and routes delegate into `lib/host`. |
| CLI | `bin/mso` | Another frontend over the same web API; bare `mso` starts the interactive agent and `docs/CLI.md` is generated from the help contract. |
| Terminal MSO Agent | `scripts/mso-agent.mjs`, `mso-agent-turn.mjs`, `mso-agent-layout.mjs`, `mso-agent-errors.mjs`, `/api/v1/agent-tools` | Streams through `/api/assistant`, discovers the canonical MCP catalog, renders sectioned Assistant/work/local/error output, and preserves exact approval + recoverable mutation-outcome semantics. |
| Local Agent messaging | `lib/agent/local-agent-*`, `/api/v1/local-agents`, `scripts/mso-agent-local.mjs` | Same-principal presence + durable mailbox + SSE delivery; active human mentions require a live receiver and never require an Agent Card. |
| Same-session subagents | `lib/agent/subagent-runner.ts`, `lib/mcp/tools-subagents.ts` | Bounded foreground isolated child runs behind an exec-scope delegation boundary; no recursive/background worker is created. |
| Infrastructure providers | `lib/infra/*`, `/api/v1/infra/*` | Owner-private Dokploy/Cloudflare/Hostinger state and bounded provider clients; secrets never enter model tool arguments. |
| Alfa | `frontend/slices/assistant/host-tools/*` | Stable tool catalog; reads run immediately, mutations require human approval. |
| MCP | `lib/mcp/*`, `/mcp`, `/oauth/*` | OAuth 2.1 + PKCE; `read < write < exec` token scope. |
| Managed apps | `lib/managed-apps/*` | Hermes/OpenClaw remain separate runtimes and state trees. |
| Remote browser | `camoufox-vnc.service` + `scripts/camoufox-vnc-service` | Real Camoufox Firefox over noVNC; no legacy Playwright browser service. |

There is no application database. Server-side persistence is small owner-local state
under `~/.mso/` plus the independent state directories owned by managed applications.
Window layout and several shell preferences are browser-local or synchronized through the
existing preference store.

### Gateway lifecycle boundary

**MSO Gateway is deployment-agnostic, supervisor-agnostic, and provider-agnostic by design.** The core classifies local/public/provider/process health plus ownership and supervisor independently; provider-specific launch details remain adapters. A verified public route with no MSO-owned provider process is `external-running`, not `stopped`, and external processes are never auto-adopted or mutated. Cloudflare remains the current managed/default adapter rather than a core architecture assumption. See [`docs/GATEWAY.md`](./GATEWAY.md) for state semantics, provider capabilities, systemd/s6/container/Kubernetes examples and the foreground-supervision decision.

## 2. Repository layout

```text
app/                         Next.js routes, OAuth and public install surface
frontend/slices/             vertical application slices
  appshell/                  generic shell framework
    features/                shell features
  os-shell/                  MSO manifest + capability adapters
  infrastructure/            Dokploy and Cloudflare default feature apps
  integrations/              Native connection manager shell app
lib/auth/                    login/session/device approval + live roles
lib/host/                    bounded host capability implementation
lib/mcp/                     OAuth/MCP tool catalog and dispatcher
lib/managed-apps/            Hermes/OpenClaw/9Router lifecycle/update/backup/proxy
lib/infra/                   Dokploy/Cloudflare/Hostinger provider registry, private store and bounded clients
lib/skills/                  trusted skill discovery and semantic search
scripts/                     install, release, checks, terminal agent and service helpers
claude-skills/               official trusted operational playbooks
docs/                        current references + clearly marked historical docs
```

Cross-slice imports go through the public slice barrels. Host-facing code is centralized:
a client slice calls its adapter/API contract, an API route calls `lib/host`, and neither
route nor component reimplements path-jail or process guards.

## 3. Extension taxonomy

MSO uses several extension concepts because they own different authority. They are **not** aliases for one generic plugin object. Use the narrow term that matches the lifecycle being changed:

| Term | What it owns | State / authority | Do not confuse with |
|---|---|---|---|
| **Skill** | Trusted reusable instructions and routing policy (`SKILL.md`, optional structured contract/resources). | Skill trust (`official / verified / local / untrusted`) controls whether instructions may be model-loaded. A skill does not grant credentials or tool permission. | MCP server, Integration, executable app. |
| **OpenAI plugin package** | Owner-private portable Agent Plugins package generated from reviewed `claude-skills/`: root `plugin.json`, projected root `skills/`, private `.app.json`, plus a `.codex-plugin/plugin.json` compatibility fallback. | Packaging only. Staging does not install/refresh/select the package in a ChatGPT client and does not authorize the live MSO MCP server. | MSO Project Plugin, registered app, MCP authorization. |
| **Registered app** | External platform identity referenced by `.app.json` when an exact real app registration exists. | Platform-owned install/connection/permission state. MSO keeps the mapping empty until an exact registration exists. | Generic MSO Integration or Project Plugin. |
| **Project Plugin** | A reviewed portable capability package that can declare skills and an MCP binding for one exact project. | Catalog presence never means installed. `project_mcp_manage` installs/removes only the selected project or explicit `@host` target with revision guards; no inheritance. | Global plugin install, Skill Market entry, Integration credential. |
| **MCP** | Protocol/transport boundary for structured tools. This includes MSO's own `/mcp` and project-declared MCP servers. | Tool schemas are discovered from the selected server; OAuth/project policy and call-time guards remain authoritative. | Package identity or credential storage. |
| **Integration** | Credential identity and provider routing: credential user → provider → named connection → source/backend → auth method. | Native Integrations is the credential authority; secrets stay outside ordinary model/tool arguments. | MCP itself, Project Plugin, App. |
| **App** | AppShell user-interface application or feature surfaced inside the MSO workspace. | UI install/toggle state belongs to the shell/app registry. | Managed service runtime or MCP capability. |
| **Managed App** | External runtime/service that MSO installs or operates, such as Hermes, OpenClaw or 9Router. | Host/service lifecycle, health, version, backup/update/uninstall state. | App Store entry, Integration, Project Plugin. |
| **Skill Market** | Curated source of reviewed skill bundles. | Install state is local skill state (`installed / modified / conflict / not-installed`); removal refuses unmanaged content. | General app/plugin marketplace. |
| **App Store** | Apps plus shared MCP/Skills management tabs. | UI app state remains in the workspace; MCP bindings and managed skill files live on the VPS and are shared with Settings. | OpenAI plugin directory, Project Plugin catalog, Managed App registry. |

OpenAI/Codex `.app.json` bindings may point at a registered app or a portable connector/template identity, and each binding declares whether it is required. `required: true` is a hard package dependency; `required: false` is an optional capability. Optional does **not** authorize a silent identity change: a fallback may change transport only when it uses an already-authorized, explicitly selected principal/connection and preserves the task's scope. Never copy provider OAuth credentials, silently switch from provider-owned MCP/OAuth to a local token, or treat fallback availability as equivalent authorization.

### Capability selection order

For agent routing, reuse before adding another extension:

1. Use an existing bounded/native MSO capability when it already completes the task.
2. Use an already-declared exact-project function or MCP capability when that project owns the operation.
3. For credential-dependent provider work, resolve an existing **Integration** before asking for setup or creating another connection.
4. Use an existing trusted **Skill** when the missing piece is reusable procedure/routing knowledge rather than executable capability.
5. Inspect before installing a **Project Plugin**; add one only when the selected project genuinely needs the packaged capability. Never infer global or parent-project installation.
6. Use **App** / **Managed App** lifecycle only when the request is about workspace UI or an external runtime/service.

A store/catalog is discovery metadata, not execution authority. Likewise, package metadata, a rendered widget, or the existence of a connection record never substitutes for the underlying scope, trust, revision, confirmation, provider and postcondition checks.

The cross-reference audit that informs this taxonomy lives in [`PLUGIN-REFERENCE-MATRIX.md`](./PLUGIN-REFERENCE-MATRIX.md).

## 4. AppShell

`frontend/slices/appshell/` is the generic shell framework. `os-shell` is the thin MSO
consumer that supplies brand, app manifest, shell choice and capabilities.

Current AppShell feature directories are:

- `clipboard`
- `control-center`
- `desktop-icons`
- `force-quit`
- `inspector`
- `lock-screen`
- `notifications`
- `search`
- `shortcut-help`
- `widgets`

`desktop-icons` and `force-quit` are shell infrastructure rather than ordinary slot
features, but they live under the same feature tree. See `docs/SLICE-CATALOG.md` for the
current slice inventory; its counts are checked by `scripts/check-docs.mjs`.

The shell supports macOS, Windows, iOS, Android and Dashboard presentation layers over the
same app/window state. Phone portrait resolves to a mobile shell; phone landscape can use
the desktop surface according to the responsive policy. App windows themselves remain the
same feature code.

## 5. Addressable routing without page-per-app duplication

MSO uses one catch-all application route, `app/[[...slug]]/page.tsx`. The focused app is
mirrored into the URL while window state remains client-side. App slugs are assigned in
`frontend/slices/os-shell/shell.manifest.ts`.

The shell uses the History API for focus/open URL synchronization instead of treating every
window operation as a server navigation. Reserved framework paths are never allowed to fall
through the app catch-all.

### 4.1 ChatGPT as an MSO presentation target

The web catch-all remains the authenticated cockpit route. ChatGPT does **not** frame that cockpit.
MSO exposes exactly three user-visible MCP App classes instead:

- `render_mso_list` binds `ui://mso/list-v2.html` for compact searchable collections after ordinary data tools have returned model-checkable structured results. Item/global actions return follow-up messages and do not execute mutations in the widget.
- `render_mso_block` binds `ui://mso/block-v4.html` for compact validation, action buttons, and
  CRUD input-output. A button returns a user-approved follow-up message; it does not execute a
  mutation inside the widget, so ordinary scope, approval, audit, and workflow rules still apply.
- `render_mso_page` binds the canonical `ui://mso/page-v15.html` resource for native `/`, `/monitor`, `/project`, `/diff`,
  `/integrations`, `/sessions`, `/assets`, `/browser`, and `/apps/<reviewed-id>` views. Native Page views call the same bounded MSO tools.

`workflow_start` is orchestration-only and headless: it still owns workflow isolation, skill/recipe
lookup, collision detection, tracing, evidence, and learning, but no longer binds a UI resource.
MCP agents learn the first-call map from `mso-agent-bootstrap` and `initialize.instructions`;
see [`AGENT-BOOTSTRAP.md`](./AGENT-BOOTSTRAP.md).
`project_get`, `project_diff`, and `vps_status` likewise remain pure data tools. The previous
`render_mso_surface` and `workflow_status` actions are app-only compatibility shims for cached
widgets; prior Block/Page URIs plus the previous workflow/surface resource URIs remain readable aliases but are not advertised. Page tools use the standard MCP Apps `ui.resourceUri` binding only; the legacy ChatGPT `openai/outputTemplate` alias is intentionally absent so one tool result maps to one Page mount.

Reviewed Page apps honor their iframe/remote renderer. Iframes use exact registry origins, fixed sandbox permissions, no-referrer and a visible direct/browser fallback. Cockpit/widget origins remain remote-only.
The shared `lib/surfaces/config.ts` owner-local registry (`~/.mso/surface-apps.json`, or explicit `MSO_SURFACE_APPS_JSON` override)
validates app identity, origin and approved path; portable source defaults to no external Page apps.
This trust catalog is deliberately separate from Store/runtime `AppManifest` data. A locally installed `runtime:"html"` app or HTML widget is user-controlled presentation data
and cannot grant itself a ChatGPT nested-frame origin. `srcDoc` HTML remains opaque-origin
sandboxed. The MCP widget origin comes from `OS_MCP_UI_ORIGIN`, or is derived from
`OS_PUBLIC_ORIGIN` using the `mso.` → `mso-ui.` sibling when possible; the authenticated cockpit
origin remains deployment-owned and retains its deny-framing headers. The split prevents convenient
HTML/runtime extensibility from becoming a CSP privilege-escalation path.

## 6. Host API and filesystem model

`/api/v1/*` is the authenticated host API. Important families include:

- `fs/*` — list/read/search/write/upload/move/copy/delete/zip/usage
- `exec/run` — one-shot captured command execution
- `term/*` — interactive PTY lifecycle and streaming
- `sys/*` — stats, processes, service inventory/journal/allowlisted lifecycle, package-cache visibility, cleanup, audit and self-update
- `camoufox/*` — browser service/session control
- `managed-apps/*` — Hermes/OpenClaw/9Router lifecycle, jobs, backups and optional proxying

`OS_FS_READ_ROOTS` and `OS_FS_WRITE_ROOTS` constrain filesystem access. The implementation
uses canonical path/containment checks and additionally blocks credential material such as
MSO's own state, `.env*`, SSH/GPG material and other sensitive-home paths unless a supervised
operator explicitly enables the documented escape hatch.

Explicit cwd must be an existing directory within writable roots after realpath resolution. Only omitted cwd defaults to home; invalid exec/job/PTY targets never silently retarget commands.

Interactive PTYs are intentionally stronger than filtered one-shot exec. A PTY is a real
login shell; raw keystrokes do not have reliable command boundaries. Authentication and
session lifecycle are therefore the boundary, not the one-shot destructive-command regex.

### 5.1 Device role policy

Approved browsers carry no role claim in their cookie. `getSessionContext()` resolves the current
device record on every request, so demotion/revocation is immediate. Viewer owns bounded read
surfaces; Operator receives only named operational exceptions; Owner receives mutation/shell/config
authority. The centralized route policy treats every explicit read routes as Viewer and every unclassified route as Owner, so a newly added POST fails closed until deliberately classified. The shell
filters app descriptors for usability, but server policy—not hidden UI—is the authorization layer.

System Monitor's Service Center follows the same model: inventory is Viewer, journal is Operator,
and lifecycle is Operator plus an exact `OS_SERVICE_CONTROL_UNITS` match. Package visibility runs
cache-only and exposes no apply action. These are MSO roles over one Unix process account, not an
identity directory, Linux-user switch, or tenant boundary. Appearance/Theme/Quicklinks are still a
single deployment-wide prefs document: delegated devices read it; Owner is the only writer.

## 7. Alfa versus MCP

Alfa and MCP are two separate model-facing catalogs on purpose.

**Alfa** runs inside the authenticated MSO UI. Its tool catalog lives under
`frontend/slices/assistant/host-tools/`. Read tools execute immediately; host mutations
park a visible Approve/Deny card. The complete semantic contract is
`frontend/slices/assistant/CONTRACT.md`.

**MCP** is for external clients such as ChatGPT, Claude.ai and Cursor. Its catalog lives in
`lib/mcp/`; access is controlled by the OAuth token scope rather than Alfa approval cards.

Capability execution is transport-neutral: `lib/capabilities/` owns shared execution policy, while `lib/mcp/`, `lib/a2a/`, and agent surfaces remain adapters. Guarded filesystem/exec/project operations are exposed through narrow `lib/host/*-api.ts` facades rather than one giant host import surface.
The exact full transport catalog and ChatGPT model profile are generated from source in [`generated/MCP-CATALOG.md`](./generated/MCP-CATALOG.md). Project function/MCP names remain data behind `project_capabilities`, `project_function_call`, `project_mcp_tools`, and `project_mcp_call`; they never rewrite the global tool prefix. `GET /mcp` reports the live full and ChatGPT signatures.

See `docs/MCP.md` for protocol/security internals, `docs/A2A.md` for peer-agent delegation, and `docs/CHATGPT-PLUGIN.md` for the
ChatGPT-facing setup and diagrams.

## 8. Project and skill discovery

MSO can discover projects across configured containers instead of assuming a single
`~/projects` tree. Enumeration and resolution share the same containment/ownership checks,
are bounded, and return truthful truncation + continuation metadata when a scan cannot
finish in one pass.

A project can opt into two additional declarations without changing MSO global tool names:

- `.mcp.json` — presence only is reported; MSO never exposes its contents or automatically
  connects to arbitrary project MCP servers.
- `.mso/functions.json` — a bounded version-1 manifest of fixed-argv functions. Public
  schemas are visible at read scope; execution always requires MCP `exec` scope.

Skills are merged from official/operator/bundled roots plus eligible per-project roots.
Trust is derived from provenance, ownership and containment; untrusted instructions are not
fed directly to the model. See `skills/README.md`.

## 9. Managed applications

Hermes, OpenClaw and 9Router are managed, not embedded into MSO's process model. MSO can
detect, install, start/stop/restart, read logs, update, back up, restore and conservatively
uninstall them. Long-running install/update/uninstall/restore work is represented as jobs
with bounded logs and status.

A domain is not a lifecycle dependency. All managed-app dashboard ports are loopback-only by
default. 9Router can expose `http://<public-ip>:20128` only when the operator explicitly sets
`NINE_ROUTER_EXPOSE_PUBLIC=1`; otherwise a configured application URL or split-origin host is
the only browser-facing surface.

Embedded vendor dashboards are optional. A split-origin deployment opts in by setting
`NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE` and `OS_SESSION_COOKIE_DOMAIN`, giving each embedded
dashboard its own hostname while the same MSO process proxies its loopback upstream. There
is no supported same-origin dashboard mode.

There is also no runtime navigation/feature scraping of managed-app bundles. The old
`/features` route and parser pipeline were removed; current MSO presents the vendor's own
dashboard as one surface plus MSO's Details management surface.

See `docs/MANAGED-APPS.md`, `docs/HERMES-INTEGRATION.md`,
`docs/OPENCLAW-INTEGRATION.md` and `docs/9ROUTER-INTEGRATION.md`.

## 10. Camoufox Browser

The Browser app is a real Camoufox Firefox session on a headless X display. It is streamed
through noVNC on a reserved split-origin host such as `camoufox.mso.example.com`. That host
verifies an Operator/Owner device, strips cockpit cookies/authorization before upstream, and maps
every path only to loopback noVNC. The old same-origin `/camoufox-vnc/*` route always returns
404. The service is a systemd **user** unit and is deliberately off by default; the UI starts it
when needed. `scripts/camoufox-vnc-service` owns the launch contract.

The logged-in Firefox profile is intentionally outside `~/.mso`, under the user's local
share tree. It can hold live account cookies. Browser status tools never return the VNC
password or profile contents.

## 11. Build and release architecture

Production is a systemd deployment, not a webhook deployment. `git push` alone changes no
running bytes. The supported developer release command is:

```bash
bun run ship "docs: describe the verified change"
```

The release path regenerates derived changelog data, runs push gates (including an
out-of-tree production build), pushes the exact commit, then hands the in-place
build/restart/final verification to the owner user manager when launched through MSO/MCP.
Before push, the out-of-tree build runs required browser journeys against synthetic device/credential stores and a local provider fixture.
A successful finalizer ends `~/.mso/self-update.log` with `UPDATE OK`.

For operator updates use Settings → About or `mso update`; use `--rebuild` for the
supported recovery rebuild. See `docs/INSTALL.md`, `docs/DEVELOPMENT.md` and
`docs/TROUBLESHOOTING.md`.

## 12. What is authoritative

When sources disagree, use this order:

1. current code + runtime descriptors (`GET /mcp`, `/api/health`);
2. generated contracts (`docs/CLI.md`, `docs/CHANGELOG.md`, `docs/COMPARISON.md`);
3. current reference docs listed in `docs/README.md`;
4. `docs/PROGRESS.md` for historical reasoning;
5. dated audits/plans for their point-in-time context only.

`node scripts/check-docs.mjs` plus `node scripts/gen-comparison.mjs --check` check current-reference links,
selected machine-verifiable facts, comparison evidence and source-review freshness so common drift becomes a gate failure instead of a
future archaeology task.

### ChatGPT MSO Page trust boundary

Each MSO connector/server scope owns its own Page app catalog. Core MSO Page code must not import project identities or trusted frame origins from another server scope. Portable source ships with an empty external-app catalog. An installation may opt into reviewed apps through the bounded owner-local `~/.mso/surface-apps.json` registry (or an explicit `MSO_SURFACE_APPS_JSON` override); MSO re-reads the registry when the Page resource is read and validates each exact HTTPS origin, approved start-path prefix, renderer, sandbox, and presentation before it can enter Page CSP. The dedicated widget origin is installation-derived from `OS_MCP_UI_ORIGIN` / `OS_PUBLIC_ORIGIN`. The Block resource has no frame domains.

## Server-native workflow graph

## Organization and agent routing

MSO Organization is a first-class owner-private domain beside Workflow Graph, Local Agents, A2A, Project Agents, and Integrations. It stores stable units/seats/reporting lines and execution-target references; it does not store credentials, transcripts, or workflow topology. An active seat may be `unbound`, and a seat may reference an existing `project-agent`, `local-agent`, or `a2a` executor. Workflow Agent nodes can hold `orgSeatId` and resolve that pointer at run time, so organizational identity remains stable when the underlying executor changes. All existing capability/audit/approval boundaries still apply. See [`ORGANIZATION.md`](./ORGANIZATION.md).

MSO has a Workflow Graph v2 layer above the existing automation/lifecycle/RASMIC primitives. It is the automation-topology SSOT and provides server-side schedule/webhook triggers, bounded branching/loops/subflows, retry/error paths, versioned definitions, private variables and persisted execution history. Canonical project paths resolve dynamically and credentials remain in integration authorities rather than portable graph definitions. Graph definitions/versions/runs/variables are isolated by authenticated principal, while tools/scripts/subflows retain normal capability scope, audit, connection and project guards. See [`WORKFLOW-GRAPH.md`](./WORKFLOW-GRAPH.md).

## Channels

`frontend/slices/channels/` is the first-class messaging application. The provider-neutral runtime lives in `lib/channels/`; provider-specific behavior is limited to adapters. Channel records store only non-secret routing/configuration and exact references to native Integrations connections.

Telegram and Discord credentials remain under `lib/infra/*`. Telegram inbound requests require the configured Bot API webhook secret; Discord inbound requests require Ed25519-signed Interactions. Discord Gateway message ingestion is not part of the current capability.

Inbound channel events may dispatch into the existing Workflow Graph engine through the `channel_trigger` node. Outbound automation uses `channel_send`, which calls the same Channels send service as the UI/API. This keeps Channels, Integrations, and Workflows as separate authorities without copying credentials or building a second automation engine. See [CHANNELS.md](./CHANNELS.md).

## Memory graph

`frontend/slices/memory-graph/` is the owner-only Memory app at `/memory` (`mso memory-graph`). It draws vault markdown, project `.mso/KNOWLEDGE.md`, repo-local `.agent` memory, the signed-in device's typed agent memory, and assistant memories. Unresolved `[[wikilinks]]` are ghost nodes. Web, radial, and layered layouts plus a local hop neighbourhood are client-side. This surface is inspired by open-silong's memory graph (MIT) and does not depend on Obsidian or Convex. It is not the Workflow session graph. See [`MEMORY-GRAPH.md`](./MEMORY-GRAPH.md).
