# ChatGPT MCP App UI

MSO can render a first-party progress card inside ChatGPT instead of returning only tool-call text. The implementation follows the MCP Apps / OpenAI Apps SDK contract while keeping the existing JSON/text result as a backward-compatible fallback for MCP clients that do not render UI resources.

## What ChatGPT needs

A connector cannot create an inline card merely by returning HTML in a normal tool result. The MCP server must expose and connect four contracts:

1. **UI resource** — `resources/list` and `resources/read` expose a `ui://…` resource with MIME type `text/html;profile=mcp-app`.
2. **Tool → UI binding** — the tool descriptor points at that resource through `_meta.ui.resourceUri`. MSO also emits the compatibility alias `_meta["openai/outputTemplate"]`.
3. **Structured result** — the tool declares `outputSchema` and returns matching `structuredContent`; `content` remains as the portable text fallback.
4. **Widget bridge** — the sandboxed component reads `window.openai.toolOutput`, may call explicitly app-visible tools through `window.openai.callTool`, and can open the full MSO dashboard through `window.openai.openExternal`.

Official references:

- <https://developers.openai.com/plugins/build/chatgpt-ui>
- <https://developers.openai.com/plugins/reference>

## MSO implementation

| Contract | MSO source |
| --- | --- |
| Progress UI resource | `lib/mcp/ui-resources.ts` |
| Resource capability / RPC | `lib/mcp/dispatch.ts` |
| Tool descriptor + structured schemas | `lib/mcp/tools-learning.ts` |
| Shared tool schema type | `lib/mcp/tool-kit.ts` |
| Toolset signature | `lib/mcp/toolset.ts` |
| Tests | `lib/mcp/ui-resources.test.ts` |

`workflow_start` is the model-visible entry point. Its result renders `ui://mso/workflow-progress-v1.html` when the host supports MCP Apps.

The component then uses `workflow_status` to refresh the visible card. `workflow_status` is marked `ui.visibility: ["app"]` so it is a component bridge, not another model/operator action. Polling is deliberately excluded from MSO activity/workflow-step persistence; otherwise a four-second UI refresh would teach workflow memory a fake sequence made mostly of `workflow_status` calls.

## Data boundary

The progress component receives only:

- workflow id;
- intent and resolved project label;
- started time / elapsed time;
- step count;
- recent tool name, outcome, timestamp, and duration.

It does **not** receive tool arguments, shell commands, file contents, bearer tokens, API keys, credentials, or raw audit details. The existing workflow-memory redaction remains the authority for persisted workflow evidence.

The component is self-contained: no external JavaScript, CSS, images, or direct API fetches are required. `Open in MSO` uses the host navigation bridge to `https://mso.rahmanef.com` instead of sharing an authenticated browser session with the iframe.

## Dedicated UI origin

For the current custom connector, MSO intentionally leaves `_meta.ui.domain` unset so ChatGPT uses its default sandbox origin. The main dashboard origin is not reused as the widget origin.

Before submitting a UI-enabled MSO integration to the ChatGPT app directory, provision a dedicated HTTPS origin unique to the MSO widget and add that reviewed origin to `_meta.ui.domain` (plus the `openai/widgetDomain` compatibility alias if still required by the target client). Treat that as a release/submission configuration change rather than an arbitrary runtime environment knob.

The dashboard navigation target is separate: `openai/widgetCSP.redirect_domains` allowlists `https://mso.rahmanef.com` solely for the **Open in MSO** action.

## Expected ChatGPT flow

```text
ChatGPT
  └─ tools/call workflow_start
       ├─ content              -> text fallback
       ├─ structuredContent    -> initial workflow state
       └─ _meta.ui.resourceUri -> ui://mso/workflow-progress-v1.html
                                   └─ ChatGPT renders sandboxed card
                                        └─ callTool(workflow_status)
                                             └─ structuredContent -> card refresh
```

For a client without MCP App support, nothing breaks: it keeps reading `content[0].text` exactly as before.

## Deployment / refresh

After merging this change:

1. run the normal MSO verification pipeline (`bun run verify`);
2. deploy through the normal MSO release path;
3. reconnect or refresh the ChatGPT MSO connector so ChatGPT re-reads `initialize`, `tools/list`, and the resource capability;
4. start a multi-step request that routes through `workflow_start`;
5. verify that the card renders, recent steps advance without `workflow_status` appearing in the learned workflow, and **Open in MSO** opens the production dashboard.

If ChatGPT still shows only JSON/text after deployment, inspect `tools/list` first. `workflow_start` must expose both `outputSchema` and `_meta.ui.resourceUri`, and `resources/read` for that URI must return `text/html;profile=mcp-app`. A stale connector schema is the next likely cause; refresh/reconnect it before changing the server implementation.
