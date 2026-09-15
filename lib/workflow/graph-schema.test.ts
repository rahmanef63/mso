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
  it("rejects cycles", () => expect(() => parseWorkflowGraphDefinition({ ...base(), edges: [{ id: "e1", source: "start", target: "done" }, { id: "e2", source: "done", target: "start" }] })).toThrow("cycle"));
  it("rejects secret-like config fields recursively", () => expect(() => parseWorkflowGraphDefinition({ ...base(), nodes: [{ id: "start", name: "Start", type: "tool", position: { x: 0, y: 0 }, config: { nested: { accessToken: "x" } } }, base().nodes[1]] })).toThrow("secret_input_forbidden"));
});
