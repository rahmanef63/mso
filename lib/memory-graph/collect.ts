// Owner memory-graph collector. Vault markdown, one project's knowledge and
// repo memory, the signed-in device's typed agent memory, and assistant memories.

import path from "node:path";
import { workspaceSources } from "./workspace-sources";
import { queryAgentMemory } from "@/lib/agent/memory-store";
import { listMemories } from "@/lib/agent/legacy-owner-memory";
import type { AgentMemoryRecord } from "@/lib/agent/memory-types";
import { listProjects, readProjectKnowledge, resolveProjectHint } from "@/lib/host/projects-api";
import { listRepoMemoryRecords } from "@/lib/orchestration/repo-memory";
import { redactText } from "@/lib/orchestration/redaction";
import { assembleMemoryGraph } from "./assemble";
import type { GraphInputLink, GraphInputNode, MemoryGraphDocument } from "./types";
import { readVaultNotes } from "./vault";

const PROJECT_CAP = 4;
const RECORD_CAP = 12;

export interface CollectInput {
  root: string;
  project: string;
  principal: string;
  ownerView?: boolean;
}

function folderHubs(notes: GraphInputNode[]): { nodes: GraphInputNode[]; links: GraphInputLink[] } {
  const groups = new Map<string, string[]>();
  for (const note of notes) {
    if (note.kind !== "note") continue;
    groups.set(note.group, [...(groups.get(note.group) ?? []), note.id]);
  }
  const nodes: GraphInputNode[] = [];
  const links: GraphInputLink[] = [];
  for (const [group, ids] of groups) {
    if (ids.length < 2) continue;
    const id = `folder:${group}`;
    nodes.push({ id, title: group, kind: "folder", group });
    for (const targetId of ids) links.push({ source: id, targetId, kind: "contains" });
  }
  return { nodes, links };
}

function agentPieces(records: Array<{ record: AgentMemoryRecord }>): { nodes: GraphInputNode[]; links: GraphInputLink[] } {
  const nodes: GraphInputNode[] = [];
  const links: GraphInputLink[] = [];
  const seenDocs = new Set<string>();
  for (const row of records) {
    const record = row.record;
    if (!seenDocs.has(record.document)) {
      seenDocs.add(record.document);
      nodes.push({ id: `agent-doc:${record.document}`, title: record.document, kind: "folder", group: "Agent memory" });
    }
    const priv = record.sensitivity !== "normal";
    nodes.push({
      id: `agent:${record.id}`,
      title: record.key.slice(0, 80),
      kind: "agent",
      group: "Agent memory",
      excerpt: priv ? "Private memory" : redactText(record.value, 160),
      text: priv ? "" : record.value,
    });
    links.push({ source: `agent-doc:${record.document}`, targetId: `agent:${record.id}`, kind: "contains" });
    for (const prior of record.supersedes ?? []) {
      links.push({ source: `agent:${record.id}`, targetId: `agent:${prior}`, kind: "related" });
    }
  }
  return { nodes, links };
}

async function projectPieces(projectPath: string, projectId: string, projectName: string): Promise<{ nodes: GraphInputNode[]; links: GraphInputLink[]; truncated: boolean }> {
  const nodes: GraphInputNode[] = [];
  const links: GraphInputLink[] = [];
  const hub = `project:${projectId}`;
  nodes.push({ id: hub, title: projectName, kind: "folder", group: projectName });
  const knowledge = await readProjectKnowledge(projectPath);
  if (knowledge?.exists && knowledge.content.trim()) {
    const id = `knowledge:${projectId}`;
    nodes.push({
      id, title: `${projectName} knowledge`, kind: "knowledge", group: projectName,
      path: path.join(projectPath, knowledge.path),
      excerpt: redactText(knowledge.content, 160),
      text: knowledge.content,
    });
    links.push({ source: hub, targetId: id, kind: "contains" });
  }
  const records = await listRepoMemoryRecords(projectPath, { limit: RECORD_CAP + 1 });
  for (const record of records.slice(0, RECORD_CAP)) {
    const id = `memory:${projectId}:${record.id}`;
    const summary = redactText(`${record.title}\n${record.summary}`, 160);
    nodes.push({ id, title: record.title.slice(0, 80), kind: "memory", group: projectName, excerpt: summary, text: `${record.title}\n${record.summary}` });
    links.push({ source: hub, targetId: id, kind: "contains" });
    for (const prior of record.supersedes) links.push({ source: id, targetId: `memory:${projectId}:${prior}`, kind: "related" });
  }
  return { nodes, links, truncated: records.length > RECORD_CAP };
}

