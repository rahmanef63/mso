# ChatGPT MCP App UI

MSO exposes two explicit presentation resources. Ordinary tools and workflow startup stay
headless; clients without MCP Apps keep structured/text results.

| Surface | Entry tool | Resource | Purpose |
| --- | --- | --- | --- |
| Block | `render_mso_block` | `ui://mso/block-v3.html` | Validation, actions, bounded CRUD input/output |
| Page | `render_mso_page`, `integration_setup_open` | `ui://mso/page-v14.html` | Native operator views and external-app browser handoff |

## Layout and identity

Page fills the host's declared `containerDimensions.height`, or the full
`containerDimensions.maxHeight` allowance. Legacy `window.openai.maxHeight` is the
fallback, followed by a 680 px working area when no constraint is supplied. The former
48% cap is removed. Height never derives from the current iframe viewport, preventing
resize feedback. One Page body owns scrolling; fullscreen uses the actual viewport.

Page reports measured dimensions through `ui/notifications/size-changed` after the
MCP Apps handshake. Legacy hosts can use `notifyIntrinsicHeight`. The host controls
the enclosing frame and may impose a smaller fixed height. Fullscreen/PiP require an
explicit click and are hidden when the host declares them unsupported.

Standard host context controls theme, display mode, dimensions and safe-area insets.
Legacy OpenAI globals and the browser color-scheme remain compatible fallbacks.
The compact header, readable controls, flat navigation and shared integration styles
follow the existing MSO workbench. Block, Page and native Integrations embed the existing
`public/icon.svg` mark without an image request; the shell uses that same public asset.
Presentation colors and fonts remain in `lib/presentation/widget-tokens.ts`.

## Block behavior

Block accepts bounded structured fields, checks, scalar outputs and up to eight actions;
it never accepts raw HTML or an arbitrary tool name. A click sends a bounded follow-up
message containing the selected action and field values. The agent then uses ordinary
scoped tools. Server authorization, validation, rate limits and audit remain authoritative.
Private widget state contains current form values. Block has no network or frame allowlist.

## Page routes and trust

| Route | Context / behavior |
| --- | --- |
| `/` | Workspace navigation |
| `/integrations` | Shared connection manager, Add MCP and private credential forms |
| `/monitor` | Bounded server status through `vps_status` |
| `/project` | Explicit project context; `project_get` |
| `/diff` | Explicit project and optional SHA; `project_diff` |
| `/browser` | Open the MSO remote browser |
| `/apps/<reviewed-id>` | Validate the deployment registry and hand off to the remote browser |

Page does not mount third-party iframes. It accepts neither arbitrary HTML nor external
URLs from the model. The bounded owner registry (`~/.mso/surface-apps.json`, or the explicit
`MSO_SURFACE_APPS_JSON` override) supplies app identity, HTTPS origin and approved path.
Public source defaults to an empty app catalog. Resource reads rebuild this safe catalog;
the browser rechecks app identity, origin and path before exposing a handoff.

Native integration forms and tools use the same capability/connection contracts as the
browser. Credentials travel directly to MSO using private, expiring setup authorization,
never through chat or ordinary tool arguments. Public guides remain readable without
write access. Project MCP and automation contracts are in [automation flows](../AUTOMATION-FLOWS.md).

User-installed HTML apps cannot grant themselves Page trust. The authenticated cockpit
retains its framing protections; external sites keep their own authentication boundaries.

## Bridge, metadata and compatibility

Page initializes MCP Apps protocol `2026-01-26`, then sends
`ui/notifications/initialized`. Only parent-source messages are accepted. Tool result
notifications and legacy wrapped `window.openai.toolOutput` use the same route validator.
Unchanged outputs do not remount views; teardown clears active forms and observers.

Page-bound tools advertise standard `ui.resourceUri` only. Block also retains its
`openai/outputTemplate` compatibility binding. Every ChatGPT tool has an output schema;
exact tools, counts and scopes are generated in [the catalog](../generated/MCP-CATALOG.md).

Resource CSP is explicit: neither surface allows nested frames; Page permits its MSO
origin for private setup requests. `OS_MCP_UI_ORIGIN` controls the widget origin, otherwise
the configured public origin derives it. Legacy redirect metadata supports Open in MSO.

Only the two current resources are listed. Older Block/Page URIs remain read aliases for
current bytes, including Block v2 and Page v13. `workflow_status` and `render_mso_surface`
remain app-only compatibility tools. `workflow_start` has no UI binding.

## Verification and deployment

Run `node scripts/e2e/mcp-page.mjs` for a small initial host frame, standard-versus-legacy
height precedence, fixed/flexible resize, light/dark theme, 320–1280 px layouts, logo,
Add MCP and fullscreen. The release gate runs this browser contract automatically.
`node scripts/e2e/integrations.mjs` adds shared manager user CRUD, keyboard selection,
provider search and 320–1920 px reflow. Production release journeys verify authorization,
real server handlers and provider revocation using synthetic stores.

After shipping, compare live discovery/version/hash against `lib/mcp/toolset.ts` and the
generated catalog, verify the two resource URIs, and reopen the Page. Hosts cache tool
and resource descriptors: a development-app rescan/reconnect may still be needed.
The server cannot replace an already mounted document in an old conversation.

Official references:
- [MCP Apps host dimensions](https://apps.extensions.modelcontextprotocol.io/api/interfaces/app.McpUiHostContext.html)
- [MCP Apps specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx)
- [OpenAI plugin reference](https://developers.openai.com/plugins/reference)
