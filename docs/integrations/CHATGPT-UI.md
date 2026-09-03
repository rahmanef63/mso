# ChatGPT MCP App UI

MSO renders first-party interactive operator cards inside ChatGPT while keeping JSON/text results as the portable fallback for MCP clients that do not implement MCP Apps.

## Contract

A normal tool result cannot create an inline application by returning arbitrary HTML. MSO exposes the MCP Apps contracts explicitly:

1. `resources/list` / `resources/read` expose `ui://…` resources with `text/html;profile=mcp-app`.
2. Model-visible tools bind a resource with `_meta.ui.resourceUri` plus the OpenAI compatibility alias `_meta["openai/outputTemplate"]`.
3. UI-capable tools declare `outputSchema` and return bounded `structuredContent`; ordinary `content` remains the model/client text fallback.
4. Sandboxed widgets read `window.openai.toolOutput`, may call only explicitly app-visible MSO tools through `window.openai.callTool`, and use `window.openai.openExternal` for the full dashboard.

Official references:

- <https://developers.openai.com/plugins/build/chatgpt-ui>
- <https://developers.openai.com/plugins/reference>

## MSO resources

| Experience | Entry tool | Resource | Refresh behavior |
| --- | --- | --- | --- |
| Workflow progress | `workflow_start` | `ui://mso/workflow-progress-v1.html` | app-only `workflow_status` |
| Project status | `project_get` | `ui://mso/project-status-v1.html` | widget calls `project_get` again |
| Git diff summary | `project_diff` | `ui://mso/project-diff-v1.html` | static result; request a new diff for changed state |
| VPS/operator status | `vps_status` | `ui://mso/vps-status-v1.html` | widget calls `vps_status` again |

Source boundaries:

| Contract | MSO source |
| --- | --- |
| Resource registry / workflow UI | `lib/mcp/ui-resources.ts` |
| Project/diff/VPS resources | `lib/mcp/ui-operator-resources.ts` |
| Resource capability / RPC | `lib/mcp/dispatch.ts` |
| Workflow structured schema | `lib/mcp/tools-workflow-start.ts`, `lib/mcp/tools-workflow-lifecycle.ts` |
| Project/diff structured schemas | `lib/mcp/tools-project-experience.ts` |
| VPS structured schema | `lib/mcp/tools-operator-dashboard.ts` |
| Shared descriptor contract | `lib/mcp/tool-kit.ts`, `lib/mcp/tool-contract.ts` |
| Tests | `lib/mcp/ui-resources.test.ts` |

## Data boundaries

The workflow component receives only workflow id, intent, resolved project label, timing, step count, and recent tool name/outcome/timestamp/duration. `workflow_status` is `ui.visibility:["app"]`, so polling is not another model action and is deliberately excluded from workflow-memory persistence.

The project component receives the safe `project_get` projection: project identity/path, bounded Git state, package metadata, Convex detection mode, project-MCP alias count, and knowledge existence/size. It does not receive `.mcp.json`, `.env.local`, provider tokens, project-MCP headers, or knowledge content.

The diff component receives only project/mode/SHA metadata, changed file names and aggregate additions/deletions. The unified diff remains in the tool's portable text result and is never interpolated into widget HTML.

The VPS component receives bounded health/process/app/browser state and **masked** infrastructure readiness. Provider values are those already sanitized by the infrastructure summary layer; raw credentials are never added for UI rendering.

All four resources are self-contained: no external JavaScript, CSS, images, or direct `fetch()` calls. `Open in MSO` uses the host navigation bridge to `https://mso.rahmanef.com`. The widget CSP has no connect/resource domains and allowlists only that dashboard redirect.

## Flow

```text
ChatGPT model
   │
   ├─ workflow_start ──→ workflow card ──→ workflow_status (app-only)
   ├─ project_get    ──→ project card  ──→ project_get refresh
   ├─ project_diff   ──→ diff card
   └─ vps_status     ──→ VPS card      ──→ vps_status refresh

Every entry tool also returns portable text/JSON for non-MCP-Apps clients.
```

## Dedicated UI origin

For the current custom connector, MSO intentionally leaves `_meta.ui.domain` unset so ChatGPT uses its default sandbox origin. The main dashboard is not reused as widget origin. Before an app-directory submission, provision a dedicated reviewed HTTPS widget origin and add it to `_meta.ui.domain` (plus the compatibility alias required by the target client at that time).

## Deployment / refresh

After a UI/schema release:

1. run `bun run verify` and a production build;
2. deploy through the normal MSO release path;
3. refresh/re-scan the ChatGPT development app so `initialize`, `tools/list`, and `resources/list` are read again;
4. verify each entry tool exposes `outputSchema` and `_meta.ui.resourceUri`;
5. verify each `resources/read` returns `text/html;profile=mcp-app`;
6. verify refresh buttons work and `workflow_status` polling does not enter learned workflow steps.

If ChatGPT still renders text only after a verified deployment, treat a stale app/action snapshot as the first suspect before changing the server again.
