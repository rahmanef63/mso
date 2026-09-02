# MSO ↔ Connectors Gateway contract

> **Current MSO-side reference.** This file pins what **MSO** exposes. A gateway repository
> can evolve independently, so do not claim its mapping count is current without checking
> that repository at the time of the change.

<!-- mcp-toolset: server=1.6.0 version=2026.09.02.9 tools=69 read=33 write=24 exec=12 -->

MSO currently exposes MCP server **1.6.0**, toolset **2026.09.02.9**: **70 transport tools** total; **69 model/operator tools**
(33 read, 24 write, 12 exec) plus app-only `workflow_status`. `GET /mcp` exposes the live names, version/hash and scoped
manifest and is the machine-readable parity source.

## Local collaboration additions

Toolset `2026.09.02.7` tracks `local_agents_list`, `local_agent_message_send`, `local_agent_reply`, `local_agent_request_wait`, `local_agent_inbox`, `local_agent_request`, and `agent_subagent_run`. A gateway should preserve these literal names if it chooses to expose them. The six `local_agent_*`/`local_agents_list` tools address durable same-principal MSO sessions; `agent_subagent_run` is a foreground same-session worker and must not be modeled as a remote A2A registration or long-lived peer.

Toolset `2026.09.02.8` introduced RASMIC's `project_memory_search`, `project_memory_upsert`, and `project_script_run`; toolset `2026.09.02.9` keeps those three names stable while extending `project_memory_search` with `search | related | timeline` views and the catalog-first runtime. A gateway may expose these literal names, but must preserve their MSO scopes and must not reinterpret repo-local `.agent` records as gateway-owned/global memory.

## Why this contract matters

Connector/gateway manifests commonly bind an action to an MSO tool with a literal upstream
name such as:

```json
{ "id": "mso.fs.delete", "x-upstream": "fs_delete" }
```

Renaming/removing an MSO tool can therefore break a gateway without a TypeScript error in
either repository. `lib/mcp/parity.test.ts` covers MSO MCP ↔ Alfa intent, not an external
gateway's literal strings.

Before changing an MCP tool name:

1. inspect the live `GET /mcp` manifest;
2. search the gateway's connector manifest for the exact upstream string;
3. decide whether the external action is renamed, migrated or intentionally dropped;
4. update both repos in a coordinated release if necessary;
5. refresh/re-scan connected ChatGPT/custom apps because action definitions are cached.

## Current MSO catalog

### Read (33 model/operator)

`a2a_agent_discover`, `a2a_agents_list`, `a2a_task_get`, `agent_memory_read`, `agent_memory_search`, `agent_session_current`, `agent_session_resume`, `agent_sessions_list`, `apps_list`, `apps_logs`, `browser_status`, `cloudflare_zones_list`, `dokploy_projects_list`, `exec_job_status`, `fs_list`, `fs_read`, `fs_search`, `fs_usage`, `infra_provider_doctor`, `infra_providers_list`, `local_agent_inbox`, `local_agent_request_wait`, `local_agents_list`, `project_capabilities`, `project_memory_search`, `projects_list`, `screen_capture`, `skills_list`, `skills_read`, `skills_search`, `sys_processes`, `sys_stats`, `tool_forge_candidates`.

### Write (24 beyond read)

`a2a_agent_register`, `a2a_agent_remove`, `agent_memory_forget`, `agent_memory_remember`, `agent_session_note`, `agent_session_rename`, `apps_power`, `cloudflare_dns_upsert`, `dokploy_project_ensure`, `fs_copy`, `fs_delete`, `fs_mkdir`, `fs_move`, `fs_upload_file`, `fs_write`, `hostinger_dns_upsert`, `local_agent_message_send`, `local_agent_reply`, `project_memory_upsert`, `project_script_run`, `tool_forge_propose`, `workflow_cancel`, `workflow_finish`, `workflow_start`.

### Exec (12 beyond write)

