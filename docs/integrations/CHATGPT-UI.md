# ChatGPT MCP App UI

MSO renders first-party interactive operator cards inside ChatGPT while keeping JSON/text results as the portable fallback for MCP clients that do not implement MCP Apps.

## Contract

A normal tool result cannot create an inline application by returning arbitrary HTML. MSO exposes the MCP Apps contracts explicitly:

1. `resources/list` / `resources/read` expose `ui://…` resources with `text/html;profile=mcp-app`.
2. Model-visible tools bind a resource with `_meta.ui.resourceUri` plus the OpenAI compatibility alias `_meta["openai/outputTemplate"]`.
3. Every ChatGPT action declares `outputSchema`. UI/critical tools use typed projections; other actions use the shared bounded `{ result }` structured envelope. Generic MCP clients keep their historical text fallback unless an explicit output schema exists.
4. Sandboxed widgets read `window.openai.toolOutput`, may call only explicitly app-visible MSO tools through `window.openai.callTool`, and use `window.openai.openExternal` for the full dashboard.

Official references:

- <https://developers.openai.com/plugins/build/chatgpt-ui>
- <https://developers.openai.com/plugins/reference>

## MSO resources

| Experience | Entry tool | Resource | Refresh behavior |
| --- | --- | --- | --- |
| Workflow progress | `workflow_start` | `ui://mso/workflow-progress-v2.html` | app-only `workflow_status` |
| Project status | `project_get` | `ui://mso/project-status-v2.html` | widget calls `project_get` again |
| Git diff summary | `project_diff` | `ui://mso/project-diff-v2.html` | static result; request a new diff for changed state |
| VPS/operator status | `vps_status` | `ui://mso/vps-status-v2.html` | widget calls `vps_status` again |
| Universal MSO Surface | `render_mso_surface` | `ui://mso/surface-v2.html` | native views call bounded read tools; nested frames require an explicit exact-origin trust review |

Source boundaries:

| Contract | MSO source |
| --- | --- |
| Resource registry / workflow UI | `lib/mcp/ui-resources.ts` |
| Project/diff/VPS resources | `lib/mcp/ui-operator-resources.ts` |
| Universal Surface resource/runtime | `lib/mcp/ui-surface.ts`, `lib/mcp/ui-surface-script.ts`, `lib/mcp/ui-surface-style.ts` |
| Surface security catalog/router | `lib/mcp/surface-catalog.ts`, `lib/mcp/tools-surface.ts` |
| Resource capability / RPC | `lib/mcp/dispatch.ts` |
| Workflow structured schema | `lib/mcp/tools-workflow-start.ts`, `lib/mcp/tools-workflow-lifecycle.ts` |
| Project/diff structured schemas | `lib/mcp/tools-project-experience.ts` |
| VPS structured schema | `lib/mcp/tools-operator-dashboard.ts` |
| Shared executable capability schema | `lib/capabilities/tool.ts` (`lib/mcp/tool-kit.ts` is the compatibility adapter) |
| MCP descriptor/profile contract | `lib/mcp/tool-contract.ts` |
| Toolset signature | `lib/mcp/toolset.ts` |
| Tests | `lib/mcp/ui-resources.test.ts` |

## Data boundaries

The workflow component receives only workflow id, intent, resolved project label, timing, step count, and recent tool name/outcome/timestamp/duration. `workflow_status` is `ui.visibility:["app"]`, so polling is not another model action and is deliberately excluded from workflow-memory persistence.

The project component receives the safe `project_get` projection: project identity/path, bounded Git state, package metadata, Convex detection mode, project-MCP alias count, and knowledge existence/size. It does not receive `.mcp.json`, `.env.local`, provider tokens, project-MCP headers, or knowledge content.

The diff component receives only project/mode/SHA metadata, changed file names and aggregate additions/deletions. The unified diff remains in the tool's portable text result and is never interpolated into widget HTML.

The VPS component receives bounded health/process/app/browser state and **masked** infrastructure readiness. Provider values are those already sanitized by the infrastructure summary layer; raw credentials are never added for UI rendering.

All five resources are self-contained: no external JavaScript, CSS, images, or direct `fetch()` calls. `Open in MSO` feature-detects the official ChatGPT `window.openai.openExternal` bridge, registers a contextual MSO deep-link with `window.openai.setOpenInAppUrl`, and shows a user-clickable `Open directly` fallback plus visible status when automatic navigation is unavailable. Workflow cards target `/assistant/mcp`, VPS cards `/monitor`, project cards `/files`, and diff cards `/code`. As a cache-safe fallback, a root MSO landing carrying ChatGPT's `redirectUrl=https://chatgpt.com/c/...` is server-redirected to `/assistant/mcp` while preserving the callback query; MSO never follows that callback itself.

The universal **MSO Surface** is intentionally stricter than the ordinary runtime-app/HTML widgets. `render_mso_surface` accepts only an MSO-style route plus optional project/SHA context — never raw HTML and never an arbitrary URL. Nested frames can come only from the code-owned `SURFACE_APPS` registry and are permitted only when the exact origin is also present in the resource's `ui.csp.frameDomains`. The current Fresh 3 catalog has no iframe renderer, so `frameDomains` is omitted entirely. The browser-side renderer validates the returned app id and URL origin against the catalog bundled into the signed resource before setting `iframe.src`; dynamic labels use DOM `textContent`, not HTML interpolation. The iframe sandbox omits popup/top-navigation privileges. Apps that send `X-Frame-Options` or restrictive `frame-ancestors` remain `remote` and MSO does not strip those protections.

