# MSO ↔ Connectors Gateway contract

> **Current MSO-side reference.** This file pins what **MSO** exposes. A gateway repository
> can evolve independently, so do not claim its mapping count is current without checking
> that repository at the time of the change.

<!-- mcp-toolset: server=1.6.0 version=2026.08.21.1 tools=28 read=15 write=10 exec=3 -->

MSO currently exposes MCP server **1.6.0**, toolset **2026.08.21.1**: **28 tools**
(15 read, 10 write, 3 exec). `GET /mcp` exposes the live names, version/hash and scoped
manifest and is the machine-readable parity source.

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

### Read (15)

`fs_list`, `fs_read`, `fs_search`, `fs_usage`, `sys_stats`, `sys_processes`,
`apps_list`, `apps_logs`, `browser_status`, `projects_list`, `project_capabilities`,
`skills_list`, `skills_read`, `skills_search`, `screen_capture`.

### Write (10 beyond read)

`fs_write`, `fs_upload_file`, `fs_mkdir`, `fs_move`, `fs_copy`, `fs_delete`,
`apps_power`, `workflow_start`, `workflow_cancel`, `workflow_finish`.

### Exec (3 beyond write)

`exec_run`, `browser_power`, `project_function_call`.

## Scope and workflow compatibility

The MSO scope ladder (`read < write < exec`) is the server permission boundary. A gateway
may add stricter approvals/policy, but it must not assume that hiding an action changes the
MSO bearer scope.

Operational MCP tools also accept optional `workflow_id`. A gateway that does not expose
that field can still call the tools, but those calls are standalone and will not join an
MSO learned workflow. For multi-step orchestration, expose the workflow trio and propagate
the exact id returned by `workflow_start`.

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
- `project_function_call` — executes project-owned fixed argv and is always exec-scope.

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
