# Memory graph

Owner-only knowledge graph inside the MSO shell. Open it from Launchpad or Spotlight as **Memory**, at `/memory`, or with `mso memory-graph [project]`.

The graph is built on the server by `GET /api/v1/memory-graph` and rendered in the browser. It does not use Convex, and it does not require Obsidian. Layout ideas — web (force), radial rings, layered hop columns, a local neighbourhood, ghost nodes for unresolved `[[wikilinks]]`, and folder/group color — follow [open-silong](https://github.com/rahmanef63/open-silong) `frontend/slices/memory-graph` (MIT). The implementation is MSO-native.

This is separate from the Workflow session graph.

## What becomes a node

- Markdown notes under an optional vault directory. Set `OS_MEMORY_GRAPH_ROOT`, or type a path in the app. The path must pass the normal read-root jail. `~/vault` is on the sensitive-home denylist; `~/notes` or `~/obsidian/vault` are usable when they sit inside `OS_FS_READ_ROOTS`.
- `.mso/KNOWLEDGE.md` and a bounded set of repo-local `.agent` memory records for a named project. With no vault and no project, the scan includes up to four discovered projects.
- Typed agent memory for the signed-in device (`cli:<device id>`, the same principal Alfa Cockpit uses). Private and restricted claims show as “Private memory”.
- Assistant memories from the owner memory store.

`[[Title]]` links resolve to a note with that title or path. Anything unresolved is a ghost. Relative `.md` links become edges when the target file is in the graph. Folder hubs connect two or more notes in the same top-level folder.

## Using the view

- **Web**, **Radial**, and **Layered** rearrange the same nodes.
- **Local** keeps the selected node and its neighbourhood. Hops are 1–4. With nothing selected, the highest-degree node is the centre.
- **Ghosts**, **Tags**, and **Orphans** toggle those nodes. Group chips hide a color group.
- Click a node to select it. Click it again, double-click it, or press **Open** to open a note that has a file path in Code.
- Drag the background to pan. Scroll to zoom.

The scan is capped (notes, depth, directories, project records) and may report that it truncated. Excerpts are redacted for obvious secrets. The route is owner-only; Viewer and Operator are refused.

## Deploy

Merging to `main` does not rebuild a running MSO service. On the host, update with:

```bash
mso update
```
