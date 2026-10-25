# rahmanef63/open-silong

| | |
|---|---|
| License | MIT |
| Relation | layout ideas for the owner Memory graph |
| Code copied | none, reimplemented |

## What MSO uses

Graph interaction ideas: ghost nodes for unresolved `[[wikilinks]]`, undirected
link traversal, web/radial/layered layouts, a local hop neighbourhood, and
folder/project colour grouping. The MSO implementation is native.

## Attribution

Already in the repository, four places:

- [`../ARCHITECTURE.md`](../ARCHITECTURE.md) — Memory app section
- [`../MEMORY-GRAPH.md`](../MEMORY-GRAPH.md) — layout credit
- `lib/memory-graph/assemble.ts` — file header
- `lib/memory-graph/types.ts` — file header

## Evidence

Shingle comparison of `lib/memory-graph/` and `frontend/slices/memory-graph/`
against 1,010 open-silong source files: highest single-file overlap 0.07
(`layout.ts`), no transplanted file. MSO does not depend on Obsidian or Convex.
