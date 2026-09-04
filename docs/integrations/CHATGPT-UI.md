# ChatGPT MCP App UI

MSO renders first-party interactive operator cards inside ChatGPT while keeping JSON/text results as the portable fallback for MCP clients that do not implement MCP Apps.

## Contract

A normal tool result cannot create an inline application by returning arbitrary HTML. MSO exposes the MCP Apps contracts explicitly:

1. `resources/list` / `resources/read` expose `ui://…` resources with `text/html;profile=mcp-app`.
2. Only render-entry tools bind a resource with `_meta.ui.resourceUri`; data tools return structured results without templates. `workflow_start` owns the dedicated progress resource and `render_mso_surface` owns the general-purpose Surface. The OpenAI `outputTemplate` alias remains only on those render entries for compatibility.
3. Every ChatGPT action declares `outputSchema`. UI/critical tools use typed projections; other actions use the shared bounded `{ result }` structured envelope. Generic MCP clients keep their historical text fallback unless an explicit output schema exists.
4. Sandboxed widgets read tool results from the MCP Apps bridge and use standard `tools/call` for data refreshes. ChatGPT-only extensions remain feature-detected for display mode, widget state, and `openExternal`.

Official references:

- <https://developers.openai.com/plugins/build/chatgpt-ui>
- <https://developers.openai.com/plugins/reference>

## MSO resources

| Experience | Entry tool | Resource | Refresh behavior |
| --- | --- | --- | --- |
| Workflow progress | `workflow_start` | `ui://mso/workflow-progress-v3.html` | app-only `workflow_status` |
| Universal MSO Surface | `render_mso_surface` | `ui://mso/surface-v5.html` | `/monitor`, `/project`, and `/diff` call pure data tools via `tools/call`; Play Together uses its reviewed exact-origin `/embed` frame boundary |

Source boundaries:

| Contract | MSO source |
| --- | --- |
| Resource registry / workflow UI | `lib/mcp/ui-resources.ts` |
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

The universal Surface receives no raw project/VPS HTML. Its native views call `project_get`, `project_diff`, and `vps_status` through MCP Apps `tools/call`; those data tools keep complete structured outputs for model/tool chaining but no longer own templates. Project output remains bounded to safe identity/Git/package/Convex/integration/knowledge metadata, diff UI consumes only summary/file metadata rather than interpolating the unified diff, and VPS output reuses the masked infrastructure summary layer so raw credentials never enter the widget.

Both resources are self-contained: no external JavaScript, CSS, images, or direct `fetch()` calls. The workflow card retains `Open in MSO`; the Surface provides native routing and the reviewed app-demo renderer. A root MSO landing carrying ChatGPT's `redirectUrl=https://chatgpt.com/c/...` is server-redirected to `/assistant/mcp` while preserving the callback query; MSO never follows that callback itself.

The universal **MSO Surface** is intentionally stricter than the ordinary runtime-app/HTML widgets. `render_mso_surface` accepts only an MSO-style route plus optional project/SHA context — never raw HTML and never an arbitrary URL. Nested frames can come only from the code-owned `SURFACE_APPS` registry and are permitted only when the exact origin is also present in the resource's `ui.csp.frameDomains`. The current Fresh 3 catalog has one reviewed iframe renderer for Play Together, so `frameDomains` contains exactly `https://game.rahmanef.com`. The browser-side renderer validates the returned app id and URL origin against the catalog bundled into the signed resource before setting `iframe.src`; dynamic labels use DOM `textContent`, not HTML interpolation. The iframe sandbox omits popup/top-navigation privileges. Apps that send `X-Frame-Options` or restrictive `frame-ancestors` remain `remote` and MSO does not strip those protections.

Fresh 3 is the VPSKU MSO connector. Its current app target is **Play Together** at `https://game.rahmanef.com`. App identities and trusted origins from other MSO server scopes must not be copied into this catalog or CSP.

Play Together framing is opt-in through a dedicated app boundary: the normal site remains protected, while `/embed` and `/embed/*` allow only `https://mso-ui.rahmanef.com` as the non-self frame ancestor. MSO reciprocally allows only `https://game.rahmanef.com` in the Surface resource CSP and revalidates both origin **and** the `/embed` path prefix before assigning `iframe.src`. The Surface sandbox still omits popups/top-navigation. Authentication is not bypassed; an unauthenticated iframe sees Play Together's normal Auth flow.

