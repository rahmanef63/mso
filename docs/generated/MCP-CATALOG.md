# Generated MCP catalog

> **Generated file — do not edit manually.** Source of truth: `lib/mcp/tools.ts`, its registered `tools-*` modules, `lib/mcp/toolset.ts`, and the ChatGPT app-only exclusions in `lib/mcp/tool-contract.ts`. Regenerate with `node scripts/gen-mcp-catalog.mjs`. The live deployed authority remains `GET /mcp`.

## Full MSO catalog

<!-- mcp-toolset: server=1.17.0 version=2026.10.18.3 tools=127 read=62 write=39 exec=26 -->

| Fact | Current source value |
|---|---:|
| MCP server | `1.17.0` |
| Toolset | `2026.10.18.3` |
| Toolset changed at | `2026-10-18T13:24:00+00:00` |
| Transport tools | **129** |
| Model/operator tools | **127** |
| Read | **62** |
| Write | **39** |
| Exec | **26** |
| App-only bridges | **2** |

### Read (62)

- `a2a_agent_discover`
- `a2a_agents_list`
- `a2a_task_get`
- `agent_memory_read`
- `agent_memory_search`
- `agent_session_action_resolve`
- `agent_session_current`
- `agent_session_flow`
- `agent_session_resume`
- `agent_sessions_list`
- `agent_subagent_status`
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
- `fs_export_file`
- `fs_glob`
- `fs_grep`
- `fs_list`
- `fs_read`
- `fs_search`
- `fs_stat`
- `fs_usage`
- `infra_provider_doctor`
- `infra_providers_list`
- `integration_query`
- `jev_action`
- `local_agent_inbox`
- `local_agent_request_wait`
- `local_agents_list`
- `mso_native_ui_probe`
- `mso_surface_apps_list`
- `organization_chart`
- `project_agent_status`
- `project_agent_vault_read`
- `project_candidate_search`
- `project_capabilities`
- `project_changes_list`
- `project_diff`
- `project_get`
- `project_knowledge_get`
- `project_memory_search`
- `projects_list`
- `read_pipeline`
- `render_mso_block`
- `render_mso_list`
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

### Write (39)

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
- `fs_edit`
- `fs_mkdir`
- `fs_move`
- `fs_upload_file`
- `fs_write`
- `hostinger_dns_upsert`
- `integration_manage`
- `integration_setup_open`
- `local_agent_inbox_acknowledge`
- `local_agent_message_send`
- `local_agent_reply`
- `organization_manage`
- `project_agent_vault_sync`
- `project_asset_attach`
- `project_knowledge_set`
- `project_mcp_manage`
- `project_memory_upsert`
- `project_script_run`
- `session_artifact_register`
- `session_artifacts_cleanup`
- `todo_write`
- `tool_forge_propose`
- `workflow_cancel`
- `workflow_finish`
- `workflow_start`

### Exec (26)

- `a2a_handoff`
- `a2a_message_send`
- `a2a_task_cancel`
- `agent_subagent_cancel`
- `agent_subagent_run`
- `agent_subagent_start`
- `browser_power`
- `exec_job_cancel`
- `exec_job_start`
- `exec_run`
- `flow_run`
- `integration_execute`
- `local_agent_request`
- `local_agent_standby`
- `project_agent_run`
- `project_database_call`
- `project_database_query`
- `project_database_status`
- `project_database_tools`
- `project_function_call`
- `project_mcp_call`
- `project_mcp_tools`
- `pty_session`
- `tool_forge_evaluate`
- `tool_forge_promote`
- `workflow_graph`

### App-only bridges (2)

- `render_mso_surface`
- `workflow_status`

## ChatGPT model profile

<!-- mcp-chatgpt-profile: server=1.17.0 version=2026.10.18.3 tools=127 read=62 write=39 exec=26 app-only=2 total=129 -->

The ChatGPT profile automatically projects the complete MSO-owned generic model/operator catalog. OAuth scope is still enforced independently; app-only compatibility bridges stay app-only, and project-owned MCP tool names remain dynamic data behind the generic project bridge.

| Fact | Current source value |
|---|---:|
| ChatGPT transport tools | **129** |
| ChatGPT model/operator tools | **127** |
| Read | **62** |
| Write | **39** |
| Exec | **26** |
| App-only bridges | **2** |

### ChatGPT read (62)

- `a2a_agent_discover`
- `a2a_agents_list`
- `a2a_task_get`
- `agent_memory_read`
- `agent_memory_search`
- `agent_session_action_resolve`
- `agent_session_current`
- `agent_session_flow`
- `agent_session_resume`
- `agent_sessions_list`
- `agent_subagent_status`
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
- `fs_export_file`
- `fs_glob`
- `fs_grep`
- `fs_list`
- `fs_read`
- `fs_search`
- `fs_stat`
- `fs_usage`
- `infra_provider_doctor`
- `infra_providers_list`
- `integration_query`
- `jev_action`
- `local_agent_inbox`
- `local_agent_request_wait`
- `local_agents_list`
- `mso_native_ui_probe`
- `mso_surface_apps_list`
- `organization_chart`
- `project_agent_status`
- `project_agent_vault_read`
- `project_candidate_search`
- `project_capabilities`
- `project_changes_list`
- `project_diff`
- `project_get`
- `project_knowledge_get`
- `project_memory_search`
- `projects_list`
- `read_pipeline`
- `render_mso_block`
- `render_mso_list`
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

### ChatGPT write (39)

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
- `fs_edit`
- `fs_mkdir`
- `fs_move`
- `fs_upload_file`
- `fs_write`
- `hostinger_dns_upsert`
- `integration_manage`
- `integration_setup_open`
- `local_agent_inbox_acknowledge`
- `local_agent_message_send`
- `local_agent_reply`
- `organization_manage`
- `project_agent_vault_sync`
- `project_asset_attach`
- `project_knowledge_set`
- `project_mcp_manage`
- `project_memory_upsert`
- `project_script_run`
- `session_artifact_register`
- `session_artifacts_cleanup`
- `todo_write`
- `tool_forge_propose`
- `workflow_cancel`
- `workflow_finish`
- `workflow_start`

### ChatGPT exec (26)

- `a2a_handoff`
- `a2a_message_send`
- `a2a_task_cancel`
- `agent_subagent_cancel`
- `agent_subagent_run`
- `agent_subagent_start`
- `browser_power`
- `exec_job_cancel`
- `exec_job_start`
- `exec_run`
- `flow_run`
- `integration_execute`
- `local_agent_request`
- `local_agent_standby`
- `project_agent_run`
- `project_database_call`
- `project_database_query`
- `project_database_status`
- `project_database_tools`
- `project_function_call`
- `project_mcp_call`
- `project_mcp_tools`
- `pty_session`
- `tool_forge_evaluate`
- `tool_forge_promote`
- `workflow_graph`

### ChatGPT app-only bridges (2)

- `render_mso_surface`
- `workflow_status`
