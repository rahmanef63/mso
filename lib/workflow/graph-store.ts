import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { agentSessionsDir } from "@/lib/agent/session-paths";
import type { LearnedRecipe } from "./types";
import type { WorkflowGraph } from "@/lib/contracts/workflow-graph";
import { normalizeWorkflowIntent, parseWorkflowGraphDefinition, type WorkflowGraphDefinition } from "./graph-schema";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { saveWorkflowGraphVersion, type WorkflowGraphVersionReason } from "./graph-version-store";

const STORE_VERSION = 2;
const MAX_STORE_BYTES = 4 * 1024 * 1024;
const MAX_GRAPHS = 200;

type WorkflowGraphStore = { version: 2; owner: string; principal: string; graphs: WorkflowGraph[] };

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
export function workflowGraphOwner(principal: string): string { return hash(principal); }
function root(): string { return path.join(agentSessionsDir(), ".workflow-graphs"); }
function file(owner: string): string {
  if (!/^[a-f0-9]{64}$/.test(owner)) throw new Error("invalid workflow graph owner");
  return path.join(root(), owner, "graphs.json");
}
function graphRevision(graph: Omit<WorkflowGraph, "revision">): string { return hash(JSON.stringify(graph)); }

async function safeDirectory(owner: string): Promise<string> {
  const dir = path.dirname(file(owner));
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("unsafe workflow graph directory");
  await fs.chmod(dir, 0o700).catch(() => undefined);
  return dir;
}

function parseStoredGraph(raw: unknown): WorkflowGraph {
  if (!raw || typeof raw !== "object") throw new Error("invalid stored workflow graph");
  const row = raw as Partial<WorkflowGraph>;
  const definition = parseWorkflowGraphDefinition(row);
  if (typeof row.id !== "string" || typeof row.createdAt !== "string" || typeof row.updatedAt !== "string" || typeof row.revision !== "string") throw new Error("invalid stored workflow graph metadata");
  return { ...definition, version: 2, id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt, revision: row.revision };
}

async function readStore(owner: string, principal = ""): Promise<WorkflowGraphStore> {
  const target = file(owner);
  try {
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_STORE_BYTES || (stat.mode & 0o077)) throw new Error("unsafe workflow graph store");
    const parsed: unknown = JSON.parse(await fs.readFile(target, "utf8"));
    if (!parsed || typeof parsed !== "object") throw new Error("invalid workflow graph store");
    const row = parsed as { version?: unknown; owner?: unknown; principal?: unknown; graphs?: unknown };
    if (row.owner !== owner || !Array.isArray(row.graphs) || row.graphs.length > MAX_GRAPHS) throw new Error("invalid workflow graph store");
    if (row.version === 1) return { version: 2, owner, principal, graphs: row.graphs.map(parseStoredGraph) };
    if (row.version !== STORE_VERSION || typeof row.principal !== "string") throw new Error("invalid workflow graph store");
    return { version: 2, owner, principal: row.principal, graphs: row.graphs.map(parseStoredGraph) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 2, owner, principal, graphs: [] };
    throw error;
  }
}

async function writeStore(store: WorkflowGraphStore): Promise<void> {
  await safeDirectory(store.owner);
  const target = file(store.owner), temp = `${target}.${randomUUID()}.tmp`;
  const body = JSON.stringify(store, null, 2) + "\n";
  if (Buffer.byteLength(body) > MAX_STORE_BYTES) throw new Error("workflow graph store exceeds 4 MiB");
  try {
    await fs.writeFile(temp, body, { flag: "wx", mode: 0o600 });
    await fs.rename(temp, target);
  } finally { await fs.unlink(temp).catch(() => undefined); }
}

function withGraphLock<T>(owner: string, fn: () => Promise<T>): Promise<T> {
  return withSecurityStoreLock(file(owner), fn);
}

