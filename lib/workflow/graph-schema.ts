import { parseGraphCustomNodes } from "@/lib/contracts/graph-custom-nodes";
import { WORKFLOW_GRAPH_NODE_TYPES, type WorkflowGraphEdge, type WorkflowGraphMetadata, type WorkflowGraphNode, type WorkflowGraphStatus } from "@/lib/contracts/workflow-graph";

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const NODE_TYPES = new Set<string>(WORKFLOW_GRAPH_NODE_TYPES);
const STATUSES = new Set<WorkflowGraphStatus>(["draft", "active", "archived"]);
const SECRET_KEY = /^(secrets?|secretValue|password|passphrase|token|apiKey|apiToken|accessToken|refreshToken|authorization|headers|cookie|cookies|__proto__|constructor|prototype)$/i;

export type WorkflowGraphDefinition = {
  id?: string;
  name: string;
  description: string;
  status: WorkflowGraphStatus;
  inputs: Record<string, unknown>;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  metadata: WorkflowGraphMetadata;
};

export function graphObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function assertWorkflowMetadataOnly(value: unknown, depth = 0): void {
  if (depth > 14) throw new Error("workflow graph metadata too deep");
  if (Array.isArray(value)) { value.forEach((item) => assertWorkflowMetadataOnly(item, depth + 1)); return; }
  if (!graphObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw new Error("secret_input_forbidden");
    assertWorkflowMetadataOnly(child, depth + 1);
  }
}

function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function safePosition(value: unknown): { x: number; y: number } {
  if (!graphObject(value)) throw new Error("node position must be an object");
  const x = Number(value.x), y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 100_000 || Math.abs(y) > 100_000) throw new Error("node position invalid");
  return { x, y };
}

function parseNode(value: unknown): WorkflowGraphNode {
  if (!graphObject(value)) throw new Error("invalid workflow node");
  if (!text(value.id, 96) || !ID.test(value.id)) throw new Error("invalid workflow node id");
  if (!text(value.name, 120)) throw new Error("invalid workflow node name");
  if (typeof value.type !== "string" || !NODE_TYPES.has(value.type)) throw new Error("invalid workflow node type");
  if (!graphObject(value.config)) throw new Error("workflow node config must be an object");
  assertWorkflowMetadataOnly(value.config);
  if (value.disabled !== undefined && typeof value.disabled !== "boolean") throw new Error("invalid workflow node disabled flag");
  return { id: value.id, name: value.name, type: value.type as WorkflowGraphNode["type"], position: safePosition(value.position), config: structuredClone(value.config), ...(value.disabled ? { disabled: true } : {}) };
}

function parseEdge(value: unknown, nodeIds: Set<string>): WorkflowGraphEdge {
  if (!graphObject(value) || !text(value.id, 96) || !ID.test(value.id) || !text(value.source, 96) || !text(value.target, 96)) throw new Error("invalid workflow edge");
  if (!nodeIds.has(value.source) || !nodeIds.has(value.target) || value.source === value.target) throw new Error("workflow edge references invalid node");
  const handle = (key: "sourceHandle" | "targetHandle") => value[key] === undefined ? undefined : (text(value[key], 64) && ID.test(value[key] as string) ? String(value[key]) : (() => { throw new Error("invalid workflow edge handle"); })());
  if (value.style !== undefined && !["solid", "dashed"].includes(String(value.style))) throw new Error("invalid workflow edge style");
  if (value.disabled !== undefined && typeof value.disabled !== "boolean") throw new Error("invalid workflow edge disabled flag");
  return {
    id: value.id, source: value.source, target: value.target,
    ...(handle("sourceHandle") ? { sourceHandle: handle("sourceHandle") } : {}),
    ...(handle("targetHandle") ? { targetHandle: handle("targetHandle") } : {}),
    ...(value.style === "dashed" ? { style: "dashed" as const } : value.style === "solid" ? { style: "solid" as const } : {}),
    ...(value.disabled === true ? { disabled: true } : {}),
  };
}

