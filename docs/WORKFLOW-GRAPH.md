# Workflow Graph v2 — server-native automation

MSO Workflow Graph v2 is MSO's private, server-native visual automation layer. It provides the core self-hosted workflow capabilities normally expected from n8n while keeping MSO's project registry, Linux filesystem, Skills, project knowledge, agents, integrations and capability permissions as the execution authorities.

It is additive: existing deterministic project flows, RASMIC scripts and learned workflow memory remain supported.

## Authority and storage

- **Workflow Graph** owns automation topology, triggers, flow control, node configuration, execution history and graph versions.
- **Project registry** resolves canonical projects and real server paths at runtime. Portable graph definitions store ids/hints, never installation-specific absolute paths.
- **Integrations** own credentials and provider connections. Graphs store connection references only.
- **Private workflow variables** provide runtime values through `{"$var":"KEY"}`. Secret variables are never returned by list APIs and exact secret values are redacted from execution receipts.
- **Git** remains code SSOT; project knowledge/memory remain their existing SSOTs.

Graphs, versions, variables and execution receipts are private per authenticated principal. Source and builtin templates contain no operator-specific user, credential, path or seeded workflow.

## Node catalog

### Triggers

- `manual` — UI/CLI/MCP run
- `schedule` — interval or five-field cron, with IANA timezone support
- `webhook` — GET/POST/PUT/PATCH/DELETE server endpoint; optional bearer token from a private secret variable

Trigger nodes must be roots. Activating a workflow enables its server-side schedule/webhook behavior; drafts remain inert.

Webhook endpoint:

```text
/api/v1/workflows/webhook/<graphId>/<nodeId>
```

`responseMode=onReceived` returns a run id immediately. `responseMode=lastNode` waits for bounded execution and returns only the explicit output-node result.

### Flow control

- `condition` — true/false handles
- `switch` — named case handles plus default
- `merge` — combine, append or pass-through incoming outputs
- `batch` — split up to 1000 items into deterministic batches
- `loop` — execute one bounded tool for each item with concurrency 1–4
- `wait` — delay/until, bounded to ten minutes inside a run
- `subflow` — execute another private Workflow Graph, or a legacy project flow
- `output` — explicit result collection

Graph edges stay acyclic. Repetition is represented by the bounded `loop` node or reusable subflow rather than unrestricted cyclic edges, preventing accidental runaway server automation. Cross-workflow recursion is rejected with an ancestry guard.

### Actions and context

- `tool`
- `project_function`
- `project_mcp`
- `integration`
- `script` — execute a saved, validated repo-local RASMIC automation manifest by `project + script_id`; the graph stores only the reference, while runtime re-validates the manifest before replay
- `agent`
- `project`
- `folder`
- `skill`
- `knowledge`

Project/folder nodes resolve the live canonical server path when the graph runs and can open that real directory in MSO Files/Finder.

Script nodes intentionally do **not** execute arbitrary shell or browser-supplied JavaScript. The Inspector can search the selected project's `.agent/scripts` catalog, shows candidate/tested state and step count, and persists the chosen `script_id` in the graph. Execution delegates to `project_script_run`, which re-reads the manifest and refuses steps outside the bounded replay-safe RASMIC policy. A successful candidate replay is promoted to tested by the existing script runner.

## Data binding

Node config supports safe declarative bindings:

```json
{ "$ref": "nodes.previous.output.value" }
```

```json
{ "$var": "PRIVATE_VARIABLE" }
```

Loop arguments additionally support `$item` and `$index`.

Secret-like fields such as raw tokens, passwords, API keys, cookies and authorization headers are rejected recursively from stored graph definitions. Credential-backed actions use an `integration` node referencing an existing MSO integration connection instead.

## Retry and error handling

Action nodes may use:

```json
{
  "retry": { "maxAttempts": 3, "backoffMs": 1000 }
}
```

Retries are bounded to five attempts with bounded exponential backoff. A red `error` output routes a failed node to an explicit error branch. `onError: "continue"` supports continue-on-fail behavior. A graph can also set `metadata.errorWorkflowId` to invoke another private workflow after an unhandled failure.

