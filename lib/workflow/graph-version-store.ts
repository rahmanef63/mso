import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { WorkflowGraph } from "@/lib/contracts/workflow-graph";
import { agentSessionsDir } from "@/lib/agent/session-paths";

const MAX_VERSIONS = 100;
const MAX_BYTES = 320 * 1024;
export type WorkflowGraphVersionReason = "create" | "update" | "restore" | "import" | "template" | "ai-assisted";
export type WorkflowGraphVersion = { revision: string; savedAt: string; reason: WorkflowGraphVersionReason; graph: WorkflowGraph };

function safe(owner: string, graphId: string) {
  if (!/^[a-f0-9]{64}$/.test(owner) || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/.test(graphId)) throw new Error("invalid workflow version identity");
}
function directory(owner: string, graphId: string) { safe(owner, graphId); return path.join(agentSessionsDir(), ".workflow-graph-versions", owner, graphId); }
function filename(row: WorkflowGraphVersion) { return `${Date.parse(row.savedAt)}-${row.revision}.json`; }

export async function saveWorkflowGraphVersion(owner: string, graph: WorkflowGraph, reason: WorkflowGraphVersionReason): Promise<void> {
  const dir = directory(owner, graph.id); await fs.mkdir(dir, { recursive: true, mode: 0o700 }); await fs.chmod(dir, 0o700).catch(() => undefined);
  const row: WorkflowGraphVersion = { revision: graph.revision, savedAt: new Date().toISOString(), reason, graph: structuredClone(graph) };
  const body = JSON.stringify(row), target = path.join(dir, filename(row)), temp = `${target}.${randomUUID()}.tmp`;
  if (Buffer.byteLength(body) > MAX_BYTES) throw new Error("workflow version snapshot too large");
  try { await fs.writeFile(temp, body, { flag: "wx", mode: 0o600 }); await fs.rename(temp, target); } finally { await fs.unlink(temp).catch(() => undefined); }
  const entries = (await fs.readdir(dir)).filter((name) => /^\d+-[a-f0-9]{64}\.json$/.test(name)).sort().reverse();
  for (const name of entries.slice(MAX_VERSIONS)) await fs.unlink(path.join(dir, name)).catch(() => undefined);
}

export async function listWorkflowGraphVersions(owner: string, graphId: string) {
  const dir = directory(owner, graphId); let entries: string[];
  try { entries = await fs.readdir(dir); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const rows = entries.filter((name) => /^\d+-[a-f0-9]{64}\.json$/.test(name)).sort().reverse().slice(0, MAX_VERSIONS);
  return Promise.all(rows.map(async (name) => {
    const row = JSON.parse(await fs.readFile(path.join(dir, name), "utf8")) as WorkflowGraphVersion;
    return { revision: row.revision, savedAt: row.savedAt, reason: row.reason, name: row.graph.name, nodeCount: row.graph.nodes.length };
  }));
}

export async function readWorkflowGraphVersion(owner: string, graphId: string, revision: string): Promise<WorkflowGraphVersion | null> {
  if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error("invalid workflow revision");
  const dir = directory(owner, graphId); let entries: string[];
  try { entries = await fs.readdir(dir); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  const name = entries.find((entry) => entry.endsWith(`-${revision}.json`)); if (!name) return null;
  const stat = await fs.lstat(path.join(dir, name)); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES || (stat.mode & 0o077)) throw new Error("unsafe workflow version snapshot");
  return JSON.parse(await fs.readFile(path.join(dir, name), "utf8")) as WorkflowGraphVersion;
}