Fresh 3 is the VPSKU MSO connector. Its current app target is **Play Together** at `https://game.rahmanef.com`. App identities and trusted origins from other MSO server scopes must not be copied into this catalog or CSP.

Installed `runtime:"html"` apps and user-authored HTML widgets are **not** trusted inputs to the ChatGPT frame allowlist. They remain useful inside the authenticated MSO shell, but promoting one into `SURFACE_APPS` requires an explicit code review/release. This separation prevents a user-installed manifest or HTML snippet from escalating into a ChatGPT nested-frame CSP capability. Raw HTML snippets continue to run only in opaque-origin `srcDoc` sandboxes. The authenticated cockpit itself remains non-frameable; no change is made to its `frame-ancestors` or `X-Frame-Options` policy.

## Flow

```text
ChatGPT model
   │
   ├─ workflow_start ──→ workflow card ──→ workflow_status (app-only)
   ├─ project_get    ──→ project card  ──→ project_get refresh
   ├─ project_diff   ──→ diff card
   ├─ vps_status     ──→ VPS card      ──→ vps_status refresh
   └─ render_mso_surface ─→ MSO Surface
                             ├─ native monitor/project/diff views
                             ├─ exact-origin iframe only after explicit trust review
                             └─ remote-browser seam for anti-frame apps

Every entry tool also returns portable text/JSON for non-MCP-Apps clients.
```

## Dedicated UI origin

All five templates declare `_meta.ui.domain = https://mso-ui.rahmanef.com` and the ChatGPT compatibility alias `_meta["openai/widgetDomain"]` with the same origin. The sibling hostname is intentional: the cockpit may scope its session cookie to `mso.rahmanef.com`, while `mso-ui.rahmanef.com` is outside that cookie domain. The dedicated origin therefore satisfies the plugin UI identity requirement without reusing the authenticated dashboard origin.

The reproducible Traefik route is stored in `ops/traefik/mso-ui.yml` and forwards only to the same local MSO service through the existing HTTPS/Let's Encrypt ingress. Widget CSP still allows no network/static-resource domains and only permits `Open in MSO` to redirect to `https://mso.rahmanef.com`.

## Manual ChatGPT smoke journeys

Do not manually click through every model action. Cover the public contract with a small set of journeys that compose multiple primitives:

| Journey | Suggested prompt/action | Pass condition |
| --- | --- | --- |
| Workflow/UI bridge | Start a read-only workflow for `mso`, press `Refresh`, then `Open in MSO` | progress updates; MSO opens visibly at Alfa → MCP Activity (`/assistant/mcp`), including when ChatGPT still uses a cached root-targeting widget; the explicit `Open directly` fallback targets the same view |
| MSO Surface | Ask to render `/`, `/monitor`, then `/apps/play-together` | home/native view renders inline; Play Together resolves to `https://game.rahmanef.com` but stays on the remote-browser seam while its CSP is `frame-ancestors 'self'`; `frameDomains` remains absent |
| VPS card | Ask for the current VPS status | `vps_status` renders CPU/memory/disk/apps/browser/infra and its refresh works |
| Project/Git | Ask to inspect project `mso`, then show its current diff/history | `project_get` and `project_diff` render the correct project/branch/changes without secrets |
| Safe filesystem CRUD | Create/read/copy/move/delete a disposable file under `~/mso-smoke-tests/` | content/hash round-trip succeeds and cleanup leaves no test file |
| Convex | Check database status/tools for a known Convex project such as CareerPack | provider is Convex, project boundary is preserved, no env credential tools appear |
| Project agent | Run `project_agent_run` in `plan_mode=true` for a harmless project inspection | returns a bounded plan/message id without modifying the repo |
| Operator integrations | Check `browser_status` + `infra_providers_list` | read-only state is returned without starting browser/app or exposing provider secrets |

This seven-journey suite is the preferred human acceptance test after a Scan Tools refresh. Full automated contract/coverage/build gates remain mandatory before release.

## Deployment / refresh

After a UI/schema release:

1. run `bun run verify` and a production build;
2. deploy through the normal MSO release path;
3. refresh/re-scan the ChatGPT development app so `initialize`, `tools/list`, and `resources/list` are read again;
4. verify all 64 ChatGPT transport tools expose `outputSchema` (63 model actions + app-only `workflow_status`); verify each UI entry tool also exposes `_meta.ui.resourceUri`;
5. verify each `resources/read` returns `text/html;profile=mcp-app`;
6. verify every UI resource reports `ui.domain=https://mso-ui.rahmanef.com`; for the universal Surface verify `ui.csp.frameDomains` contains only reviewed iframe origins, refresh buttons work, and `workflow_status` polling does not enter learned workflow steps;
7. verify `skills/list`, `skills/get`, and each declared `skill://` resource/digest before the final Scan Tools refresh.

If ChatGPT still renders text only after a verified deployment, treat a stale app/action snapshot as the first suspect before changing the server again.
