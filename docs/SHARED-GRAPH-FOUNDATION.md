# Shared Graph Foundation

This document records the current ownership boundary for first-party MSO graph UI. It is an architecture map, not a universal graph domain model.

## Ownership matrix

| Capability | Canonical owner | Organization | Workflow | Session | Classification |
| --- | --- | --- | --- | --- | --- |
| Canvas / ReactFlow provider | `components/shared/graph-canvas.tsx` | consumer | consumer | via WorkflowCanvas | A shared |
| Pan / zoom / full fit / measured initial fit | `components/shared/graph-canvas.tsx` | consumer | consumer | consumer | A shared |
| Minimap | `components/shared/graph-canvas.tsx` | consumer | consumer | consumer when useful | A shared |
| Selection projection / box selection preservation | `components/shared/use-graph-projection.ts` | ProjectFlow | WorkflowCanvas | via WorkflowCanvas | A shared |
| Multi-select mechanics | `components/shared/graph-canvas.tsx` + projection hook | supported where feature allows | supported | selection-only | A shared + feature capability |
| Generic focus / direct-neighbor cluster | `components/shared/graph-focus.ts` | ProjectFlow adapter | Workflow seed adapter | Workflow seed adapter | A shared |
| Generic routed edge | `components/shared/graph-routed-edge.tsx`, `graph-route*.ts` | consumer | consumer | consumer | A shared |
| Generic node chrome | `components/shared/graph-node-shell.tsx` | Unit/Seat/Project content | Workflow content | Workflow semantic content | A shared |
| Collapsed custom/group projection | `components/shared/graph-custom-*.{ts,tsx}` | consumer | consumer | read-only projection if present | A shared |
| Organization graph layout | `frontend/slices/organization/lib/canvas-layout.ts` | owner | — | — | B feature-owned |
| Workflow entry seed semantics | `frontend/slices/workflows/lib/compact-focus.ts` | — | owner | session-root adapter | B feature-owned |
| Domain node rendering / handles | feature slice components | owner | owner | Workflow semantic adapter | B feature-owned |
| Inspector layout and fields | feature slice components | owner | owner | `workflow-session-details.tsx` | B feature-owned |
| Organization persistence | Organization API/actions | owner | — | — | B feature-owned |
| Workflow persistence / execution / run state | Workflow API/runtime | — | owner | read-only history input | B feature-owned |
| Session artifacts / terminal / save-as-workflow | `workflow-session-details.tsx` + session APIs | — | — | owner | B feature-owned |
| n8n iframe/auth/origin/sandbox | `frontend/slices/n8n/**` | — | — | — | C provider-specific |
| Legacy Organization projection helper | removed; superseded by shared projection | — | — | — | D obsolete |

## Adapter rule

Shared code owns graph mechanics only. Each feature transforms its domain data into the shared presentation contract and keeps persistence, execution, permissions, inspector fields and provider behavior in its own slice.

Session is intentionally not a separate graph implementation:

`SessionGraphView -> WorkflowCanvas(readOnly) -> GraphCanvas -> WorkflowSessionDetails`.

Read-only changes capabilities, not viewport, focus, selection or routing mechanics.

## Dense graph UX

Organization Project Flow defaults to Focus. The initial cluster is root-based when nothing is selected, then selected-node + direct relationships when a node is selected. Expand neighbors increases the bounded cluster. Map is the explicit full-topology mode.

Physical layout and viewport policy are separate concerns: layout provides coordinates; shared GraphCanvas decides what viewport cluster is readable and keeps full-fit available explicitly.

## Extraction rule

Move code into shared only when at least two real first-party consumers have the same semantic responsibility. Prefer a small shared primitive plus a feature adapter. Do not add Organization/Workflow/Session conditionals to shared code, and never move n8n provider-specific iframe/auth behavior into this foundation.
