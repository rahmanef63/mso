# n8n capability map — native MSO Workflows + Organization

MSO treats n8n as a separate external automation workspace. Native **Workflows** and
**Organization** stay authoritative for MSO-native automation, people/roles, projects,
execution routing, integrations, and server context. This avoids making an embedded n8n
page the source of truth for MSO.

This document maps the core self-hosted n8n capability areas to their MSO-native
counterparts. The goal is capability coverage, not pixel-for-pixel or API-for-API cloning.

| n8n capability area | Native MSO surface | MSO implementation |
|---|---|---|
| Workflow list/search | Workflows | Searchable workflow library with status, project, folder, node and tag filters |
| Create/update/delete/duplicate | Workflows | Workflow Graph create/update/delete/clone |
| Activate/deactivate | Workflows | Draft / active / archived lifecycle and Active switch |
| Tags/folders | Workflows | Graph metadata tags and folders; clickable tag filters |
| Manual trigger | Workflows | Manual trigger node + Run |
| Schedule trigger | Workflows | Schedule node with cron/interval and timezone |
| Webhook trigger | Workflows | Webhook node with bounded response modes |
| Conditions/switch/merge | Workflows | condition, switch and merge nodes |
| Batch/loop/wait | Workflows | batch, bounded loop, repeat-until and wait nodes |
| Sub-workflows | Workflows | subflow node, including saved Workflow Graphs |
| Error handling/retry | Workflows | bounded retry policy, error handles, continue-on-error and error workflows |
| Execution history | Workflows → Executions | Persisted run receipts with graph revision, node states, attempts, durations and logs; running executions can be stopped, stopped/failed/completed executions can be retried with their owner-private retained input when the graph revision is unchanged, and finished receipts can be deleted |
| Current execution | Workflows → Current run | Live polling and node/edge execution state |
| Versions/rollback | Workflows → Versions | Private graph snapshots and revision-checked restore |
| Variables/secrets | Workflows → Variables | Owner-private workflow variables; secrets are redacted and never returned in list responses |
| Credentials/connections | Integrations | Credential authority lives in Integrations; workflow graphs store connection references only |
| Integration actions | Workflows | integration nodes invoke reviewed MSO connections |
| Custom/code-like automation | Workflows | bounded project functions, project MCP, tested RASMIC scripts, tools and agents |
| Templates | Workflows | Built-in templates and AI-assisted draft creation |
| AI-assisted workflow creation | Workflows | Isolated workflow-design prompt; output is schema-validated and starts as draft |
| Persistent workflow data | Workflows → Data | Owner-private persistent data tables with bounded schemas/rows plus a native `data_table` workflow node for list/read/insert/update/delete; TTL cache and memory nodes remain available for other state patterns |
| Project context | Organization + project registry | Organization project flows reference canonical MSO projects without granting authority |
| Projects/groups | Organization | Units model holding/company/division/team/client boundaries |
| Users/members/roles | Organization | Seats model roles, titles, state, reporting lines and execution binding |
| Execution delegation | Organization + Workflows | Workflow Agent node can resolve an Organization seat at run time |
| Remote agents | Organization | Seats may bind to Project Agent, Local Agent or A2A targets |
| Instance/system status | System Monitor + Integrations | Runtime health and connection verification remain separate operational surfaces |
| Source control | Project/Git surfaces | Canonical project Git state stays with the project rather than inside workflow definitions |
| Import/export/backup | Workflows + MSO transfer surfaces | Workflows import/export portable `.mso-workflow.json` packages; credentials and runtime configuration continue to use guarded transfer paths |
| Audit/auth boundaries | MSO auth + audit | Device role, capability scope, audit and rate limits remain authoritative |

## Dedicated n8n app

The built-in `/n8n` route is the only first-class external n8n workspace. Native
`/workflows` no longer mounts provider tabs. The n8n surface uses the reviewed
surface registry and keeps its own authentication/cookies. MSO blocks a reviewed
destination when it would receive the cockpit session cookie.

Recommended registry placement:

```json
{
  "id": "n8n",
  "title": "n8n",
  "origin": "https://automation.example.test",
  "startPath": "/home/workflows",
  "renderer": "iframe",
  "presentation": "inline",
  "environment": "production",
  "placements": ["n8n"]
}
```

For migration, an existing n8n entry using `"placements": ["workflows"]` remains
readable by the compatibility API. New configurations should use `"n8n"`.

## Domain boundaries

- **Workflows** owns automation topology, execution, history, versions and variables.
- **Organization** owns units, seats, project/context mapping and execution routing references.
- **Integrations** owns credentials and provider connections.
- **n8n** is a separate external editor/runtime and does not inherit MSO authority.
- Organization project-flow nodes are context objects, not executable Workflow Graph nodes.
- A seat or project reference never grants capability by itself.

This split is deliberate: it gives the native product the automation and organization
capabilities expected from a self-hosted workflow platform without copying n8n SaaS
billing, marketplace or team-administration products into the wrong authority domain.