Successful runs finish `completed`; handled action failures finish `completed_with_errors`; unhandled failures record the exact failed node and block downstream nodes.

## Execution history and observability

Private run receipts retain up to 1000 recent executions and expose:

- trigger type
- graph revision
- queued / running / completed / failed / skipped / blocked node state
- attempts and duration
- bounded node output
- compact logs
- failed node id/name

The Workflows canvas reflects live node state and pulses edges while related nodes run. The History panel filters one graph's persisted executions and can reopen a complete receipt.

## Versions and rollback

Create/update/restore operations save private snapshots. Up to 100 versions are retained per graph. The Versions panel shows timestamp, reason, revision and node count; restore is compare-and-swap against the current graph revision so concurrent edits cannot be silently overwritten.

## Templates and AI-assisted creation

The Create dialog supports:

- blank graph
- generic builtin templates
- AI-assisted draft generation using MSO's currently selected model

AI assistance has an isolated workflow-design system prompt, receives no implicit owner-memory recall, emits JSON only, cannot authorize execution, and is validated through the same graph schema. AI-created graphs always start as drafts.

## Native Workflows app

`/workflows` provides:

- private searchable workflow library with description/project/folder/tag metadata, clickable tag chips, and shared query syntax (`tag:`, `status:`, `project:`, `folder:`, `node:` plus free-text AND terms)
- draft / active / archived lifecycle
- searchable node palette
- draggable canvas
- click-to-connect input/output ports
- persistent per-edge `Auto/Solid/Dashed` presentation, execution `Active` toggle, directional arrows and bounded reverse-direction control
- true/false, switch and error handles
- structured trigger/action/retry inspectors plus advanced JSON
- real project/folder navigation
- one live Directory for Tools, Workflows, Sessions, Projects and Skills (the same registries used by runtime nodes)
- execution log + persisted history
- graph version restore
- private variable/secret manager
- template and AI-assisted creation

Run automatically saves a dirty graph before execution, so execution always uses the revision visible in the editor. Disabled connections remain visible in the graph and receipts but are excluded from runtime traversal, cycle checks and tidy layout; a target reachable only through disabled connections is skipped rather than silently promoted to a new root.

## Reviewed external workflow tabs

The Workflows workspace keeps the native MSO automation/session editor and can add
external editors such as n8n as sibling tabs. External tabs are **off by default**.
The owner-reviewed Page registry is shared through `lib/surfaces/config.ts`; add
`"placements": ["workflows"]` to an approved external app in the existing
`~/.mso/surface-apps.json` (or its configured override). Preserve existing entries.
Workflow-only placements do not appear in the MCP Page catalog or grant ChatGPT a
nested-frame origin. Legacy entries without placements retain their Page behavior;
explicit `"mcp-page"` is a separate reviewed placement.
For example, a private installation could add:

```json
{
  "id": "n8n", "title": "n8n", "description": "External workflow editor",
  "origin": "https://automation.example.test", "startPath": "/home/workflows",
  "renderer": "iframe", "presentation": "inline", "environment": "production",
  "externalAuthPath": "/signin", "placements": ["workflows"],
  "sandbox": "allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox"
}
```

`GET /api/v1/workflow-embeds` and `mso workflow embeds` return only reviewed
presentation metadata to an approved Owner device. They never return Integration
credentials. The Owner-only POST and `mso workflow embed-save` accept `{app, expectedRevision, confirm:true}`; they validate metadata, preserve unrelated entries and reject stale revisions or environment-managed configuration. No raw file or credential access is exposed.
The registry is refreshed when the window regains focus, without a
rebuild. External frames load on first selection; switching tabs preserves both
the native editor's unsaved state and the external editor's frame. Keyboard tab
navigation and narrow viewport layouts use the same workspace wrapper.

MCP authorization does not sign the browser into n8n. Use the visible **Sign in**
link to authenticate directly with the external service, then reload its frame.
**Open** remains available if its frame policy or browser cookie policy prevents
embedding. MSO does not strip upstream security headers, proxy credentials, or
claim that an iframe load proves authentication. Own-cockpit origins and
remote-only registry entries never become embedded frames.

## CLI

