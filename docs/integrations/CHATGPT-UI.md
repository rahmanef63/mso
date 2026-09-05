# ChatGPT MCP App UI

MSO treats ChatGPT as a presentation target without turning every tool call into a widget. JSON/text results remain the portable fallback for MCP clients that do not implement MCP Apps.

## Product contract: Block or Page

The user-visible contract has exactly two canonical MCP App resources:

| Surface | Entry tool | Resource | Intended use |
| --- | --- | --- | --- |
| **Block** | `render_mso_block` | `ui://mso/block-v2.html` | Compact validation, action buttons, and CRUD input-output |
| **Page** | `render_mso_page` | `ui://mso/page-v3.html` | Full native operator views and reviewed development, preview, or production app embeds |

`workflow_start` is now headless. It remains the required orchestration bootstrap for multi-step work, including skill/recipe lookup, collision checks, workflow isolation, tracing, evidence, and learning, but it has no `_meta.ui.resourceUri` and no `openai/outputTemplate`. Starting background work therefore does not consume the answer with an unrelated workflow card.

A normal data/action tool also remains headless unless its result genuinely needs one of the two explicit presentation tools. `project_get`, `project_diff`, and `vps_status`, for example, keep structured outputs with no UI binding; the Page may call them through the standard MCP Apps `tools/call` bridge when it needs a native view.

## Visual identity

Block and Page share one presentation-token source in `lib/mcp/ui-widget-tokens.ts`, aligned with the public `rahmanef.com` design system: light surface `#f4f4f7` with text `#1c1c1f`, dark surface `#1b1b20` with text `#f2f2f5`, and the restrained blue accent `#1f6df0`. Display copy uses the Plus Jakarta Sans stack, body copy uses Inter/system fallbacks, and routes or section labels use the mono stack. Primary actions use the editorial foreground/background inversion rather than a colored fill; blue is reserved for focus, state, and small accents.

The widget first follows ChatGPT's `window.openai.theme` signal and updates on `openai:set_globals`; `prefers-color-scheme` remains the fallback for other MCP Apps hosts. The v2 resource URIs are intentional cache keys for this CSS/HTML refresh.

Official references:

- <https://developers.openai.com/plugins/build/chatgpt-ui>
- <https://developers.openai.com/plugins/reference>

## Block

`render_mso_block` accepts bounded structured data rather than HTML:

- `kind`: `validation`, `crud`, or `action`;
- title, description, and neutral/pending/success/warning/error status;
- editable or read-only fields (`text`, `number`, `email`, `url`, `textarea`, `boolean`);
- pass/warn/fail/info checks;
- scalar output rows;
- up to eight user-facing action buttons.

A Block button does **not** call a write/exec tool from inside the widget. After a real user click it sends a bounded follow-up message containing the action id and current field values. ChatGPT must then continue through the ordinary MCP tool path, so OAuth scope, argument validation, approval, rate limit, audit, workflow correlation, and destructive-operation rules remain authoritative. An action can require a second click with explicit confirmation copy; this is a presentation safeguard, not a replacement for server-side approval.

The Block resource is self-contained, has no network/frame allowlist, constructs dynamic content with DOM text APIs, and accepts neither raw HTML nor an arbitrary URL/tool name. It stores only current form values in private widget state.

## Page

`render_mso_page` accepts an MSO-style route plus optional project/SHA context:

- `/` — Page landing;
- `/monitor` — native bounded VPS status;
- `/project` — native project snapshot;
- `/diff` — native project diff summary;
- `/browser` — remote-browser handoff;
- `/apps/<reviewed-app-id>` — reviewed app target.

The model cannot pass raw HTML or an external URL. App identity, origin, start path, renderer, environment (`development`, `preview`, `production`, or `other`), sandbox, and presentation mode come from the code-owned `SURFACE_APPS` registry. An iframe target is valid only when its exact HTTPS origin is also present in the Page resource's `_meta.ui.csp.frameDomains`, and the browser runtime revalidates origin plus the approved path prefix before assigning `iframe.src`.

