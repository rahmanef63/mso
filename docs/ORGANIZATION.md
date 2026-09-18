# Organization — agent roles, reporting lines, and execution routing

MSO Organization is the private owner-level source of truth for **who exists in the operating structure, what seat they occupy, who they report to, and which existing agent runtime may execute work for that seat**.

It is intentionally **not a Workflow feature**. Workflow owns automation topology and execution. Organization owns operating structure and routing context. A Workflow Agent node may reference an Organization seat, but the workflow does not copy or own that seat.

## Domain split

| Domain | Owns | Does not own |
|---|---|---|
| Organization | units, seats, titles, roles, reporting lines, seat mode/state, execution target references | automation graphs, credentials, agent transcripts |
| Workflow Graph | triggers, nodes, edges, retries, execution history, versions | organization hierarchy |
| Local Agents | same-owner durable session identity and messaging/execution | organizational title/reporting truth |
| A2A | registered remote peer metadata and remote task transport | organizational title/reporting truth |
| Project Agent | bounded execution inside one canonical project | organization hierarchy |
| Integrations | credentials and provider connections | seat metadata |
| Alfa Agent persona | browser-local conversational persona | organizational authority or execution permissions |

An Org seat never grants capability. Existing scope, approval, project, A2A, Local Agent, and Integrations guards remain authoritative.

## Model

### Unit

A unit is a stable organization/context boundary:

- `holding`
- `company`
- `division`
- `team`
- `client`
- `other`

Units can nest with `parentUnitId`. The store rejects missing parents and cycles.

### Seat

A seat is an organizational position. It belongs to one unit and may report to another seat, including a seat in a different unit. This enables a complete holding-company reporting tree while still allowing unit-filtered views.

Seat state:

- `active` — the position exists and is active.
- `vacant` — the position exists but is intentionally unfilled.
- `inactive` — the position is retained but disabled.

Seat mode:

- `permanent` — persistent context/role owner.
- `on_demand` — valid role invoked only when work needs it.
- `inactive` — disabled execution seat.

Runtime status is separate from seat state. An active seat with no executor is `unbound`, not `vacant`.

## Execution targets

A seat may point to one existing execution authority:

- `none` — organization/context only.
- `project-agent` — a canonical MSO project agent target.
- `local-agent` — a durable same-owner Local Agent/session reference.
- `a2a` — a registered remote A2A peer reference.

The Org store persists only references. It never stores provider keys, A2A credentials, integration secrets, hidden conversation context, or project credentials.

## Workflow integration

The Workflows Agent node supports `config.orgSeatId`.

When present, MSO resolves the seat at execution time:

1. validate the seat is active;
2. read its current target reference;
3. route through the existing target authority;
4. preserve the original workflow scope/audit/runtime guards.

Target mapping:

- `project-agent` → `project_agent_run`
- `local-agent` → `local_agent_request`
- `a2a` → `a2a_handoff`

Because resolution happens at run time, changing a seat's executor does not require editing every workflow that points to the seat.

## Storage and safety

Default store: `~/.mso/private/organization.json` (override with `OS_ORGANIZATION_STORE`).

The store is owner-private and shared across this owner's MSO surfaces so Web, CLI, MCP, schedules, and webhooks see the same organization. It uses:

- directory mode `0700`;
- file mode `0600`;
- no-follow reads and owner checks;
- atomic writes;
- optimistic `revision` checks;
- bounded unit/seat/text counts;
- unit and reporting-cycle prevention;
- child/direct-report delete guards.

This is a private runtime store. MSO source ships **no operator-specific organization data**.

## UI

Open the first-class **Organization** app from the dock, launcher, Start menu, App Library, Spotlight, or `/organization`. **Alfa → Organization** remains a secondary deep-link to the same view and SSOT.

The default `All organization` view renders the complete reporting hierarchy across units. Selecting a unit filters the view while keeping the same SSOT. Seat cards show role, unit, seat mode, execution binding, and current runtime state.

Editing uses the shell-responsive dialog/drawer primitive so desktop and mobile use the same contract.

## CLI

```text
mso org show
mso org unit-upsert <revision> <JSON|@file>
mso org seat-upsert <revision> <JSON|@file>
mso org unit-delete <revision> <id>
mso org seat-delete <revision> <id>
mso org replace <revision> <JSON|@file>
```

Every mutation uses the current chart revision. Refresh and reconcile if another surface changed it first.

## MCP

- `organization_chart` — read chart, optional seat lookup, and live target status.
- `organization_manage` — revision-checked unit/seat mutation.

The MCP tools expose the same store and do not create another organization database.


## Internal project flow

Every unit may own an optional `projectFlow` in the same private organization store.
The outer organization card remains a two-line summary. Opening a unit defaults to
**Projects**; **Seats** retains the existing reporting/execution-binding view.
Project-flow cards are context nodes, not seats or executable Workflow Graph nodes.

The flow stores a title, multiline notes, nodes and directed labeled connections.
Node kinds are `project`, `activity`, `group`, and `note`; status defaults to
`unconfirmed`, with explicit `planned`, `active`, `blocked`, and `done` alternatives.
`projectRef` is a reference only and grants no authority. Clicking a node opens its
details; editing, dragging positions, connecting and deleting persist through the API.
Search and focus limit the visible context without changing stored data. Long source
notes live inside the unit's Notes editor, not on the overview card.

The existing `organization_chart` read tool returns each unit's `projectFlow`.
The existing `organization_manage` write tool supports the following actions; all
require `expected_revision` and `data.unitId` (the exact owning unit id):

| Action | Additional data |
|---|---|
| `flow_update` | Optional `title`, `notes`; preserves nodes/edges |
| `flow_replace` | Complete `flow: {version:1,title,notes,nodes,edges}` |
| `flow_node_upsert` | `node: {id?,title,kind?,status?,summary?,notes?,position?:{x,y},projectRef?}` |
| `flow_node_delete` | `id`; also removes that node's incident edges |
| `flow_edge_upsert` | `edge: {id?,source,target,label?}` |
| `flow_edge_delete` | `id` |

An existing node/edge id permits a partial update. Missing ids are generated server-side.
Edges must reference nodes in the same unit. Node and edge ids are stable and unique
within their unit; unknown units, dangling edges, invalid positions and stale revisions
fail without writing. Unit edits from older clients preserve an omitted `projectFlow`.
The full-chart `replace` action remains an explicit destructive snapshot replacement.

The HTTP route uses `{action,expected_revision,data}` for flow operations. CLI equivalents
are `mso org flow-node-upsert <revision> <JSON|@file>` and the other hyphenated action names.
UI, CLI and MCP share the same revision-checked mutation handler, not separate databases.
Limits: 200 nodes, 400 edges per unit; 64,000-character flow notes; 12,000-character node
notes; 2 MiB HTTP body and total private store. Over-limit notes are rejected, not clipped.
No flow operation executes a command, fetches a source reference, assigns an agent,
or promotes unconfirmed facts. Existing OAuth scope, device role and audit guards remain.
Public names are unchanged; rescan clients to see the expanded action enum/descriptions.
