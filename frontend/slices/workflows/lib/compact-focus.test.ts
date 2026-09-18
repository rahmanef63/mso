import { describe, expect, it } from "vitest";
import type { WorkflowGraphNode } from "@/lib/contracts/workflow-graph";
import { compactWorkflowFocusIds } from "./compact-focus";

const node = (id: string, type: WorkflowGraphNode["type"], sessionRoot = false): WorkflowGraphNode => ({
  id, name: id, type, position: { x: 0, y: 0 }, config: sessionRoot ? { sessionRoot: true } : {},
});

describe("compact workflow focus", () => {
  it("prefers triggers over arbitrary storage order", () => {
    const nodes = [node("downstream", "tool"), node("start", "manual"), node("later", "output")];
    expect(compactWorkflowFocusIds(nodes, [], new Set(nodes.map((row) => row.id)), 2)).toEqual(["start"]);
  });

  it("maps triggers inside collapsed custom nodes to their visible proxy", () => {
    const nodes = [node("start", "schedule"), node("task", "tool")];
    const groups = [{ id: "custom-entry", name: "Entry", nodeIds: ["start", "task"], collapsed: true }];
    expect(compactWorkflowFocusIds(nodes, groups, new Set(["custom-entry"]), 2)).toEqual(["custom-entry"]);
  });

  it("includes semantic session roots and deduplicates a shared collapsed proxy", () => {
    const nodes = [node("a", "tool", true), node("b", "webhook")];
    const groups = [{ id: "custom-entry", name: "Entry", nodeIds: ["a", "b"], collapsed: true }];
    expect(compactWorkflowFocusIds(nodes, groups, new Set(["custom-entry"]), 9)).toEqual(["custom-entry"]);
  });
});