Fresh 3 currently exposes one reviewed Page app: Play Together at `https://game.rahmanef.com/embed`, classified as `production`. The normal Play Together shell remains anti-frame; only `/embed` and `/embed/*` permit `https://mso-ui.rahmanef.com` as an ancestor. The Page sandbox omits popup and top-navigation privileges, authentication is not bypassed, and other MSO server scopes are not copied into this catalog.

Apps that keep restrictive `X-Frame-Options` or `frame-ancestors` remain `remote`. MSO preserves those protections and offers the Camoufox seam instead of stripping headers. User-installed runtime HTML apps and arbitrary HTML snippets cannot add themselves to the ChatGPT frame allowlist; they remain opaque-origin `srcDoc` content inside the authenticated MSO shell.

## Compatibility during migration

The canonical `resources/list` response advertises only Block and Page. Four previous URIs remain readable, but are not listed, so already-cached ChatGPT descriptors do not fail immediately:

- `ui://mso/block-v1.html` resolves to the current Block resource.
- `ui://mso/page-v1.html` resolves to the current Page resource.
- `ui://mso/workflow-progress-v3.html` resolves to the Block resource. The Block recognizes the old workflow structured result and presents a small compatibility summary rather than the historical live progress dashboard.
- `ui://mso/surface-v5.html` resolves to the Page resource.

`render_mso_surface` remains app-only as a compatibility alias for a cached Page widget and has no resource binding of its own. `workflow_status` likewise remains app-only for cached workflow widgets and native operator use. New model calls use `render_mso_page`; new workflows do not create a widget.

## MCP contract

1. `resources/list` / `resources/read` expose the two canonical `ui://…` resources as `text/html;profile=mcp-app`.
2. Only `render_mso_block` and `render_mso_page` advertise `_meta.ui.resourceUri` plus the OpenAI `outputTemplate` compatibility alias.
3. Every ChatGPT transport action declares an `outputSchema`. Stable UI-critical tools use typed schemas; other actions use the bounded `{ result }` envelope. Generic MCP clients retain their existing text fallback where applicable.
4. Sandboxed Pages use the standard `tools/call` bridge for native data refreshes. ChatGPT-only helpers such as display mode, private widget state, follow-up messages, and `openExternal` are feature-detected.
5. The dedicated UI origin is `https://mso-ui.rahmanef.com`. Standard CSP fields live only in `_meta.ui.csp`; the legacy `openai/widgetCSP` object retains only `redirect_domains` for `Open in MSO`.

Current ChatGPT transport profile: **66 tools** — 64 model-visible actions (35 read / 17 write / 12 exec) plus app-only `workflow_status` and `render_mso_surface`. The full transport catalog has 90 tools. Exactly two tools bind UI resources: `render_mso_block` and `render_mso_page`.

## Source boundaries

| Contract | MSO source |
| --- | --- |
| Shared Block/Page visual tokens and host-theme bridge | `lib/mcp/ui-widget-tokens.ts` |
| Block resource/runtime | `lib/mcp/ui-block.ts` |
| Block tool/schema | `lib/mcp/tools-block.ts` |
| Page resource/runtime | `lib/mcp/ui-surface.ts`, `lib/mcp/ui-surface-script.ts`, `lib/mcp/ui-surface-style.ts` |
| Page security catalog/router | `lib/mcp/surface-catalog.ts`, `lib/mcp/tools-surface.ts` |
| Resource registry and legacy aliases | `lib/mcp/ui-resources.ts` |
| Workflow bootstrap/lifecycle | `lib/mcp/tools-workflow-start.ts`, `lib/mcp/tools-workflow-lifecycle.ts` |
| Resource capability / RPC | `lib/mcp/dispatch.ts` |
| MCP descriptor/profile contract | `lib/mcp/tool-contract.ts` |
| Toolset signature | `lib/mcp/toolset.ts` |
| Contract tests | `lib/mcp/ui-resources.test.ts`, `lib/mcp/ui-widget-theme.test.ts`, `lib/mcp/tools-block.test.ts`, `lib/mcp/tools-surface.test.ts`, `lib/mcp/surface-catalog.test.ts` |

