import path from "node:path";
import { promises as fs } from "node:fs";
import { resolveProjectHint } from "@/lib/host/projects-api";
import type { WorkflowGraph } from "@/lib/contracts/workflow-graph";

export async function resolveWorkflowGraphNodeTarget(graph: WorkflowGraph, nodeId: string) {
  const node = graph.nodes.find((item) => item.id === nodeId);
  if (!node) throw new Error("workflow node not found");
  if (node.type !== "project" && node.type !== "folder") throw new Error("only project/folder nodes have file targets");
  const hint = typeof node.config.project === "string" ? node.config.project : graph.metadata.project;
  if (!hint) throw new Error("project binding is missing");
  const project = await resolveProjectHint(hint);
  if (!project || project.matchedBy === "fuzzy") throw new Error("project binding is not exact");
  if (node.type === "project") return { project: project.id, name: project.name, path: project.path, relativePath: "." };
  const relative = typeof node.config.path === "string" && node.config.path ? node.config.path : ".";
  const target = path.resolve(project.path, relative), root = project.path.endsWith(path.sep) ? project.path : project.path + path.sep;
  if (target !== project.path && !target.startsWith(root)) throw new Error("folder target escapes project root");
  const stat = await fs.stat(target); if (!stat.isDirectory()) throw new Error("folder target is not a directory");
  return { project: project.id, name: project.name, path: target, relativePath: path.relative(project.path, target) || "." };
}
