# MSO architecture

> **Current reference.** This document describes `main` as of the current checkout.
> `docs/PROGRESS.md` records why the architecture changed; dated plans and audits are
> historical inputs, not runtime contracts.

MSO is one self-hosted Next.js application running as a non-root Linux user. The
browser UI, CLI, Alfa assistant, and optional MCP connector all converge on the same
bounded host layer rather than each implementing filesystem or process access.

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

## 2. Repository layout

```text
app/                         Next.js routes, OAuth and public install surface
frontend/slices/             vertical application slices
  appshell/                  generic shell framework
    features/                shell features
  os-shell/                  MSO manifest + capability adapters
  infrastructure/            Dokploy and Cloudflare default feature apps
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

## 3. AppShell

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

## 4. Addressable routing without page-per-app duplication

MSO uses one catch-all application route, `app/[[...slug]]/page.tsx`. The focused app is
mirrored into the URL while window state remains client-side. App slugs are assigned in
`frontend/slices/os-shell/shell.manifest.ts`.

The shell uses the History API for focus/open URL synchronization instead of treating every
window operation as a server navigation. Reserved framework paths are never allowed to fall
through the app catch-all.

## 5. Host API and filesystem model

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

## 6. Alfa versus MCP

Alfa and MCP are two separate model-facing catalogs on purpose.

**Alfa** runs inside the authenticated MSO UI. Its tool catalog lives under
`frontend/slices/assistant/host-tools/`. Read tools execute immediately; host mutations
park a visible Approve/Deny card. The complete semantic contract is
`frontend/slices/assistant/CONTRACT.md`.

**MCP** is for external clients such as ChatGPT, Claude.ai and Cursor. Its catalog lives in
`lib/mcp/`; access is controlled by the OAuth token scope rather than Alfa approval cards.
<!-- mcp-toolset: server=1.6.0 version=2026.09.02.7 tools=66 read=32 write=22 exec=12 -->
At the current toolset it exposes **67 transport tools**: **66 model/operator tools** (32 read, 22 write, 12 exec) plus the app-only `workflow_status` progress bridge. Project-specific
function names remain data behind `project_capabilities` / `project_function_call`, so one
project cannot dynamically rewrite the global MCP tool prefix. `GET /mcp` remains the live count/hash authority.

See `docs/MCP.md` for protocol/security internals, `docs/A2A.md` for peer-agent delegation, and `docs/CHATGPT-PLUGIN.md` for the
ChatGPT-facing setup and diagrams.

## 7. Project and skill discovery

MSO can discover projects across configured containers instead of assuming a single
`~/projects` tree. Enumeration and resolution share the same containment/ownership checks,
are bounded, and return truthful truncation + continuation metadata when a scan cannot
finish in one pass.

A project can opt into two additional declarations:

- `.mcp.json` — presence only is reported; MSO never exposes its contents or automatically
  connects to arbitrary project MCP servers.
- `.mso/functions.json` — a bounded version-1 manifest of fixed-argv functions. Public
  schemas are visible at read scope; execution always requires MCP `exec` scope.

Skills are merged from official/operator/bundled roots plus eligible per-project roots.
Trust is derived from provenance, ownership and containment; untrusted instructions are not
fed directly to the model. See `skills/README.md`.

## 8. Managed applications

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

## 9. Camoufox Browser

The Browser app is a real Camoufox Firefox session on a headless X display. It is streamed
through noVNC on a reserved split-origin host such as `camoufox.mso.example.com`. That host
verifies an Operator/Owner device, strips cockpit cookies/authorization before upstream, and maps
every path only to loopback noVNC. The old same-origin `/camoufox-vnc/*` route always returns
404. The service is a systemd **user** unit and is deliberately off by default; the UI starts it
when needed. `scripts/camoufox-vnc-service` owns the launch contract.

The logged-in Firefox profile is intentionally outside `~/.mso`, under the user's local
share tree. It can hold live account cookies. Browser status tools never return the VNC
password or profile contents.

## 10. Build and release architecture

Production is a systemd deployment, not a webhook deployment. `git push` alone changes no
running bytes. The supported developer release command is:

```bash
bun run ship "docs: describe the verified change"
```

The release path regenerates derived changelog data, runs push gates (including an
out-of-tree production build), pushes the exact commit, then hands the in-place
build/restart/final verification to the owner user manager when launched through MSO/MCP.
A successful finalizer ends `~/.mso/self-update.log` with `UPDATE OK`.

For operator updates use Settings → About or `mso update`; use `--rebuild` for the
supported recovery rebuild. See `docs/INSTALL.md`, `docs/DEVELOPMENT.md` and
`docs/TROUBLESHOOTING.md`.

## 11. What is authoritative

When sources disagree, use this order:

1. current code + runtime descriptors (`GET /mcp`, `/api/health`);
2. generated contracts (`docs/CLI.md`, `docs/CHANGELOG.md`, `docs/COMPARISON.md`);
3. current reference docs listed in `docs/README.md`;
4. `docs/PROGRESS.md` for historical reasoning;
5. dated audits/plans for their point-in-time context only.

`node scripts/check-docs.mjs` plus `node scripts/gen-comparison.mjs --check` check current-reference links,
selected machine-verifiable facts, comparison evidence and source-review freshness so common drift becomes a gate failure instead of a
future archaeology task.
