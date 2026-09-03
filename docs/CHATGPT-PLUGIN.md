# ChatGPT custom MCP app for MSO

> **Current ChatGPT-facing reference.** MSO is one open-source MCP server. ChatGPT receives a deliberately compact static projection of MSO-owned generic tools; project-owned MCP tool names are never copied into the global catalog or ChatGPT scan snapshot.
>
> ChatGPT's Developer Mode/App UI can change independently of MSO. Use the current OpenAI MCP/App documentation for exact menu labels, and use MSO Settings → MCP / `GET /mcp` for the live server/profile signatures.

<!-- mcp-chatgpt-profile: server=1.8.1 version=2026.09.03.6 tools=61 read=32 write=17 exec=12 app-only=1 total=62 -->

MSO server **1.8.1**, toolset **2026.09.03.6** exposes the full generic catalog for MCP clients, while a registered ChatGPT client receives **62 transport tools**: **61 model/operator tools** (32 read, 17 write, 12 exec) plus app-only `workflow_status`.

Browser-hosted MCP probes from ChatGPT are allowed only when they target the configured public `OS_PUBLIC_ORIGIN`; arbitrary origins and ChatGPT-origin requests aimed at loopback remain denied. Additional trusted browser hosts can be added explicitly with comma-separated `OS_MCP_BROWSER_ORIGINS`. Public OAuth discovery and DCR responses carry CORS metadata; authenticated `/mcp` echoes only an approved exact origin.

The compact descriptor regression currently measures **64,180 JSON bytes** for all 62 ChatGPT transport tool definitions (roughly 16.0k tokens at a 4-byte/token estimate), with the largest individual descriptor **2,615 bytes**. CI keeps the profile below 72 KiB and each descriptor below 8 KiB. Bytes are the deterministic contract; token estimates vary by tokenizer.

## Why ChatGPT gets a compact profile

The full MSO catalog remains available to generic MCP clients. ChatGPT action scanning is different: it freezes names, titles, descriptions, JSON Schemas, safety annotations and security metadata into a cached action snapshot. Sending every internal MSO capability wastes scan/model context and makes refreshes more fragile.

MSO therefore applies a **client profile** after OAuth identity is known:

```text
full MCP client
  └─ full MSO catalog

ChatGPT
  └─ compact capability-complete MSO operator catalog
       ├─ workflow / skills / durable sessions / Local Agents
       ├─ bounded VPS + filesystem CRUD + managed apps + browser
       ├─ explicit bounded infrastructure operations
       ├─ project snapshot / diff / knowledge / project-agent tasks
       ├─ Convex status + dynamic Convex MCP schemas/calls
       ├─ MCP Apps UI for workflow, project, diff and VPS
       └─ dynamic project MCP/function seams for project-owned tools
```

The profile is fail-closed at both `tools/list` and `tools/call`: guessing a hidden full-catalog name returns `unknown tool`. This profile is a compatibility/context boundary, not a privilege escalation mechanism; the OAuth `read < write < exec` scope is still enforced independently.

## Tool metadata contract

Every advertised MSO tool has:

- a stable machine `name` owned by MSO;
- a human-readable `title`;
- a concise action-oriented `description`;
- bounded `inputSchema` and an `outputSchema` for every ChatGPT action; UI/critical tools use typed schemas while dynamic tools share one exact `{ result }` envelope;
- explicit boolean `readOnlyHint`, `destructiveHint`, and `openWorldHint` annotations;
- optional `idempotentHint` where meaningful;
- matching top-level and `_meta.securitySchemes` OAuth metadata.

The ChatGPT projection compacts verbose descriptions/schema descriptions without changing names, required arguments, enum/range constraints, scopes, or safety semantics.

## Exact ChatGPT model tool profile

### `read` — 32 ChatGPT model tools

- `agent_session_current`
- `apps_list`
- `apps_logs`
- `browser_status`
- `cloudflare_zones_list`
- `connections_list`
- `dokploy_projects_list`
- `exec_job_status`
- `fs_list`
- `fs_read`
- `fs_search`
- `fs_usage`
- `infra_provider_doctor`
- `infra_providers_list`
- `local_agent_inbox`
- `local_agent_request_wait`
- `local_agents_list`
- `project_agent_status`
- `project_capabilities`
- `project_changes_list`
- `project_diff`
- `project_get`
- `project_knowledge_get`
- `projects_list`
- `read_pipeline`
- `screen_capture`
- `skills_list`
- `skills_read`
- `skills_search`
- `sys_processes`
- `sys_stats`
- `vps_status`

### `write` — + 17 ChatGPT model tools

- `agent_session_rename`
- `apps_power`
- `cloudflare_dns_upsert`
- `dokploy_project_ensure`
- `fs_copy`
- `fs_delete`
- `fs_mkdir`
- `fs_move`
- `fs_upload_file`
- `fs_write`
- `hostinger_dns_upsert`
- `local_agent_message_send`
- `local_agent_reply`
- `project_knowledge_set`
- `workflow_cancel`
- `workflow_finish`
- `workflow_start`