function assertAcyclic(nodes: WorkflowGraphNode[], edges: WorkflowGraphEdge[]): void {
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of edges) { indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1); outgoing.get(edge.source)?.push(edge.target); }
  const queue = [...indegree.entries()].filter(([, count]) => count === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!; visited += 1;
    for (const target of outgoing.get(id) ?? []) { const next = (indegree.get(target) ?? 0) - 1; indegree.set(target, next); if (next === 0) queue.push(target); }
  }
  if (visited !== nodes.length) throw new Error("workflow graph contains a cycle; use the loop node with a subflow/body binding instead of cyclic edges");
}

function parseMetadata(value: unknown, nodeIds: ReadonlySet<string>): WorkflowGraphMetadata {
  if (value === undefined) return {};
  if (!graphObject(value)) throw new Error("workflow metadata must be an object");
  assertWorkflowMetadataOnly(value);
  const out: WorkflowGraphMetadata = {};
  if (value.customNodes !== undefined) out.customNodes = parseGraphCustomNodes(value.customNodes, nodeIds);
  for (const key of ["intent", "normalizedIntent", "project", "fingerprint", "folder", "errorWorkflowId", "timezone"] as const) if (typeof value[key] === "string" && value[key]) out[key] = String(value[key]).slice(0, 1000);
  if (["user", "learned-from-session", "clone", "import", "template", "ai-assisted"].includes(String(value.provenance))) out.provenance = value.provenance as WorkflowGraphMetadata["provenance"];
  if (Array.isArray(value.sourceDigests)) out.sourceDigests = value.sourceDigests.filter((item): item is string => typeof item === "string").slice(0, 32).map((item) => item.slice(0, 128));
  if (Array.isArray(value.tags)) out.tags = value.tags.filter((item): item is string => typeof item === "string").slice(0, 32).map((item) => item.slice(0, 64));
  return out;
}

export function parseWorkflowGraphDefinition(raw: unknown): WorkflowGraphDefinition {
  if (!graphObject(raw) || Buffer.byteLength(JSON.stringify(raw)) > 256 * 1024) throw new Error("workflow graph must be an object up to 256 KiB");
  assertWorkflowMetadataOnly(raw);
  if (raw.id !== undefined && (!text(raw.id, 96) || !ID.test(raw.id))) throw new Error("invalid workflow graph id");
  if (!text(raw.name, 160) || typeof raw.description !== "string" || raw.description.length > 2000) throw new Error("workflow graph name/description invalid");
  if (typeof raw.status !== "string" || !STATUSES.has(raw.status as WorkflowGraphStatus)) throw new Error("workflow graph status invalid");
  if (!graphObject(raw.inputs) || Object.keys(raw.inputs).length > 64) throw new Error("workflow graph inputs invalid");
  if (!Array.isArray(raw.nodes) || raw.nodes.length < 1 || raw.nodes.length > 200) throw new Error("workflow graph needs 1-200 nodes");
  const nodes = raw.nodes.map(parseNode), nodeIds = new Set(nodes.map((node) => node.id));
  if (nodeIds.size !== nodes.length) throw new Error("duplicate workflow node id");
  if (!Array.isArray(raw.edges) || raw.edges.length > 400) throw new Error("workflow graph supports up to 400 edges");
  const edges = raw.edges.map((edge) => parseEdge(edge, nodeIds));
  if (new Set(edges.map((edge) => edge.id)).size !== edges.length) throw new Error("duplicate workflow edge id");
  const activeEdges = edges.filter((edge) => !edge.disabled);
  const triggerIds = new Set(nodes.filter((node) => ["manual", "schedule", "webhook", "channel_trigger"].includes(node.type)).map((node) => node.id));
  if (activeEdges.some((edge) => triggerIds.has(edge.target))) throw new Error("trigger nodes must be workflow roots");
  assertAcyclic(nodes, activeEdges);
  return { ...(typeof raw.id === "string" ? { id: raw.id } : {}), name: raw.name.trim(), description: raw.description, status: raw.status as WorkflowGraphStatus, inputs: structuredClone(raw.inputs), nodes, edges, metadata: parseMetadata(raw.metadata, nodeIds) };
}

export function normalizeWorkflowIntent(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ").slice(0, 1000);
}
