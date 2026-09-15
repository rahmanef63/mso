# Workflow Graph v2

MSO Workflow Graph v2 is the private, server-native automation layer for reusable workflows. It extends the existing linear project flow engine rather than replacing it.

## SSOT boundaries

- **MSO Workflow Graph** owns automation topology, runtime node state, execution bindings and reusable workflow definitions.
- **MSO project registry** resolves canonical projects and real server paths at runtime. Graph definitions store project ids/hints, not installation-specific absolute paths.
- **Git** remains the code source of truth.
- **Project `.mso/KNOWLEDGE.md` / repo memory** remain project knowledge sources.
- External delivery systems may remain delivery/task SSOT when connected; MSO does not copy their task state into graph definitions.
- No separate organizational-memory product is required for workflow execution.

## Privacy and portability

Private graphs and run receipts are keyed by an authenticated principal hash. Another principal cannot list, read or poll them. Source code and builtin templates contain no installation owner, private path, credential or user-specific workflow seed. Project/folder paths are resolved only at runtime after canonical-project containment checks.

Secret-like fields (`token`, `password`, `apiKey`, authorization headers, cookies, etc.) are rejected recursively from stored graph definitions. Credentials continue to resolve through normal MSO integration/project authorities during execution.

## Graph model

A graph is a versioned DAG with revision conflict protection. MVP node types:

- `manual`
- `tool`
- `project_function`
- `project_mcp`
- `script`
- `agent`
- `subflow`
- `condition`
- `project`
- `folder`
- `skill`
- `knowledge`
- `output`

Cycles are rejected in v2 MVP. Condition nodes route `true` / `false` handles. Disabled or unselected branches become `skipped`.

## Runtime receipts

Each graph run persists a private receipt. Nodes expose:

- queued / running / completed / failed / skipped / blocked
- start/end/duration
- bounded redacted output
- error text
- compact node log

On failure, the receipt includes `failedNodeId` and `failedNodeName`; downstream queued nodes become `blocked`. Failed mutations are not replayed automatically.

## Visual editor

The native **Workflows** app (`/workflows`) provides:

- private workflow list
- draggable node canvas and edges
- node/edge CRUD
- JSON node config inspector
- duplicate/archive/save/run controls
- per-node run log
- project/folder nodes that open the resolved real server directory in MSO Files/Finder

The browser does not attempt to open a VPS desktop file manager.

## Automatic learning

`workflow_start` checks automation in this order:

1. matching private Workflow Graph v2
2. existing project/builtin linear flow
3. learned recipe and deterministic script candidate
4. normal bounded execution

Successful `workflow_finish` automatically learns the sanitized route, updates private procedural memory and creates/deduplicates a private **draft** graph candidate. Learned drafts never auto-activate or auto-run; ordinary scope/authorization still applies.

This makes repeated session history useful without requiring a separate manual memory write for every successful workflow. Manual user-test evidence still uses project memory because it has stronger authority semantics.

## MCP tools

- `workflow_graph_catalog`
- `workflow_graph_manage`
- `workflow_graph_run`
- `workflow_graph_status`

The existing v1 tools remain compatible:

- `flow_catalog`
- `flow_manage`
- `flow_run`
- `flow_status`

Use v1 for compact deterministic ordered API/MCP sequences; use graph v2 for visual branching workflows, mixed node types and richer runtime observability.