### `exec` — + 12 ChatGPT model tools

- `browser_power`
- `exec_job_cancel`
- `exec_job_start`
- `exec_run`
- `project_agent_run`
- `project_database_call`
- `project_database_query`
- `project_database_status`
- `project_database_tools`
- `project_function_call`
- `project_mcp_call`
- `project_mcp_tools`

### App-only ChatGPT bridge

`workflow_status` is available to the MCP Apps progress UI but is not counted as a model/operator action.

The restored Original MSO operator primitives (`sys_*`, `fs_usage` + full bounded filesystem CRUD, `apps_*`, browser power/status, and Dokploy/Cloudflare/Hostinger operations) are again first-class ChatGPT actions. Fresh 3 adds `vps_status`, project snapshot/diff/history/knowledge, private project-agent message/status, connection inventory, and Convex database seams without removing the lower-level primitives. This is intentional: aggregate tools optimize common turns; bounded primitives preserve direct operator control.

Project-owned MCP names and Convex's own dynamic schemas still load on demand through `project_mcp_tools` / `project_mcp_call` and `project_database_tools` / `project_database_call`. That is how MSO keeps a 61-action static model profile instead of copying every downstream provider/project action into ChatGPT.

### Structured-result contract

After the Fresh 3 rescan exposed `Output schema recommended` on non-UI actions, the ChatGPT profile now advertises an output schema on **all 62 transport actions** without duplicating dozens of provider/project result definitions. Tools with stable UI-critical shapes keep their explicit typed schemas. Every other ChatGPT action uses one exact outer `{ result: ... }` contract and returns the already-bounded JSON value inside `structuredContent.result`; its text `content` is a short acknowledgement so the same payload is not duplicated in the conversation transcript. Full/generic MCP clients keep the historical text-only contract unless a tool explicitly declares structured output. `screen_capture` keeps the image in MCP content and exposes only safe dimensions/URLs/expiry metadata in the structured envelope—never base64 image bytes.

### Native MCP skill snapshot

Fresh 3 also advertises the bounded `io.modelcontextprotocol/skills` extension. `skills/list`, `skills/get`, and `resources/read` publish a submission-time snapshot of exactly five general official MSO skills: `mso`, `mso-repo-work`, `mso-service-debug`, `mso-deploy`, and `mso-mcp-feature-engineering`. The manifest is generated from `claude-skills/`, includes complete resources plus `sha256:` digests, refuses symlinks/path normalization conflicts/oversize files, and never publishes operator, project, verified-third-party, or untrusted skill roots. The ordinary `skills_search/list/read` actions remain the live runtime catalog for the rest.

For the complete non-ChatGPT MSO catalog, scopes, limits, A2A, providers, Tool Forge and other generic capabilities, see [`MCP.md`](./MCP.md).

## Dynamic project capabilities without global project tools

MSO is generic and must not publish another project's MCP tool names.

`project_capabilities(project)` returns only safe project capability metadata. For a project `.mcp.json`, it exposes **server aliases, transport kind and auth class only** — never config contents, env values, headers, tokens or project MCP tool names.

Then:

```text
projects_list
   ↓
project_capabilities
   ↓
project_mcp_tools(project, server)   # exec: initializing project MCP executes project code
   ↓
project_mcp_call(project, server, tool, arguments)
```

`project_mcp_tools` starts/connects only the explicitly selected project server and returns its tool schemas on demand. `project_mcp_call` executes one exact dynamic tool. Those dynamic names remain data and never change MSO's global toolset hash or ChatGPT scan snapshot.

Supported KISS bridge modes:

- **stdio project MCP** — fixed command/argv from the project's `.mcp.json`, no shell; cwd must stay inside the selected project; child environment starts from MSO's credential-scrubbed environment plus only project-declared env;
- **remote HTTP MCP** — guarded HTTPS transport with DNS-rebinding/SSRF checks and bounded responses; static project-config headers stay server-side;
- **project OAuth MCP** — reported as `auth=oauth` but fails closed unless that project has an explicit server-side authorization configuration. MSO never copies, invents or exposes another project's OAuth credential implicitly.

Project `.mso/functions.json` remains a separate generic seam: `project_capabilities` returns public function schemas and `project_function_call` executes one fixed-argv function at exec scope.

## Local Agent two-way ChatGPT sessions

Each ChatGPT conversation is bound to a separate durable MSO AgentSession using a privacy-safe hash of the host conversation id. Raw ChatGPT conversation ids are not persisted.

The compact profile includes:

- `local_agents_list`
- `local_agent_message_send`
- `local_agent_inbox`
- `local_agent_reply`
- `local_agent_request_wait`

