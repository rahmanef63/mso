# MSO agent bootstrap

This is the canonical **first-call sequence** for every AI surface that drives MSO.
Implementation and presentation may differ (schema size, tool names, UI), but no
surface is a permanent second-class citizen for core ops.

The machine-readable copy lives in [`lib/mcp/instructions.ts`](../lib/mcp/instructions.ts)
and is injected into MCP `initialize.instructions`, `workflow_start.bootstrap.orientation`,
and the official skill [`mso-agent-bootstrap`](../claude-skills/mso-agent-bootstrap/SKILL.md).

## Canonical sequence

Copy this. Do not skip to `exec_run`.

1. **`skills_search` or `skills_read`** — learn how MSO wants to be used. Query
   `mso-agent-bootstrap` (or `skills_list` with `trust=official` if you already know
   the id). ChatGPT also receives this skill through the published MCP Skills
   extension; still call it when the live catalog may have moved on.
2. **`projects_list`** — resolve the project if the user named one you have not
   located. Use the returned id/path; do not guess across containers. Check
   `scan.truncated` before concluding a project is absent.
3. **`workflow_start`** — for any task that needs two or more operational calls.
   Pass complete intent, project hint, and constraints. Carry the **exact**
   `workflow_id` on every later call in this conversation. Do not call
   `skills_search` immediately before `workflow_start` for the same task; startup
   already searches skills/recipes. Read-only tokens cannot start a workflow.
4. **Project MCP** — `project_capabilities` → `project_mcp_tools` → `project_mcp_call`.
   Keep discover and call as two tools. Project tool names never join the global
   MSO catalog. `project=@host` is this VPS; any other value is one exact project.
5. **Credentials** — `integration_query` → private setup/verify → `integration_execute`.
   Never put secrets, tokens, or passwords in chat or tool arguments. Open
   `integration_setup_open` (ChatGPT Page) or native `mso integrations` when a
   connection is genuinely missing. Mutations need `confirm=true`.
6. **Reads before shell** — prefer `read_pipeline` and bounded `fs_*` / `sys_*` /
   `vps_status` / `apps_*` before `exec_run`. Long tests/builds use `exec_job_start`
   and poll `exec_job_status`, not a blocking `exec_run`.
7. **Mutating infra** — only bounded tools (`dokploy_*`, `cloudflare_*`,
   `hostinger_*`, `infra_provider_doctor`) with explicit confirm. Doctor/health
   first. No raw `systemctl` wildcards, no secret env dumps.

Then verify independently and call `workflow_finish` with the same id (or
`workflow_cancel` to abandon). A recipe is guidance, not permission.

## Context-economy behavior

The sequence above is unchanged. `workflow_start` now performs provider-neutral bounded
replay/candidate reuse internally when a compatible learned pool exists; an agent does
**not** add another bootstrap call just to use it. For explicit repo discovery,
`project_candidate_search` is a read-only two-stage path/content search with cursors and
truncation. Replay handles point back to existing bounded read/job/artifact surfaces
instead of embedding old tool dumps in the next prompt.

