import { describe, expect, it } from "vitest";
import { parseWorkflowGraphDefinition } from "@/lib/workflow/graph-schema";
import { workflowNodeCatalog } from "@/lib/workflow/node-catalog";

const trigger = { id: "channel", name: "Channel", type: "channel_trigger", position: { x: 0, y: 0 }, config: { channelId: "" } };
const output = { id: "output", name: "Output", type: "output", position: { x: 200, y: 0 }, config: {} };

describe("channel workflow contract", () => {
  it("exposes native Channel Trigger and Channel Send nodes", () => {
    const types = workflowNodeCatalog("channel").map((row) => row.type);
    expect(types).toContain("channel_trigger");
    expect(types).toContain("channel_send");
  });

  it("accepts channel triggers as workflow roots and rejects incoming edges into them", () => {
    expect(parseWorkflowGraphDefinition({
      name: "Channel flow", description: "", status: "active", inputs: {},
      nodes: [trigger, output], edges: [{ id: "e1", source: "channel", target: "output" }], metadata: {},
    }).nodes[0]?.type).toBe("channel_trigger");
    expect(() => parseWorkflowGraphDefinition({
      name: "Bad", description: "", status: "active", inputs: {},
      nodes: [trigger, output], edges: [{ id: "e1", source: "output", target: "channel" }], metadata: {},
    })).toThrow("trigger nodes must be workflow roots");
  });
});
