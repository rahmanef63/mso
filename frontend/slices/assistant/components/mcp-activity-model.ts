export type McpActivityState = "started" | "completed" | "failed" | "denied" | "rate_limited" | "cancelled";

export type McpActivityRow = {
  id: string;
  ts: string;
  actor?: string | null;
  tool: string;
  state: McpActivityState;
  scope?: string;
  workflowId?: string;
  workflowIntent?: string;
  workflowProject?: string;
  target?: string;
  durationMs?: number;
  detail?: string;
};

export type McpActivityGroup = {
  key: string;
  workflowId?: string;
  intent?: string;
  project?: string;
  rows: McpActivityRow[];
  state: "running" | "attention" | "cancelled" | "done" | "completed" | "active";
  durationMs: number;
  updatedAt: string;
};

export function collapseActivity(entries: McpActivityRow[], limit = 120): McpActivityRow[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  }).slice(0, limit);
}

export function groupActivity(entries: McpActivityRow[]): McpActivityGroup[] {
  const groups = new Map<string, McpActivityGroup>();
  for (const row of collapseActivity(entries)) {
    const key = row.workflowId ? `workflow:${row.workflowId}` : `single:${row.id}`;
    const current = groups.get(key) ?? {
      key,
      workflowId: row.workflowId,
      intent: row.workflowIntent,
      project: row.workflowProject,
      rows: [],
      state: "active" as const,
      durationMs: 0,
      updatedAt: row.ts,
    };
    current.intent ??= row.workflowIntent;
    current.project ??= row.workflowProject;
    current.rows.push(row);
    current.durationMs += row.durationMs ?? 0;
    if (new Date(row.ts).getTime() > new Date(current.updatedAt).getTime()) current.updatedAt = row.ts;
    groups.set(key, current);
  }

  for (const group of groups.values()) {
    group.rows.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    if (group.rows.some((row) => row.state === "started")) group.state = "running";
    else if (group.rows.some((row) => ["failed", "denied", "rate_limited"].includes(row.state))) group.state = "attention";
    else if (group.rows.some((row) => row.state === "cancelled" || (row.tool === "workflow_cancel" && row.state === "completed"))) group.state = "cancelled";
    else if (group.rows.some((row) => row.tool === "workflow_finish" && row.state === "completed")) group.state = "done";
    else if (group.rows.some((row) => row.tool === "alfa.chat" && row.state === "completed")) group.state = "completed";
    else if (!group.workflowId && group.rows.every((row) => row.state === "completed")) group.state = "completed";
    else group.state = "active";
  }

  return [...groups.values()].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}
