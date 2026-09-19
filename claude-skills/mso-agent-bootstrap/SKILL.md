---
name: mso-agent-bootstrap
description: "Use this when connecting to MSO via MCP (ChatGPT, Cursor, Grok, or other clients), when an agent needs the first-call orientation sequence, or when checking capability parity across Alfa, CLI, and MCP before mutating the host."
metadata:
  mso:
    risk: low
    policy: orient-then-act
---

# /mso-agent-bootstrap — first-call map for every AI surface

MSO is one capability kernel with several presentations. ChatGPT, Cursor, the terminal
`mso` agent, and Alfa-via-gateway all reach the same maximal host power. Compact
schemas, `dot.case` Alfa names, and catalog-first terminal packs are presentation,
not missing features.

## Trigger and boundaries

- **Use when:** starting an MCP session, teaching an agent how MSO works, or choosing
  the first tools before a mutation.
- **Do not use when:** a narrower official skill already matches (deploy, repo-work,
  camoufox, integrations) and you already know the map.
- **Required context:** token scope (`read`/`write`/`exec`) and whether the project
  id/path is already known.

## Fast route

1. `skills_search` query `mso-agent-bootstrap`, or `skills_read` this id. ChatGPT may
   already have the published copy; still prefer the live catalog when unsure.
2. `projects_list` if the project is unresolved. Honor `scan.truncated`.
3. `workflow_start` once for multi-step work; pass exact `workflow_id` thereafter.
   Skip this on a read token. Do not call `skills_search` immediately before startup
   for the same task.
4. Project MCP: `project_capabilities` → `project_mcp_tools` → `project_mcp_call`.
   Never fuse discover and call. Never copy project tool names into the global catalog.
5. Credentials: `integration_query` → private setup/verify → `integration_execute`.
   Never put secrets in chat or tool arguments.
6. Prefer `read_pipeline` and bounded `fs_*`/`sys_*`/`vps_status` before `exec_run`.
7. Mutate infra only through bounded tools with `confirm`. Doctor/health first.

Then verify and `workflow_finish`, or `workflow_cancel`.

## Surface tips

| Surface | Entry tip |
|---|---|
| ChatGPT MCP | Published skill + compact `tools/list`. Follow `initialize.instructions`. Page tools are UI, not extra power. |
| Cursor / Grok MCP | Full schemas. Same sequence. `initialize.instructions` is the prefill. |
| Terminal `mso` agent | Catalog-first packs already pick maximal tools. `/skill mso-agent-bootstrap` if you need the map. Do not `skills_search` when the needed tool is visible. |
| Alfa via gateway | Same MCP server as Cursor. Use this sequence. |
| Alfa in-shell | `dot.case` host tools + owner UI. MCP-only tools are identity boundaries, not holes. |

## Tool routing

| Need | Preferred | Avoid |
|---|---|---|
| Orientation | this skill, then `workflow_start` | jumping to `exec_run` |
| One read | bounded read / `read_pipeline` | shell for a single file |
| Project MCP | capabilities → tools → call | inventing global tool names |
| Credentials | `integration_query` then private setup | pasting keys into chat |
| Infra change | bounded provider tool + confirm | raw `systemctl` / secret env |
| Long build | `exec_job_start` + status | blocking `exec_run` |

## Hard constraints

Do not hide ChatGPT tools to compress context. Do not fuse project MCP discover/call.
Do not put secrets in args. Keep `read < write < exec`. Reusing an index or recipe
does not skip auth.

Full matrix: [`docs/AGENT-BOOTSTRAP.md`](../../docs/AGENT-BOOTSTRAP.md).

## Verification contract

- **Expected state:** the agent can name the next bounded tool for the task.
- **Targeted checks:** scope matches the tool; `workflow_id` is exact when required.
- **Runtime proof:** live `GET /mcp` toolset and a real call through the chosen path.
- **Visual proof:** `screen_capture` only when UI actually changed.
- **Diff boundary:** no unrelated refactors; no credential values in traces.

## Failure and rollback

Stop when project identity or scope is ambiguous. Preserve the first error. Never
force-push, dump `~/.mso`, or treat a zero exit as proof.

## Recipe memory

Save redacted steps only. Never persist file bodies, tokens, cookies, or secret-bearing
argv. A failed run is evidence, not a replacement for a verified recipe.