export async function collectMemoryGraph(input: CollectInput): Promise<MemoryGraphDocument> {
  const warnings: string[] = [];
  let truncated = false;
  const nodes: GraphInputNode[] = [];
  const links: GraphInputLink[] = [];

  const vault = await readVaultNotes(input.root);
  if (vault.warning) warnings.push(vault.warning);
  truncated = vault.truncated;
  nodes.push(...vault.notes);
  const hubs = folderHubs(vault.notes);
  nodes.push(...hubs.nodes);
  links.push(...hubs.links);

  const projectTargets: Array<{ id: string; name: string; path: string }> = [];
  if (input.project.trim()) {
    const resolved = await resolveProjectHint(input.project.trim()).catch(() => null);
    if (!resolved) warnings.push("Project was not found");
    else projectTargets.push(resolved);
  } else if (!vault.root) {
    const listed = await listProjects({ limit: PROJECT_CAP }).catch((error: unknown) => {
      warnings.push(error instanceof Error ? error.message.slice(0, 160) : "Project scan failed");
      return { projects: [] as Array<{ id: string; name: string; path: string }> };
    });
    projectTargets.push(...listed.projects.slice(0, PROJECT_CAP));
    if (("hasMore" in listed && listed.hasMore) || ("scan" in listed && listed.scan?.truncated)) truncated = true;
  }

  for (const project of projectTargets) {
    try {
      const piece = await projectPieces(project.path, project.id, project.name);
      truncated ||= piece.truncated;
      nodes.push(...piece.nodes);
      links.push(...piece.links);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message.slice(0, 160) : "Project memory failed");
    }
  }

  try {
    const agent = await queryAgentMemory(input.principal, { limit: 41 });
    if (agent.records.length > 40) truncated = true;
    const piece = agentPieces(agent.records.slice(0, 40));
    nodes.push(...piece.nodes);
    links.push(...piece.links);
  } catch (error) {
    warnings.push(error instanceof Error ? error.message.slice(0, 160) : "Agent memory unavailable");
  }

  try {
    const memories = await listMemories();
    if (memories.length > 40) truncated = true;
    for (const memory of memories.slice(0, 40)) {
      nodes.push({
        id: `owner:${memory.id}`,
        title: memory.text.split("\n")[0]?.slice(0, 80) || "Memory",
        kind: "memory",
        group: "Assistant memory",
        excerpt: redactText(memory.text, 160),
        text: memory.text,
      });
    }
  } catch (error) {
    warnings.push(error instanceof Error ? error.message.slice(0, 160) : "Assistant memory unavailable");
  }

  if (input.ownerView) {
    const workspace = await workspaceSources("owner", input.principal, projectTargets, Boolean(input.project.trim()));
    nodes.push(...workspace.nodes); links.push(...workspace.links); warnings.push(...workspace.warnings); truncated ||= workspace.truncated;
  }
  warnings.push("Bounded projection: up to 4 projects, 12 records/project, 40 device memories, 40 assistant memories, and 160 workspace nodes. Use Workflows > Sources and session Self-improve for paginated history.");
  const graph = assembleMemoryGraph(nodes, links, { includeGhosts: true, includeTags: true });
  return { ...graph, truncated, warnings, root: vault.root };
}