Authorization is deliberately outside the reuse layer: current identity, project
resolution, scope, confirmation, and host policy are checked again on every call. Full
design and parity details are in
[`COGNITIVE-RUNTIME.md#bounded-replay-and-sparse-candidate-reuse`](./COGNITIVE-RUNTIME.md#bounded-replay-and-sparse-candidate-reuse).

## Hard constraints

- Do **not** hide callable tools from ChatGPT `tools/list` to compress context.
- Do **not** fuse `project_mcp_tools` into `project_mcp_call`.
- Do **not** put secrets in tool args; setup grants stay private.
- Keep the scope ladder `read < write < exec`. Routing may hide a schema from one
  model turn; it never elevates permission.
- Reusing indexes, recipes, or cached descriptors does **not** skip auth.

## Surface variants

Same capability map; different entry tips.

| Surface | Entry | Tips |
|---|---|---|
| **ChatGPT MCP** | OAuth connector, compact `tools/list`, published Skills extension | Read published skill `mso-agent-bootstrap` first. Compact descriptions are short; follow `initialize.instructions` and this sequence. Page tools (`render_mso_page`, `integration_setup_open`) are ChatGPT UI, not extra host power. |
| **Cursor / Grok MCP** | Full generic catalog (~same tools as ChatGPT, longer schemas) | `initialize.instructions` carries the numbered sequence. Use the full descriptions. Still start with the skill or `workflow_start` for multi-step work. |
| **Terminal `mso` agent** | Catalog-first router, phase-aware packs | The harness already selects a maximal pack for this turn (`workflow_start` first on repo changes). Do not pay extra `skills_search` when the needed tool is visible. `/skill mso-agent-bootstrap` loads this map. Write/exec need `--approve-scope`. |
| **Alfa via `mso` gateway** | Same MCP server as ChatGPT/Cursor | Treat it as **MCP full**. Use this sequence. Gateway does not shrink capabilities. |
| **Alfa in-shell** | Browser assistant, `dot.case` host tools | Same host ops through Alfa tools / Files / Organization / Integrations UI. Several MCP-only tools are **identity boundaries** (external principal, ChatGPT Page, durable MCP session), not missing power. See the matrix. |

## Parity matrix

Legend: **Reach** = how this surface performs the capability. **Gap** = accidental hole
(should close) vs **Intentional** = documented identity/presentation difference.

| Capability | CLI `mso` / terminal agent | MCP full (Cursor/Grok/gateway) | MCP ChatGPT | Alfa in-shell |
|---|---|---|---|---|
| Project discovery | `mso projects` / `projects_list` | `projects_list` | same tool, compact schema | Files app + `fs.list`; no `projects.list` (**Intentional**: sidebar already enumerates) |
| Skills | `mso skills *` / `skills_*` | `skills_search/list/read` | same + 5 published skills | `skills.search/list/read` |
| Integrations | `mso integrations` | `integration_query` → setup → `integration_execute` | same + `integration_setup_open` Page | Owner Integrations UI; no Alfa credential-owner identity (**Intentional**) |
| Project MCP | `project_mcp_*` | `project_capabilities` → `project_mcp_tools` → `project_mcp_call` | same; must not hide either tool | inspect `.mcp.json` via fs; no dynamic global catalog (**Intentional**) |
| Workflows / RASMIC | catalog-first + `workflow_*` | `workflow_start` then exact `workflow_id` | same; `workflow_status` is app-only progress UI | in-app thread is the run boundary; no external `workflow.start` (**Intentional**) |
| Host reads | `mso ls/cat/stats` / `fs_*` `sys_*` `read_pipeline` | same MCP tools | same | `fs.*` / `sys.*` |
| Bounded infra | `infra_*` `dokploy_*` `cloudflare_*` `hostinger_*` | same | same compact schemas | dedicated infra apps / Integrations; MCP DNS upsert stays external (**Intentional**) |
| Doctor / health | `mso doctor`, `sys_stats`, `vps_status`, `infra_provider_doctor` | `vps_status`, `sys_stats`, `infra_provider_doctor` | same | Monitor app + `sys.stats` |
| Deploys | `mso-deploy` skill / `bun run ship` / Dokploy tools | same tools + skill | same; Page is not a deploy button | owner UI / CLI; no extra Alfa deploy primitive (**Intentional**) |

Presentation differences (compact ChatGPT descriptions, terminal pack routing,
Alfa `dot.case` names) are **not** capability holes.

## Follow-ups (not in this change)

These remain designed-not-shipped. They must not block agents from the sequence above.

- Closing an Alfa in-shell identity boundary only when a shared principal exists.

## Related contracts

- [`COGNITIVE-RUNTIME.md`](./COGNITIVE-RUNTIME.md) — provider-neutral harness, catalog-first routing.
- [`MCP.md`](./MCP.md) — OAuth, scope ladder, published skills, `initialize.instructions`.
- [`RASMIC.md`](./RASMIC.md) — workflow isolation, recipes, verification.
- [`CHATGPT-PLUGIN.md`](./CHATGPT-PLUGIN.md) — ChatGPT connector and Skills extension.
- [`MCP-HOW-TO.md`](./MCP-HOW-TO.md) — operator onboarding, including Bahasa Indonesia.
