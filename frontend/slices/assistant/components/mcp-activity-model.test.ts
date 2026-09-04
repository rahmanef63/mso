import { describe, expect, it } from "vitest";
import { groupActivity, type McpActivityRow } from "./mcp-activity-model";

const row = (value: Partial<McpActivityRow> & Pick<McpActivityRow, "id" | "tool" | "state">): McpActivityRow => ({
  ts: "2026-08-19T14:00:00.000Z", ...value,
});

describe("MCP activity workflow grouping", () => {
  it("collapses start/completion pairs and groups a task chronologically", () => {
    const groups = groupActivity([
      row({ id: "b", tool: "exec_run", state: "completed", workflowId: "w", durationMs: 20, ts: "2026-08-19T14:00:02.000Z" }),
      row({ id: "b", tool: "exec_run", state: "started", workflowId: "w", ts: "2026-08-19T14:00:01.000Z" }),
      row({ id: "a", tool: "workflow_start", state: "completed", workflowId: "w", workflowIntent: "deploy", workflowProject: "~/projects/mso" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ workflowId: "w", intent: "deploy", project: "~/projects/mso", state: "active", durationMs: 20 });
    expect(groups[0].rows.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("marks a workflow verified only after workflow_finish", () => {
    const [group] = groupActivity([
      row({ id: "z", tool: "workflow_finish", state: "completed", workflowId: "w" }),
      row({ id: "a", tool: "sys_stats", state: "completed", workflowId: "w" }),
    ]);
    expect(group.state).toBe("done");
  });

  it("marks a completed standalone call without calling it verified", () => {
    const [group] = groupActivity([row({ id: "one", tool: "sys_stats", state: "completed" })]);
    expect(group.state).toBe("completed");
  });

  it("marks an explicitly abandoned workflow as cancelled", () => {
    const [group] = groupActivity([
      row({ id: "c", tool: "workflow_cancel", state: "completed", workflowId: "w" }),
      row({ id: "a", tool: "fs_read", state: "completed", workflowId: "w" }),
    ]);
    expect(group.state).toBe("cancelled");
  });

  it("marks a completed Alfa run completed without pretending it is verified", () => {
    const [group] = groupActivity([
      row({ id: "alfa:run", tool: "alfa.chat", state: "completed", workflowId: "alfa-1", workflowIntent: "inspect repo" }),
      row({ id: "alfa:tool", tool: "fs.read", state: "completed", workflowId: "alfa-1" }),
    ]);
    expect(group).toMatchObject({ state: "completed", intent: "inspect repo" });
  });

  it("marks an aborted local Alfa run as cancelled", () => {
    const [group] = groupActivity([row({ id: "alfa:run", tool: "alfa.chat", state: "cancelled", workflowId: "alfa-2" })]);
    expect(group.state).toBe("cancelled");
  });
});
