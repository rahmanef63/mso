import path from "node:path";
import type { WorkflowGraph } from "@/lib/contracts/workflow-graph";
import { agentSessionsDir } from "@/lib/agent/session-paths";
import { listWorkflowFiles, readWorkflowJson, removeWorkflowFile, writeWorkflowFile } from "./private-file";

const MAX_VERSIONS = 100;
const MAX_BYTES = 320 * 1024;
const REVISION = /^[a-f0-9]{64}$/;
const SNAPSHOT_NAME = /^\d+-[a-f0-9]{64}\.json$/;
export type WorkflowGraphVersionReason = "create" | "update" | "restore" | "import" | "template" | "ai-assisted";
export type WorkflowGraphVersion = { revision: string; savedAt: string; reason: WorkflowGraphVersionReason; graph: WorkflowGraph };

function directory(owner: string, graphId: string) {
  if (!/^[a-f0-9]{64}$/.test(owner) || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/.test(graphId)) throw new Error("invalid workflow version identity");
  return path.join(agentSessionsDir(), ".workflow-graph-versions", owner, graphId);
}
function filename(row: WorkflowGraphVersion) {
  if (!REVISION.test(row.revision) || !Number.isFinite(Date.parse(row.savedAt))) throw new Error("invalid workflow revision");
  return `${Date.parse(row.savedAt)}-${row.revision}.json`;
}
async function snapshot(dir: string, graphId: string, name: string): Promise<WorkflowGraphVersion> {
  if (!SNAPSHOT_NAME.test(name)) throw new Error("invalid workflow version filename");
  const row = await readWorkflowJson(path.join(dir, path.basename(name)), MAX_BYTES, "workflow version snapshot") as WorkflowGraphVersion;
  if (!row || !row.graph || row.graph.id !== graphId || row.graph.revision !== row.revision || !Array.isArray(row.graph.nodes) ||
    typeof row.graph.name !== "string" || typeof row.reason !== "string" || filename(row) !== name) throw new Error("invalid workflow version snapshot");
  return row;
}

export async function saveWorkflowGraphVersion(owner: string, graph: WorkflowGraph, reason: WorkflowGraphVersionReason): Promise<void> {
  const dir = directory(owner, graph.id);
  const row: WorkflowGraphVersion = { revision: graph.revision, savedAt: new Date().toISOString(), reason, graph: structuredClone(graph) };
  const body = JSON.stringify(row), target = path.join(dir, filename(row));
  if (Buffer.byteLength(body) > MAX_BYTES) throw new Error("workflow version snapshot too large");
  await writeWorkflowFile(target, body);
  const entries = (await listWorkflowFiles(dir)).filter((name) => SNAPSHOT_NAME.test(name)).sort().reverse();
  for (const name of entries.slice(MAX_VERSIONS)) await removeWorkflowFile(path.join(dir, path.basename(name))).catch(() => undefined);
}

export async function listWorkflowGraphVersions(owner: string, graphId: string) {
  const dir = directory(owner, graphId);
  const rows = (await listWorkflowFiles(dir)).filter((name) => SNAPSHOT_NAME.test(name)).sort().reverse().slice(0, MAX_VERSIONS);
  return Promise.all(rows.map(async (name) => {
    const row = await snapshot(dir, graphId, name);
    return { revision: row.revision, savedAt: row.savedAt, reason: row.reason, name: row.graph.name, nodeCount: row.graph.nodes.length };
  }));
}

export async function readWorkflowGraphVersion(owner: string, graphId: string, revision: string): Promise<WorkflowGraphVersion | null> {
  if (!REVISION.test(revision)) throw new Error("invalid workflow revision");
  const dir = directory(owner, graphId);
  const name = (await listWorkflowFiles(dir)).find((entry) => SNAPSHOT_NAME.test(entry) && entry.endsWith(`-${revision}.json`));
  return name ? snapshot(dir, graphId, name) : null;
}
