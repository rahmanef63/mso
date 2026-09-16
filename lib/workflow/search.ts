import type { WorkflowGraph } from "@/lib/contracts/workflow-graph";

export type WorkflowSearchFilters = {
  tag?: string;
  status?: string;
  project?: string;
  folder?: string;
  node?: string;
};

type SearchToken = { operator?: keyof WorkflowSearchFilters; value: string };
const OPERATORS = new Set<keyof WorkflowSearchFilters>(["tag", "status", "project", "folder", "node"]);
const SAFE_CONFIG_KEYS = new Set(["tool", "name", "server", "flow", "workflowId", "script_id", "query", "source", "message"]);
const SECRETISH = /(secret|token|password|credential|authorization|cookie|api[_-]?key)/i;

function norm(value: unknown): string {
  return String(value ?? "").toLowerCase().trim();
}

function parseQuery(query: string): SearchToken[] {
  const tokens: SearchToken[] = [];
  const pattern = /(?:^|\s)(?:(tag|status|project|folder|node):(?:"([^"]*)"|'([^']*)'|(\S+))|"([^"]*)"|'([^']*)'|(\S+))/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(query)) !== null) {
    const operator = match[1]?.toLowerCase() as keyof WorkflowSearchFilters | undefined;
    const value = match[2] ?? match[3] ?? match[4] ?? match[5] ?? match[6] ?? match[7] ?? "";
    if (!value.trim()) continue;
    tokens.push(operator && OPERATORS.has(operator) ? { operator, value } : { value });
  }
  return tokens;
}

function safeNodeConfigText(graph: WorkflowGraph): string {
  const values: string[] = [];
  for (const node of graph.nodes) {
    for (const [key, value] of Object.entries(node.config ?? {})) {
      if (!SAFE_CONFIG_KEYS.has(key) || SECRETISH.test(key)) continue;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") values.push(String(value).slice(0, 500));
    }
  }
  return values.join(" ").toLowerCase();
}

function freeText(graph: WorkflowGraph): string {
  return [
    graph.name,
    graph.description,
    graph.status,
    graph.metadata.folder,
    graph.metadata.project,
    ...(graph.metadata.tags ?? []),
    ...graph.nodes.flatMap((node) => [node.name, node.type]),
    safeNodeConfigText(graph),
  ].filter(Boolean).join(" ").toLowerCase();
}

function matchesOperator(graph: WorkflowGraph, operator: keyof WorkflowSearchFilters, rawValue: string): boolean {
  const value = norm(rawValue);
  if (!value) return true;
  if (operator === "tag") return (graph.metadata.tags ?? []).some((tag) => norm(tag) === value);
  if (operator === "status") return norm(graph.status) === value;
  if (operator === "project") return norm(graph.metadata.project).includes(value);
  if (operator === "folder") return norm(graph.metadata.folder).includes(value);
  if (operator === "node") return graph.nodes.some((node) => `${node.type} ${node.name}`.toLowerCase().includes(value));
  return false;
}

export function workflowMatchesQuery(graph: WorkflowGraph, query = "", filters: WorkflowSearchFilters = {}): boolean {
  for (const [operator, raw] of Object.entries(filters) as Array<[keyof WorkflowSearchFilters, string | undefined]>) {
    if (raw && !matchesOperator(graph, operator, raw)) return false;
  }
  const haystack = freeText(graph);
  for (const token of parseQuery(query)) {
    if (token.operator) {
      if (!matchesOperator(graph, token.operator, token.value)) return false;
      continue;
    }
    if (!haystack.includes(norm(token.value))) return false;
  }
  return true;
}

export function workflowTagQuery(tag: string): string {
  const safe = tag.replace(/["\r\n]/g, " ").trim();
  return /\s/.test(safe) ? `tag:"${safe}"` : `tag:${safe}`;
}
