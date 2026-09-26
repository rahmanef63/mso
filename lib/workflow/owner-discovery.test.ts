import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createWorkflowGraph, getWorkflowGraph, workflowGraphOwner } from "./graph-store";
import { discoverOwnerGraphs, cloneOwnerGraph } from "./owner-discovery";
const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
const definition = { name: "Source graph", description: "Owner test", status: "draft", inputs: {}, metadata: {}, nodes: [{ id: "start", name: "Start", type: "manual", position: { x: 0, y: 0 }, config: {} }, { id: "read", name: "Read", type: "tool", position: { x: 200, y: 0 }, config: { tool: "fs_read", arguments: { path: "README.md" } } }], edges: [{ id: "e1", source: "start", target: "read" }] };
describe("owner-only workflow discovery", () => {
  it("does not widen client reads and copies foreign graphs as disabled drafts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-owner-discovery-")); roots.push(root); vi.stubEnv("OS_AGENT_SESSIONS_DIR", root);
    const sourcePrincipal = "mcp-client:source", browser = "web:owner", graph = await createWorkflowGraph(sourcePrincipal, definition);
    await expect(discoverOwnerGraphs("operator", browser)).rejects.toThrow("owner_required");
    expect(await getWorkflowGraph(browser, graph.id)).toBeNull();
    const discovered = await discoverOwnerGraphs("owner", browser);
    expect(discovered.graphs[0]).toMatchObject({ id: graph.id, readOnly: true, originPrincipal: sourcePrincipal });
    const copy = await cloneOwnerGraph("owner", browser, workflowGraphOwner(sourcePrincipal), graph.id, graph.revision);
    expect(copy.status).toBe("draft"); expect(copy.nodes.find(node => node.id === "read")?.disabled).toBe(true);
    expect(copy.metadata.sourceDigests).toHaveLength(1); expect((await getWorkflowGraph(sourcePrincipal, graph.id))?.revision).toBe(graph.revision);
    await expect(cloneOwnerGraph("owner", browser, workflowGraphOwner(sourcePrincipal), graph.id, "stale")).rejects.toThrow("revision changed");
  });
});