`local_agent_inbox(wait_ms=1..20000)` keeps only the current foreground MCP request open, registers the existing in-process Local Agent receiver, and returns early when another same-principal session sends a message. Durable file-backed mailbox state remains authoritative and closes the read→subscribe race. There is no DB, webhook, broker, WebSocket or spawned worker in this path.

A completely idle ChatGPT conversation still cannot be awakened by a remote MCP server. Its durable mail is delivered on its next MCP call. `local_agent_request` and `agent_subagent_run` remain full-catalog worker primitives and are intentionally not part of the compact ChatGPT profile.

## OAuth contract

For origin `https://mso.example.com`:

| Purpose | URL |
|---|---|
| MCP server/resource | `https://mso.example.com/mcp` |
| OAuth authorization | `https://mso.example.com/oauth/authorize` |
| OAuth token | `https://mso.example.com/oauth/token` |
| Dynamic client registration | `https://mso.example.com/oauth/register` |
| Authorization-server metadata | `https://mso.example.com/.well-known/oauth-authorization-server` |
| Protected-resource metadata | `https://mso.example.com/.well-known/oauth-protected-resource` |

MSO OAuth uses authorization code + PKCE S256 for public clients and supports rotating refresh tokens. New OAuth grants are bound to the exact `resource=https://<origin>/mcp` throughout authorization, code exchange, refresh and MCP bearer validation.

New OAuth access tokens are short-lived (1 hour); refresh credentials rotate and expire after 90 days. Authorization codes are single-use and expire after 60 seconds. Access tokens, refresh tokens and authorization codes are stored only as SHA-256 hashes. Revoking one access token revokes its OAuth grant family, including refresh credentials.

Legacy MSO bearers minted before resource binding remain accepted during migration until they expire/revoke. A fresh ChatGPT reauthorization receives the new resource-bound/refreshable contract.

## Streamable HTTP contract

MSO uses Streamable HTTP JSON-RPC over `POST /mcp`.

- `initialize` negotiates a supported MCP protocol version;
- subsequent requests may send `MCP-Protocol-Version`; unsupported versions fail before dispatch;
- the optional `GET /mcp` SSE listener is **not implemented**, so `Accept: text/event-stream` returns `405 Method Not Allowed`, as required when a Streamable HTTP server does not provide that listener;
- non-SSE `GET /mcp` remains an operator diagnostics endpoint showing the full and ChatGPT toolset signatures;
- browser `Origin` validation remains enabled to prevent DNS-rebinding access to local MCP listeners.

## Setup / refresh sequence

1. Deploy MSO over reachable HTTPS and enable MCP (`OS_MCP_ENABLED=1`).
2. Set the maximum bearer scope intentionally with `OS_MCP_MAX_SCOPE=read|write|exec`.
3. In ChatGPT Developer Mode / Apps, create or edit the MSO custom MCP app using the `/mcp` URL.
4. Choose OAuth and complete the MSO consent flow on an approved owner device.
5. Select the lowest useful MSO tier.
6. Run **Scan Tools / Refresh** in ChatGPT.
7. Verify that the action snapshot corresponds to the 62-tool transport profile (61 model actions + app-only `workflow_status`) above.
8. Start a new chat when testing a newly scanned draft/action snapshot.

After a schema/profile change, changing production code alone does not replace ChatGPT's frozen action snapshot. Refresh/re-scan (or recreate/republish where the workspace UI requires it) after deployment.

## Troubleshooting Scan Tools

If Scan Tools fails, validate in this order:

1. both OAuth `.well-known` documents return `200` over public HTTPS;
2. authorization redirects back with matching `state` and `iss`;
3. authorization/token requests preserve the exact `/mcp` `resource`;
4. the access token is accepted by `POST /mcp`;
5. `initialize` and scoped `tools/list` succeed;
6. every tool has title + required safety annotations + matching security schemes;
7. the ChatGPT descriptor set stays under the in-repo budget gate;
8. `GET /mcp` with `Accept:text/event-stream` returns 405 rather than JSON pretending to be an SSE stream;
9. the ChatGPT app was actually refreshed/re-scanned after the latest toolset signature changed.

The live diagnostic `GET /mcp` returns both `toolset` (full MSO) and `chatgptToolset` signatures so profile drift is visible without exposing credentials.

## Security boundaries

- MCP tokens never grant SSH/Linux credentials; they authorize MSO tools only.
- `exec_run`, project functions and dynamic project MCP calls require exec scope.
- Project MCP config/env/header values are never model-visible.
- MSO credentials are scrubbed before child project processes; project-declared env is a project-owned boundary.
- File operations retain MSO path-root and credential-path guards.
- Remote HTTP project MCP calls retain MSO's public-address / SSRF / DNS-rebinding guard.
- Tool hiding is not a substitute for scope checks; list-time and call-time scope enforcement both remain mandatory.
- Hidden ChatGPT transcript, private chain-of-thought and credentials are never copied into Local Agent/project MCP messages.