function materialize(definition: WorkflowGraphDefinition, previous?: WorkflowGraph): WorkflowGraph {
  const now = new Date().toISOString(), id = definition.id ?? previous?.id ?? randomUUID();
  const base = {
    version: 2 as const, id, name: definition.name, description: definition.description,
    status: definition.status, inputs: definition.inputs, nodes: definition.nodes, edges: definition.edges,
    metadata: definition.metadata, createdAt: previous?.createdAt ?? now, updatedAt: now,
  };
  return { ...base, revision: graphRevision(base) };
}

export async function listWorkflowGraphs(principal: string): Promise<WorkflowGraph[]> {
  const owner = workflowGraphOwner(principal), store = await readStore(owner, principal);
  return store.graphs.slice().sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export async function getWorkflowGraph(principal: string, id: string): Promise<WorkflowGraph | null> {
  return (await listWorkflowGraphs(principal)).find((graph) => graph.id === id) ?? null;
}

export async function createWorkflowGraph(principal: string, raw: unknown, reason: WorkflowGraphVersionReason = "create"): Promise<WorkflowGraph> {
  const owner = workflowGraphOwner(principal), definition = parseWorkflowGraphDefinition(raw);
  return withGraphLock(owner, async () => {
    const store = await readStore(owner, principal);
    if (store.graphs.length >= MAX_GRAPHS) throw new Error("private workflow graph limit reached");
    const graph = materialize({ ...definition, id: definition.id ?? randomUUID() });
    if (store.graphs.some((row) => row.id === graph.id)) throw new Error("workflow graph id already exists");
    store.principal = principal; store.graphs.push(graph); await writeStore(store); await saveWorkflowGraphVersion(owner, graph, reason); return graph;
  });
}

export async function updateWorkflowGraph(principal: string, id: string, expectedRevision: string, raw: unknown, reason: WorkflowGraphVersionReason = "update"): Promise<WorkflowGraph> {
  const owner = workflowGraphOwner(principal), definition = parseWorkflowGraphDefinition(raw);
  return withGraphLock(owner, async () => {
    const store = await readStore(owner, principal), index = store.graphs.findIndex((graph) => graph.id === id);
    if (index < 0) throw new Error("workflow graph not found");
    const current = store.graphs[index];
    if (current.revision !== expectedRevision) throw new Error("workflow graph revision changed; refresh before editing");
    if (definition.id && definition.id !== id) throw new Error("workflow graph id mismatch");
    const graph = materialize({ ...definition, id }, current); store.principal = principal; store.graphs[index] = graph; await writeStore(store); await saveWorkflowGraphVersion(owner, graph, reason); return graph;
  });
}

export async function deleteWorkflowGraph(principal: string, id: string, expectedRevision: string): Promise<{ id: string; deleted: true }> {
  const owner = workflowGraphOwner(principal);
  return withGraphLock(owner, async () => {
    const store = await readStore(owner, principal), current = store.graphs.find((graph) => graph.id === id);
    if (!current) throw new Error("workflow graph not found");
    if (current.revision !== expectedRevision) throw new Error("workflow graph revision changed; refresh before deleting");
    store.principal = principal; store.graphs = store.graphs.filter((graph) => graph.id !== id); await writeStore(store); return { id, deleted: true };
  });
}

export async function cloneWorkflowGraph(principal: string, id: string): Promise<WorkflowGraph> {
  const source = await getWorkflowGraph(principal, id);
  if (!source) throw new Error("workflow graph not found");
  return createWorkflowGraph(principal, {
    name: `${source.name} Copy`, description: source.description, status: "draft", inputs: source.inputs,
    nodes: source.nodes, edges: source.edges, metadata: { ...source.metadata, provenance: "clone", fingerprint: undefined },
  });
}

function tokens(value: string): Set<string> { return new Set(normalizeWorkflowIntent(value).split(" ").filter((word) => word.length > 2)); }
function overlap(a: string, b: string): number {
  const left = tokens(a), right = tokens(b); if (!left.size || !right.size) return 0;
  let hit = 0; for (const word of left) if (right.has(word)) hit += 1;
  return hit / Math.max(left.size, right.size);
}

export async function findMatchingWorkflowGraph(principal: string, intent: string, projectKeys: string[] = []): Promise<WorkflowGraph | null> {
  const normalized = normalizeWorkflowIntent(intent), projects = new Set(projectKeys.filter(Boolean));
  const candidates = (await listWorkflowGraphs(principal)).filter((graph) => graph.status !== "archived");
  const scored = candidates.map((graph) => {
    const sameIntent = graph.metadata.normalizedIntent === normalized;
    const projectScore = !graph.metadata.project || !projects.size ? 0.2 : projects.has(graph.metadata.project) ? 1 : -1;
    const score = (sameIntent ? 4 : overlap(intent, graph.metadata.intent ?? graph.name) * 2) + projectScore + (graph.status === "active" ? 0.5 : 0);
    return { graph, score };
  }).filter((row) => row.score > 0.85).sort((a, b) => b.score - a.score || Date.parse(b.graph.updatedAt) - Date.parse(a.graph.updatedAt));
  return scored[0]?.graph ?? null;
}

function learnedFingerprint(recipe: LearnedRecipe): string {
  return hash(JSON.stringify({ intent: recipe.normalizedIntent, project: recipe.project ?? "", steps: recipe.bestSteps.map((step) => [step.tool, step.target ?? "", step.args ?? {}]) }));
}

export async function ensureLearnedWorkflowGraph(recipe: LearnedRecipe): Promise<WorkflowGraph | null> {
  if (!recipe.successes || !recipe.bestSteps.length) return null;
  const principal = recipe.actor, fingerprint = learnedFingerprint(recipe), owner = workflowGraphOwner(principal);
  return withGraphLock(owner, async () => {
    const store = await readStore(owner, recipe.actor), existing = store.graphs.find((graph) => graph.metadata.fingerprint === fingerprint);
    if (existing) return existing;
    if (store.graphs.length >= MAX_GRAPHS) return null;
    const nodes = [
      { id: "manual", name: "Manual Trigger", type: "manual" as const, position: { x: 60, y: 120 }, config: {} },
      ...recipe.bestSteps.map((step, index) => ({ id: `step-${index + 1}`, name: step.tool, type: "tool" as const, position: { x: 300 + index * 240, y: 120 }, config: { tool: step.tool, arguments: step.args ?? {}, learnedTarget: step.target ?? "" } })),
      { id: "output", name: "Output", type: "output" as const, position: { x: 300 + recipe.bestSteps.length * 240, y: 120 }, config: {} },
    ];
    const edges = nodes.slice(1).map((node, index) => ({ id: `edge-${index + 1}`, source: nodes[index]!.id, target: node.id }));
    const definition = parseWorkflowGraphDefinition({
      name: recipe.intent.slice(0, 120), description: `Learned draft from ${recipe.successes} successful session run(s).`, status: "draft",
      inputs: {}, nodes, edges, metadata: { intent: recipe.intent, normalizedIntent: recipe.normalizedIntent, project: recipe.project, provenance: "learned-from-session", fingerprint, sourceDigests: [hash(recipe.id)] },
    });
    const graph = materialize({ ...definition, id: randomUUID() }); store.principal = recipe.actor; store.graphs.push(graph); await writeStore(store); await saveWorkflowGraphVersion(owner, graph, "create"); return graph;
  });
}

export async function listWorkflowGraphTriggerSources(): Promise<Array<{ owner: string; principal: string; graph: WorkflowGraph }>> {
  let owners: string[]; try { owners = await fs.readdir(root()); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const out: Array<{ owner: string; principal: string; graph: WorkflowGraph }> = [];
  for (const owner of owners.filter((value) => /^[a-f0-9]{64}$/.test(value)).slice(0, 4096)) {
    const store = await readStore(owner).catch(() => null); if (!store?.principal) continue;
    for (const graph of store.graphs) if (graph.status === "active" && graph.nodes.some((node) => node.type === "schedule" || node.type === "webhook")) out.push({ owner, principal: store.principal, graph });
  }
  return out;
}
