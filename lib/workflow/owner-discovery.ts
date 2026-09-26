import { createHash } from "node:crypto";
// Browser-owner-only metadata discovery. Never used by client/MCP graph dispatch.
import path from "node:path";
import { agentSessionsDir } from "@/lib/agent/session-paths";
import { listWorkflowFiles } from "./private-file";
import { createWorkflowGraph, readWorkflowGraphStore, workflowGraphOwner } from "./graph-store";
import type { WorkflowDiscoveryPage } from "@/lib/contracts/workflow-discovery";
export function requireDiscoveryOwner(role: string) {
  if (role !== "owner") throw new Error("owner_required");
}
export async function discoverOwnerGraphs(role: string, principal: string, offset = 0): Promise<WorkflowDiscoveryPage> {
  requireDiscoveryOwner(role);
  let owners: string[];
  try { owners = (await listWorkflowFiles(path.join(agentSessionsDir(), ".workflow-graphs"))).filter(x => /^[a-f0-9]{64}$/.test(x)).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; owners = []; }
  const start = Math.max(0, Math.trunc(offset) || 0), selected = owners.slice(start, start + 4);
  const graphs: WorkflowDiscoveryPage["graphs"] = [], warnings: string[] = [];
  for (const owner of selected) {
    try {
      const store = await readWorkflowGraphStore(owner);
      if (!store.principal || workflowGraphOwner(store.principal) !== owner) { warnings.push(`Unresolved origin: ${owner}`); continue; }
      graphs.push(...store.graphs.map(g => ({ id: g.id, name: g.name, status: g.status, project: g.metadata.project,
        updatedAt: g.updatedAt, revision: g.revision, originPrincipal: store.principal, owner, readOnly: store.principal !== principal, nodeCount: g.nodes.length })));
    } catch { warnings.push(`Graph metadata unavailable: ${owner}`); }
  }
  return { graphs, scan: { ownerOffset: start, ownersScanned: selected.length, totalOwners: owners.length,
    ...(start + selected.length < owners.length ? { nextOwnerOffset: start + selected.length } : {}), warnings } };
}
export async function cloneOwnerGraph(role: string, principal: string, owner: string, id: string, expectedRevision: string) {
  requireDiscoveryOwner(role);
  const store = await readWorkflowGraphStore(owner);
  if (!store.principal || workflowGraphOwner(store.principal) !== owner) throw new Error("unresolved graph origin");
  const graph = store.graphs.find(g => g.id === id);
  if (!graph) throw new Error("workflow graph not found");
  if (graph.revision !== expectedRevision) throw new Error("source revision changed; refresh before copying");
  // Copy into caller namespace; the source and its immutable origin are untouched.
  return createWorkflowGraph(principal, { ...graph, id: undefined, name: `${graph.name} Copy`.slice(0, 160), status: "draft",
    nodes: graph.nodes.map(node => ["manual", "output"].includes(node.type) ? node : { ...node, disabled: true }),
    metadata: { ...graph.metadata, provenance: "clone", fingerprint: undefined, sourceDigests: [createHash("sha256").update(`${owner}:${id}:${graph.revision}`).digest("hex")], tags: [...new Set([...(graph.metadata.tags ?? []), "review-required"])].slice(0, 32) } });
}