```bash
mso workflow list
mso workflow embeds
# Review a metadata-only app and use the revision above:
mso workflow embed-save --input @reviewed-embed.json
mso workflow show <id>
mso workflow catalog --query webhook
mso workflow templates
mso workflow template webhook-router
mso workflow create --input @workflow.json
mso workflow save <id> --revision <rev> --input @workflow.json
mso workflow run <id> --input '{}' --key operation-001 --wait
mso workflow runs <id>
mso workflow versions <id>
mso workflow restore <id> --revision <current> --version <saved>
mso workflow variables
mso workflow variable-set WEBHOOK_TOKEN --input '"secret"' --secret
mso workflow variable-delete WEBHOOK_TOKEN
mso workflow ai --prompt "Every weekday inspect project health and route failures"
```

## MCP

MSO deliberately keeps this capability behind one compact MCP tool to preserve the public schema budget:

`workflow_graph`

Actions:

`list`, `search`, `get`, `create`, `update`, `delete`, `clone`, `run`, `status`, `runs`, `versions`, `restore`, `catalog`, `scripts`, `templates`, `create_from_template`, `variables`, `variable_set`, `variable_delete`. `list` and `search` accept the same workflow query/filter semantics used by the UI; `scripts` returns safe RASMIC manifest summaries for an exact project without exposing raw script files or credentials.

The linear `flow_catalog`, `flow_manage`, `flow_run` and `flow_status` tools remain compatible for small deterministic project-owned sequences.

## Automatic learning

`workflow_start` still checks reusable automation before performing exploratory work. Successful `workflow_finish` learns a sanitized route, updates private procedural memory and creates/deduplicates a private draft graph candidate. Learned workflows never auto-activate or bypass normal scope/authz checks.

## Scope of n8n parity

MSO targets **core self-hosted workflow parity**, not n8n's SaaS business surface. MSO intentionally uses its own server-native project, filesystem, Skill, agent and integration nodes instead of reproducing n8n's marketplace or cloud billing/team-administration products. Free cyclic graph topology is also intentionally replaced by bounded loop/subflow constructs for safer unattended server execution.

## Organization seat routing

Organization is not owned by Workflow Graph. An `agent` node may set `orgSeatId`; at execution time MSO resolves that seat from the private Organization registry and routes to its current Project Agent, Local Agent, or A2A target. This indirection lets a workflow say “send to the CTO seat” without duplicating which concrete agent currently fills that seat. Direct project-bound Agent nodes remain backward compatible. See [`ORGANIZATION.md`](./ORGANIZATION.md).

### External editor credential isolation

Different origins do not by themselves isolate cookies. Reviewed external editors must
be outside the currently validated `OS_SESSION_COOKIE_DOMAIN` and must not reuse a cockpit
hostname on another port when cookies are host-only. MSO blocks both framing and editor/login
links for colliding destinations and shows the configuration reason. Signed browser sessions
are also bound to a durable cookie-policy generation. Widening, narrowing or unsetting the
Domain rotates that generation in the private auth store; returning later to an earlier Domain
rotates it again, so retained/captured tokens from that older generation never revive. Shared
MCP Page discovery uses the same boundary. Registry review is not a credential-sharing exception; native managed-app/
browser proxy routes keep their separate existing authentication boundaries.

## Selected custom nodes and connector routing

One or multiple selected nodes can become a named, collapsible custom node directly
on the automation canvas. Ctrl/Cmd-click or box-select, then **Create custom node**.
The selection survives rerenders. Double-click the compact card to expand it;
**Ungroup** removes only the wrapper. Save persists the change as ordinary graph data.
`metadata.customNodes` stores `{id,name,nodeIds,collapsed}` arrays, validated against
the same graph. Members cannot belong to overlapping/nested groups.

This is a presentation abstraction, not an executable new node type: stored node ids,
configurations, boundary handles, input references, edge topology and run receipts stay
unchanged. Original members execute in the original graph. Clone/export/import carry
the grouping metadata. The existing `workflow_graph` get/update actions provide function
calling with the current revision; no new transport or permission bypass is introduced.

The shared connector renderer avoids measured node cards where a route exists, uses
arrowheads and crossing halos, and highlights a selected node's incident routes.
Overlapping cards without a viable port exit receive a visible routing warning.
