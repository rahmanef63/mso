import { describe, expect, it } from "vitest";
import { parseWorkflowGraphDefinition } from "./graph-schema";

const base = () => ({
  name: "Deploy app", description: "generic", status: "draft", inputs: {}, metadata: {},
  nodes: [
    { id: "start", name: "Start", type: "manual", position: { x: 0, y: 0 }, config: {} },
    { id: "done", name: "Done", type: "output", position: { x: 200, y: 0 }, config: {} },
  ], edges: [{ id: "e1", source: "start", target: "done" }],
});

describe("workflow graph schema", () => {
  it("accepts a bounded acyclic metadata-only graph", () => expect(parseWorkflowGraphDefinition(base()).nodes).toHaveLength(2));
  it("rejects cycles", () => expect(() => parseWorkflowGraphDefinition({ ...base(), nodes: [{ id: "a", name: "A", type: "tool", position: { x: 0, y: 0 }, config: { tool: "x" } }, { id: "b", name: "B", type: "output", position: { x: 200, y: 0 }, config: {} }], edges: [{ id: "e1", source: "a", target: "b" }, { id: "e2", source: "b", target: "a" }] })).toThrow("cycle"));
  it("rejects secret-like config fields recursively", () => expect(() => parseWorkflowGraphDefinition({ ...base(), nodes: [{ id: "start", name: "Start", type: "tool", position: { x: 0, y: 0 }, config: { nested: { accessToken: "x" } } }, base().nodes[1]] })).toThrow("secret_input_forbidden"));
  it("accepts parity node types but keeps triggers root-only", () => {
    expect(parseWorkflowGraphDefinition({ ...base(), nodes: [{ id: "start", name: "Schedule", type: "schedule", position: { x: 0, y: 0 }, config: { mode: "interval", everyMinutes: 5 } }, { id: "wait", name: "Wait", type: "wait", position: { x: 100, y: 0 }, config: { delayMs: 0 } }, base().nodes[1]], edges: [{ id: "a", source: "start", target: "wait" }, { id: "b", source: "wait", target: "done" }] }).nodes.map((node) => node.type)).toEqual(["schedule", "wait", "output"]);
    expect(() => parseWorkflowGraphDefinition({ ...base(), nodes: [base().nodes[0], { id: "hook", name: "Hook", type: "webhook", position: { x: 100, y: 0 }, config: {} }], edges: [{ id: "bad", source: "start", target: "hook" }] })).toThrow("root");
  });
});
