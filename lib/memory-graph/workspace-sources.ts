import { getOrganizationChart } from "@/lib/agent/organization-store";
import { queryAgentMemory } from "@/lib/agent/memory-store";
import { discoverOwnerGraphs, requireDiscoveryOwner } from "@/lib/workflow/owner-discovery";
import { listLearnedRecipes } from "@/lib/workflow/learning";
import { redactText } from "@/lib/security/redact-text";
import type { GraphInputNode, GraphInputLink } from "./types";

type ProjectTarget = { id: string; name: string; path: string };
const NODE_CAP = 160;

/** Owner-console projection only. Does not alter agent retrieval scopes or grants. */
export async function workspaceSources(role: string, principal: string, projects: ProjectTarget[], filtered: boolean) {
  requireDiscoveryOwner(role);
  const nodes: GraphInputNode[] = [], links: GraphInputLink[] = [], warnings: string[] = [];
  let truncated = false;
  const projectFor = (ref?: string) => projects.find(project => ref && [project.id, project.name, project.path].includes(ref));
  const allowed = (ref?: string) => !filtered || Boolean(projectFor(ref));
  const add = (node: GraphInputNode) => { if (nodes.length >= NODE_CAP) { truncated = true; return false; } nodes.push(node); return true; };
  const linkProject = (source: string, ref?: string) => {
    const project = projectFor(ref); if (project) links.push({ source, targetId: `project:${project.id}`, kind: "related" });
  };
  try {
    const chart = await getOrganizationChart();
    if (chart.units.length > 12) truncated = true;
    for (const unit of chart.units.slice(0, 12)) {
      const candidates = (unit.projectFlow?.nodes ?? []).filter(node => allowed(node.projectRef));
      if (filtered && !candidates.length) continue;
      const hub = `organization:${unit.id}`;
      add({ id: hub, title: redactText(unit.name, 80), kind: "folder", group: "Organization", targetApp: "organization" });
      if (candidates.length > 12) truncated = true;
      const visible = new Set<string>();
      for (const node of candidates.slice(0, 12)) {
        const id = `${hub}:${node.id}`;
        if (!add({ id, title: redactText(node.title, 80), kind: "knowledge", group: "Organization", targetApp: "organization", excerpt: redactText(`${node.status}: ${node.summary}`, 160) })) break;
        visible.add(node.id); links.push({ source: hub, targetId: id, kind: "contains" }); linkProject(id, node.projectRef);
      }
      for (const edge of unit.projectFlow?.edges ?? []) if (visible.has(edge.source) && visible.has(edge.target)) links.push({ source: `${hub}:${edge.source}`, targetId: `${hub}:${edge.target}`, kind: "related" });
    }
  } catch { warnings.push("Organization metadata could not be loaded"); }
  try {
    const page = await discoverOwnerGraphs(role, principal);
    warnings.push(...page.scan.warnings);
    if (page.scan.nextOwnerOffset !== undefined) truncated = true;
    const candidates = page.graphs.filter(graph => allowed(graph.project));
    if (candidates.length > 40) truncated = true;
    add({ id: "workspace:workflows", title: "Saved workflows", kind: "folder", group: "Workflows", targetApp: "workflows" });
    for (const graph of candidates.slice(0, 40)) {
      const id = `workflow:${graph.owner}:${graph.id}`;
      if (!add({ id, title: redactText(graph.name, 80), kind: "memory", group: "Workflows", targetApp: "workflows", origin: graph.originPrincipal, excerpt: `${graph.status} · ${graph.nodeCount} nodes · source remains read-only` })) break;
      links.push({ source: "workspace:workflows", targetId: id, kind: "contains" }); linkProject(id, graph.project);
    }
  } catch { warnings.push("Workflow source metadata could not be loaded"); }
  try {
    const recipes = (await listLearnedRecipes({ ownerView: true })).filter(recipe => allowed(recipe.project));
    if (recipes.length > 24) truncated = true;
    add({ id: "workspace:recipes", title: "Learned recipes", kind: "folder", group: "Recipes", targetApp: "workflows" });
    for (const recipe of recipes.slice(0, 24)) {
      const id = `recipe:${recipe.id}`;
      if (!add({ id, title: redactText(recipe.intent, 80), kind: "memory", group: "Recipes", targetApp: "workflows", origin: recipe.actor, excerpt: `${recipe.successes}/${recipe.attempts} successful attempts; availability is not whole-session review proof` })) break;
      links.push({ source: "workspace:recipes", targetId: id, kind: "contains" }); linkProject(id, recipe.project);
    }
    // Show provenance of non-browser typed memory without exporting private values.
    const actors = [...new Set(recipes.map(recipe => recipe.actor))].filter(actor => actor !== principal);
    if (actors.length > 2) truncated = true;
    // Typed agent memory is not project-indexed. Do not mix it into an explicit project filter.
    for (const actor of (filtered ? [] : actors.slice(0, 2))) {
      const result = await queryAgentMemory(actor, { limit: 13 });
      if (result.records.length > 12) truncated = true;
      for (const { record } of result.records.slice(0, 12)) {
        add({ id: `owner-agent:${record.id}`, title: redactText(record.key, 80), kind: "agent", group: "Owner agent sources", origin: actor,
          excerpt: `${record.kind} · ${record.document} · ${record.sensitivity === "normal" ? redactText(record.value, 120) : "Private memory; value not included in this projection"}` });
      }
    }
  } catch { warnings.push("Recipe or owner-agent metadata could not be loaded"); }
  return { nodes, links, warnings, truncated };
}
