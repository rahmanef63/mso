# Generated MCP catalog

> **Generated file — do not edit manually.** Source of truth: `lib/mcp/tools.ts`, its registered `tools-*` modules, `lib/mcp/toolset.ts`, and the ChatGPT app-only exclusions in `lib/mcp/tool-contract.ts`. Regenerate with `node scripts/gen-mcp-catalog.mjs`. The live deployed authority remains `GET /mcp`.

## Full MSO catalog

<!-- mcp-toolset: server=1.13.0 version=2026.09.12.1 tools=104 read=49 write=34 exec=21 -->

| Fact | Current source value |
|---|---:|
| MCP server | `1.13.0` |
| Toolset | `2026.09.12.1` |
| Toolset changed at | `2026-09-12T12:55:00Z` |
| Transport tools | **106** |
| Model/operator tools | **104** |
| Read | **49** |
| Write | **34** |
| Exec | **21** |
| App-only bridges | **2** |

### Read (49)

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
- `dokploy_applications_list`
- `dokploy_projects_list`
- `exec_job_status`
- `flow_catalog`
- `flow_status`
- `fs_list`
- `fs_read`
- `fs_search`
- `fs_usage`
- `infra_provider_doctor`
- `infra_providers_list`
- `integration_query`
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
- `session_artifacts`
- `skills_list`
- `skills_read`
- `skills_search`
- `sys_processes`
- `sys_stats`
- `tool_forge_candidates`
- `vps_status`

### Write (34)

- `a2a_agent_register`
- `a2a_agent_remove`
- `agent_memory_forget`
- `agent_memory_remember`
- `agent_session_note`
- `agent_session_open`
- `agent_session_rename`
- `apps_power`
- `cloudflare_dns_upsert`
- `dokploy_application_public_env_upsert`
- `dokploy_project_ensure`
- `flow_manage`
- `fs_copy`
- `fs_delete`
- `fs_mkdir`
- `fs_move`
- `fs_upload_file`
- `fs_write`
- `hostinger_dns_upsert`
- `integration_manage`
- `integration_setup_open`
- `local_agent_message_send`
- `local_agent_reply`
- `project_asset_attach`
- `project_knowledge_set`
- `project_mcp_manage`
- `project_memory_upsert`
- `project_script_run`
- `session_artifact_register`
- `session_artifacts_cleanup`
- `tool_forge_propose`
- `workflow_cancel`
- `workflow_finish`
- `workflow_start`

### Exec (21)

- `a2a_handoff`
- `a2a_message_send`
- `a2a_task_cancel`
- `agent_subagent_run`
- `browser_power`
- `exec_job_cancel`
- `exec_job_start`
- `exec_run`
- `flow_run`
- `integration_execute`
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

## ChatGPT model profile

<!-- mcp-chatgpt-profile: server=1.13.0 version=2026.09.12.1 tools=104 read=49 write=34 exec=21 app-only=2 total=106 -->

The ChatGPT profile automatically projects the complete MSO-owned generic model/operator catalog. OAuth scope is still enforced independently; app-only compatibility bridges stay app-only, and project-owned MCP tool names remain dynamic data behind the generic project bridge.

| Fact | Current source value |
|---|---:|
| ChatGPT transport tools | **106** |
| ChatGPT model/operator tools | **104** |
| Read | **49** |
| Write | **34** |
| Exec | **21** |
| App-only bridges | **2** |

### ChatGPT read (49)

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
- `dokploy_applications_list`
- `dokploy_projects_list`
- `exec_job_status`
- `flow_catalog`
- `flow_status`
- `fs_list`
- `fs_read`
- `fs_search`
- `fs_usage`
- `infra_provider_doctor`
- `infra_providers_list`
- `integration_query`
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
- `session_artifacts`
- `skills_list`
- `skills_read`
- `skills_search`
- `sys_processes`
- `sys_stats`
- `tool_forge_candidates`
- `vps_status`

### ChatGPT write (34)

- `a2a_agent_register`
- `a2a_agent_remove`
- `agent_memory_forget`
- `agent_memory_remember`
- `agent_session_note`
- `agent_session_open`
- `agent_session_rename`
- `apps_power`
- `cloudflare_dns_upsert`
- `dokploy_application_public_env_upsert`
- `dokploy_project_ensure`
- `flow_manage`
- `fs_copy`
- `fs_delete`
- `fs_mkdir`
- `fs_move`
- `fs_upload_file`
- `fs_write`
- `hostinger_dns_upsert`
- `integration_manage`
- `integration_setup_open`
- `local_agent_message_send`
- `local_agent_reply`
- `project_asset_attach`
- `project_knowledge_set`
- `project_mcp_manage`
- `project_memory_upsert`
- `project_script_run`
- `session_artifact_register`
- `session_artifacts_cleanup`
- `tool_forge_propose`
- `workflow_cancel`
- `workflow_finish`
- `workflow_start`

### ChatGPT exec (21)

- `a2a_handoff`
- `a2a_message_send`
- `a2a_task_cancel`
- `agent_subagent_run`
- `browser_power`
- `exec_job_cancel`
- `exec_job_start`
- `exec_run`
- `flow_run`
- `integration_execute`
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

### ChatGPT app-only bridges (2)

- `render_mso_surface`
- `workflow_status`
