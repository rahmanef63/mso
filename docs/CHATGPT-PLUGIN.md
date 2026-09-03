# ChatGPT custom MCP app for MSO

> **Current ChatGPT-facing reference.** MSO is one open-source MCP server. ChatGPT receives a deliberately compact static projection of MSO-owned generic tools; project-owned MCP tool names are never copied into the global catalog or ChatGPT scan snapshot.
>
> ChatGPT's Developer Mode/App UI can change independently of MSO. Use the current OpenAI MCP/App documentation for exact menu labels, and use MSO Settings → MCP / `GET /mcp` for the live server/profile signatures.

<!-- mcp-chatgpt-profile: server=1.7.0 version=2026.09.03.4 tools=28 read=14 write=8 exec=6 app-only=1 total=29 -->

MSO server **1.7.0**, toolset **2026.09.03.4** exposes a full generic catalog for MCP clients, but a registered ChatGPT client receives only **29 transport tools**: **28 model/operator tools** (14 read, 8 write, 6 exec) plus app-only `workflow_status`.

The compact descriptor regression currently measures **31,908 JSON bytes** for all 29 ChatGPT tool definitions (roughly 8k tokens at a 4-byte/token estimate), with the largest individual descriptor **2,507 bytes**. CI keeps the profile below 40 KiB and each descriptor below 8 KiB. Bytes are the deterministic contract; token estimates vary by tokenizer.

## Why ChatGPT gets a compact profile

The full MSO catalog remains available to generic MCP clients. ChatGPT action scanning is different: it freezes names, titles, descriptions, JSON Schemas, safety annotations and security metadata into a cached action snapshot. Sending every internal MSO capability wastes scan/model context and makes refreshes more fragile.

MSO therefore applies a **client profile** after OAuth identity is known:

```text
full MCP client
  └─ full MSO catalog

ChatGPT
  └─ compact MSO catalog
       ├─ workflow / skill discovery
       ├─ files / visual proof
       ├─ bounded shell lifecycle
       ├─ durable session + Local Agents
       └─ generic dynamic project seams
```

The profile is fail-closed at both `tools/list` and `tools/call`: guessing a hidden full-catalog name returns `unknown tool`. This profile is a compatibility/context boundary, not a privilege escalation mechanism; the OAuth `read < write < exec` scope is still enforced independently.

## Tool metadata contract

Every advertised MSO tool has:

- a stable machine `name` owned by MSO;
- a human-readable `title`;
- a concise action-oriented `description`;
- bounded `inputSchema` (and `outputSchema` where structured output is used);
- explicit boolean `readOnlyHint`, `destructiveHint`, and `openWorldHint` annotations;
- optional `idempotentHint` where meaningful;
- matching top-level and `_meta.securitySchemes` OAuth metadata.

The ChatGPT projection compacts verbose descriptions/schema descriptions without changing names, required arguments, enum/range constraints, scopes, or safety semantics.

## Exact ChatGPT model tool profile

### `read` — 14 ChatGPT model tools

- `agent_session_current`
- `exec_job_status`
- `fs_list`
- `fs_read`
- `fs_search`
- `local_agent_inbox`
- `local_agent_request_wait`
- `local_agents_list`
- `project_capabilities`
- `projects_list`
- `read_pipeline`
- `screen_capture`
- `skills_read`
- `skills_search`

### `write` — + 8 ChatGPT model tools

- `agent_session_rename`
- `fs_upload_file`
- `fs_write`
- `local_agent_message_send`
- `local_agent_reply`
- `workflow_cancel`
- `workflow_finish`
- `workflow_start`

### `exec` — + 6 ChatGPT model tools

- `exec_job_cancel`
- `exec_job_start`
- `exec_run`
- `project_function_call`
- `project_mcp_call`
- `project_mcp_tools`

### App-only ChatGPT bridge

`workflow_status` is available to the MCP Apps progress UI but is not counted as a model/operator action.

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
7. Verify that the action snapshot corresponds to the 29-tool compact profile above.
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
