# Generated MCP catalog

> **Generated file — do not edit manually.** Source of truth: `lib/mcp/tools.ts`, its registered `tools-*` modules, `lib/mcp/toolset.ts`, and the compact ChatGPT name set in `lib/mcp/tool-contract.ts`. Regenerate with `node scripts/gen-mcp-catalog.mjs`. The live deployed authority remains `GET /mcp`.

## Full MSO catalog

<!-- mcp-toolset: server=1.12.0 version=2026.09.05.5 tools=89 read=44 write=26 exec=19 -->

| Fact | Current source value |
|---|---:|
| MCP server | `1.12.0` |
| Toolset | `2026.09.05.5` |
| Toolset changed at | `2026-09-05T12:32:00Z` |
| Transport tools | **91** |
| Model/operator tools | **89** |
| Read | **44** |
| Write | **26** |
| Exec | **19** |
| App-only bridges | **2** |

### Read (44)

- `a2a_agent_discover`
- `a2a_agents_list`
- `a2a_task_get`
- `agent_memory_read`
- `agent_memory_search`
- `agent_session_current`
- `agent_session_resume`
- `agent_sessions_list`
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
- `mso_surface_apps_list`
- `project_agent_status`
- `project_capabilities`
- `project_changes_list`
- `project_diff`
- `project_get`
- `project_knowledge_get`
- `project_memory_search`
- `projects_list`
- `read_pipeline`
- `render_mso_block`
- `render_mso_page`
- `screen_capture`
- `skills_list`
- `skills_read`
- `skills_search`
- `sys_processes`
- `sys_stats`
- `tool_forge_candidates`
- `vps_status`

### Write (26)

- `a2a_agent_register`
- `a2a_agent_remove`
- `agent_memory_forget`
- `agent_memory_remember`
- `agent_session_note`
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
- `integration_setup_open`
- `local_agent_message_send`
- `local_agent_reply`
- `project_knowledge_set`
- `project_memory_upsert`
- `project_script_run`
- `tool_forge_propose`
- `workflow_cancel`
- `workflow_finish`
- `workflow_start`

### Exec (19)

- `a2a_handoff`
- `a2a_message_send`
- `a2a_task_cancel`
- `agent_subagent_run`
- `browser_power`
- `exec_job_cancel`
- `exec_job_start`
- `exec_run`
- `local_agent_request`
- `project_agent_run`
- `project_database_call`
- `project_database_query`
- `project_database_status`
- `project_database_tools`
- `project_function_call`
- `project_mcp_call`
- `project_mcp_tools`
- `tool_forge_evaluate`
- `tool_forge_promote`

### App-only bridges (2)

- `render_mso_surface`
- `workflow_status`

## ChatGPT static profile

<!-- mcp-chatgpt-profile: server=1.12.0 version=2026.09.05.5 tools=65 read=35 write=18 exec=12 app-only=2 total=67 -->

The ChatGPT profile is a fail-closed static projection defined by `CHATGPT_TOOL_NAMES`. OAuth scope is still enforced independently; project-owned MCP tool names remain dynamic data behind the generic project bridge.

| Fact | Current source value |
|---|---:|
| ChatGPT transport tools | **67** |
| ChatGPT model/operator tools | **65** |
| Read | **35** |
| Write | **18** |
| Exec | **12** |
| App-only bridges | **2** |

### ChatGPT read (35)

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
- `mso_surface_apps_list`
- `project_agent_status`
- `project_capabilities`
- `project_changes_list`
- `project_diff`
- `project_get`
- `project_knowledge_get`
- `projects_list`
- `read_pipeline`
- `render_mso_block`
- `render_mso_page`
- `screen_capture`
- `skills_list`
- `skills_read`
- `skills_search`
- `sys_processes`
- `sys_stats`
- `vps_status`

### ChatGPT write (18)

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
- `integration_setup_open`
- `local_agent_message_send`
- `local_agent_reply`
- `project_knowledge_set`
- `workflow_cancel`
- `workflow_finish`
- `workflow_start`

### ChatGPT exec (12)

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

### ChatGPT app-only bridges (2)

- `render_mso_surface`
- `workflow_status`