`a2a_handoff`, `a2a_message_send`, `a2a_task_cancel`, `agent_subagent_run`, `browser_power`, `exec_job_cancel`, `exec_job_start`, `exec_run`, `local_agent_request`, `project_function_call`, `tool_forge_evaluate`, `tool_forge_promote`.

### App-only bridge (1)

`workflow_status` is exposed for the MCP Apps progress widget and is not part of the model/operator action catalog.

A2A adds eight stable generic MCP action names rather than one action per peer. A gateway should pass
the registered alias/id or public Agent Card URL as the `target`; it must not synthesize hidden
conversation context. Current MSO supports anonymous outbound peers plus private API-key/Bearer/OAuth2
credential profiles, streaming task operations, and an optional authenticated inbound A2A server when an
explicit public HTTPS origin exists. Full trust/credential semantics live in [`A2A.md`](./A2A.md).

## Scope and workflow compatibility

The MSO scope ladder (`read < write < exec`) is the server permission boundary. A gateway
may add stricter approvals/policy, but it must not assume that hiding an action changes the
MSO bearer scope.

Operational MCP tools also accept optional `workflow_id`. A gateway that does not expose
that field can still call the tools, but those calls are standalone and will not join an
MSO learned workflow. For multi-step orchestration, expose the workflow trio and propagate
the exact id returned by `workflow_start`.


Tool Forge remains a stable global action family as well: gateways should expose the four generic `tool_forge_*` names, never synthesize one action per generated candidate. Candidate ids are data. Executable evaluation is server-side in the dedicated local Docker sandbox, and promotion remains exec-scope with exact confirmation.

## Project functions are data, not dynamic MCP names

A project may publish `.mso/functions.json`. The gateway does not need a new MSO action for
each project function: it calls `project_capabilities` to see validated public schemas and
`project_function_call` to run one at exec scope. This is intentional so switching projects
does not change the global MCP tool prefix.

`.mcp.json` is different: MSO reports presence only and never returns its contents or
implicitly connects to an arbitrary project's MCP server.

## ChatGPT file parameters

`fs_upload_file` uses OpenAI MCP metadata `openai/fileParams` on its top-level `file`
parameter. A generic gateway that cannot preserve that metadata may still proxy ordinary
MSO JSON actions, but it cannot manufacture the ChatGPT-provided temporary file object from
a string path. Preserve metadata if file import parity is required.

## Security-sensitive mapped actions

Treat these as particularly important in any external approval layer:

- `fs_delete` / `fs_write` / `fs_upload_file` — host data mutation;
- `apps_power` — bounded daemon control and state backup;
- `exec_run` — host shell as the MSO user;
- `browser_power` — starts a browser profile with live logged-in sessions;
- `project_function_call` — executes project-owned fixed argv and is always exec-scope;
- `tool_forge_evaluate` / `tool_forge_promote` — sandbox-evaluate and explicitly promote inert learned-workflow candidates; promotion requires a fresh passing evaluation and literal confirmation;
- `dokploy_project_ensure` / `cloudflare_dns_upsert` / `hostinger_dns_upsert` — mutate external infrastructure with provider credentials kept server-side; Hostinger receives only the requested name/type RR-set (`overwrite:true`), never an MSO-generated full-zone snapshot.

External policy supplements MSO's own scope/path/audit/rate-limit checks; it does not replace
them.

## Removed names

Provider-backed MSO image generation was removed on 2026-08-20. Do not map
`image_generation_status` or `image_generate`. A GPT/ChatGPT client should use its native
image capability and, when needed, transfer the resulting file through `fs_upload_file`.

## Verification

For an integration update, compare the gateway's literal upstream names with:

```text
GET https://<mso-origin>/mcp
```

Then run MSO's MCP parity/global-tool tests and the gateway's own connector-contract tests.
Do not infer external-gateway parity merely because MSO's internal tests are green.


### Bounded asynchronous execution

`exec_job_start` starts a client/workflow-bound command that may run up to 20 minutes; `exec_job_status` reads its bounded output and final exit state; `exec_job_cancel` stops a still-running job. Use this trio for test/build pipelines instead of wrapping `exec_run` in host-specific background-process plumbing.