## Flow

```text
ChatGPT model
   │
   ├─ workflow_start ──→ structured workflow id only (headless)
   │
   ├─ bounded data/action tools ──→ structured/text results
   │
   ├─ render_mso_block ──→ compact validation/action/CRUD block
   │                          └─ user click → follow-up message
   │                                  └─ normal scoped/approved tool call
   │
   └─ render_mso_page ──→ full MSO Page
                              ├─ /monitor ──tools/call──→ vps_status
                              ├─ /project ──tools/call──→ project_get
                              ├─ /diff    ──tools/call──→ project_diff
                              ├─ exact-origin iframe after explicit review
                              └─ remote-browser seam for anti-frame apps
```

## Manual ChatGPT smoke journeys

| Journey | Suggested prompt/action | Pass condition |
| --- | --- | --- |
| Headless workflow | Start a harmless multi-step workflow | `workflow_start` returns a workflow id but opens no MCP App |
| Validation Block | Render deployment checks with Approve/Revise actions | compact Block renders; click creates a follow-up; no mutation happens inside the widget |
| CRUD Block | Render editable sample fields and a Save action | values remain editable, required validation works, and submitted values return through the follow-up message |
| Native Page | Render `/monitor`, then `/project` | Page opens and refreshes bounded data through `tools/call` |
| Production Page | Render `/apps/play-together` | iframe starts only at `https://game.rahmanef.com/embed`; fullscreen stays user-initiated |
| Anti-frame fallback | Open a Page target classified `remote` | no header stripping or unreviewed frame occurs; the remote-browser handoff is shown |
| Filesystem CRUD | Create/read/copy/move/delete a disposable file through ordinary tools | Block/Page presentation never changes the filesystem permission boundary |

## Deployment and client refresh

After changing UI resources or tool metadata:

1. run targeted tests, `bun run verify`, and the official production release path;
2. verify `initialize` reports MCP server `1.10.0` and toolset `2026.09.05.1`;
3. verify `tools/list` exposes 66 ChatGPT transport tools, keeps `workflow_start` headless, marks the two compatibility actions app-only, and binds only `render_mso_block` / `render_mso_page`;
4. verify `resources/list` contains exactly `ui://mso/block-v2.html` and `ui://mso/page-v3.html`, both with `text/html;profile=mcp-app`;
5. verify Block has no frame domain and Page has only reviewed exact origins;
6. refresh/re-scan the ChatGPT development app so its cached action/resource snapshot is replaced.

A widget already rendered in an old conversation cannot be removed retroactively. After the server deployment, a stale workflow card indicates a cached ChatGPT connector snapshot, not a new `workflow_start` binding.

## Page initialization and readiness (v3)

Page sends the MCP Apps `ui/initialize` request with `appInfo`, `appCapabilities` and
protocol version `2026-01-26`, then acknowledges with `ui/notifications/initialized`.
Host result notifications and wrapped legacy `window.openai.toolOutput` use the same validated
route interpreter. Unchanged results or host globals do not remount a running embedded app.
The cached `ui://mso/page-v2.html` URI is a read-only alias for current Page bytes.

A reviewed game sends a versioned readiness acknowledgement; Page validates its exact origin
and iframe source. An iframe load event does not prove readiness. The bounded timeout shows
Retry preview and Open production controls instead of a permanent skeleton. The production
link is user-initiated through the host, and the Page redirect allowlist contains only MSO and
the reviewed game origin. Normal host tools and headless workflows are unchanged.

Verification: `node scripts/e2e/mcp-page.mjs` exercises a pure MCP host without `window.openai`,
legacy wrapped output, readiness/source checks, timeout/retry and no duplicate iframe reloads.
For Play Together, the independent game server must allow every reviewed ancestor on `/embed`
and keep the inner cartridge at `/embed/game-frame.html`; root app framing stays restricted.

Page reports measured dimensions through `ui/notifications/size-changed`; its layout avoids viewport-relative height feedback when the host resizes the component.