Installed `runtime:"html"` apps and user-authored HTML widgets are **not** trusted inputs to the ChatGPT frame allowlist. They remain useful inside the authenticated MSO shell, but promoting one into `SURFACE_APPS` requires an explicit code review/release. This separation prevents a user-installed manifest or HTML snippet from escalating into a ChatGPT nested-frame CSP capability. Raw HTML snippets continue to run only in opaque-origin `srcDoc` sandboxes. The authenticated cockpit itself remains non-frameable; no change is made to its `frame-ancestors` or `X-Frame-Options` policy.

## Flow

```text
ChatGPT model
   │
   ├─ workflow_start ──→ workflow card ──→ workflow_status (app-only)
   ├─ project_get / project_diff / vps_status ──→ structured data only
   └─ render_mso_surface ─→ MSO Surface
                             ├─ /monitor ──tools/call──→ vps_status
                             ├─ /project ──tools/call──→ project_get
                             ├─ /diff    ──tools/call──→ project_diff
                             ├─ exact-origin iframe only after explicit trust review
                             └─ remote-browser seam for anti-frame apps

All data tools keep portable structured/text results for non-MCP-Apps clients.
```

## Dedicated UI origin

Both templates keep standard CSP exclusively in `_meta.ui.csp`. The legacy `_meta["openai/widgetCSP"]` compatibility object contains only `redirect_domains` for `Open in MSO`; it deliberately does not duplicate `connect_domains`, `resource_domains`, or `frame_domains`. This keeps the scanner-facing policy single-source while preserving ChatGPT's trusted `openExternal` redirect allowlist.

Both templates declare `_meta.ui.domain = https://mso-ui.rahmanef.com` and the ChatGPT compatibility alias `_meta["openai/widgetDomain"]` with the same origin. The sibling hostname is intentional: the cockpit may scope its session cookie to `mso.rahmanef.com`, while `mso-ui.rahmanef.com` is outside that cookie domain. The dedicated origin therefore satisfies the plugin UI identity requirement without reusing the authenticated dashboard origin.

The reproducible Traefik route is stored in `ops/traefik/mso-ui.yml` and forwards only to the same local MSO service through the existing HTTPS/Let's Encrypt ingress. Widget CSP still allows no network/static-resource domains and only permits `Open in MSO` to redirect to `https://mso.rahmanef.com`.

## Manual ChatGPT smoke journeys

Do not manually click through every model action. Cover the public contract with a small set of journeys that compose multiple primitives:

| Journey | Suggested prompt/action | Pass condition |
| --- | --- | --- |
| Workflow/UI bridge | Start a read-only workflow for `mso`, press `Refresh`, then `Open in MSO` | progress updates; MSO opens visibly at Alfa → MCP Activity (`/assistant/mcp`), including when ChatGPT still uses a cached root-targeting widget; the explicit `Open directly` fallback targets the same view |
| MSO Surface | Ask to render `/`, `/monitor`, then `/apps/play-together` | home/native view renders inline; Play Together loads only from `https://game.rahmanef.com/embed`; `frameDomains` contains exactly `https://game.rahmanef.com`; fullscreen remains user-initiated |
| VPS / monitor | Ask for current VPS data, then render `/monitor` | `vps_status` returns structured data without a template; Surface renders CPU/memory/disk/apps/browser/infra and refresh works |
| Project/Git | Ask to inspect project `mso`, then render `/project` or `/diff` | data tools return the correct project/branch/changes without templates; Surface presents them without secrets |
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
4. verify all 64 ChatGPT transport tools expose `outputSchema` (63 model actions + app-only `workflow_status`); verify only `workflow_start` and `render_mso_surface` expose `_meta.ui.resourceUri`, while `project_get`, `project_diff`, and `vps_status` do not;
5. verify `resources/list` contains exactly the dedicated workflow card plus universal Surface and each `resources/read` returns `text/html;profile=mcp-app`;
6. verify both UI resources report `ui.domain=https://mso-ui.rahmanef.com`; for the universal Surface verify `ui.csp.frameDomains` contains only reviewed iframe origins, native data refreshes use `tools/call`, and `workflow_status` polling does not enter learned workflow steps;
7. verify `skills/list`, `skills/get`, and each declared `skill://` resource/digest before the final Scan Tools refresh.

If ChatGPT still renders text only after a verified deployment, treat a stale app/action snapshot as the first suspect before changing the server again.
