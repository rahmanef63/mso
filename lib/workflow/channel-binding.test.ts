import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ sources: vi.fn(), device: vi.fn() }));
vi.mock("./graph-store", () => ({ listWorkflowGraphTriggerSources: mocks.sources }));
vi.mock("@/lib/auth/device-store", () => ({ getApprovedDevice: mocks.device }));
import { reviewedChannelBinding, findActiveChannelSource } from "./graph-triggers";
const owner = "a".repeat(64), other = "b".repeat(64), revision = "c".repeat(64);
const source = (principal: string, hash: string) => ({ principal, owner: hash, graph: { id: "shared", revision, nodes: [{ id: "trigger", type: "channel_trigger", config: {} }] } });
beforeEach(() => { mocks.sources.mockReset(); mocks.device.mockImplementation(async id => ({ role: id === "owner-device" ? "owner" : "operator" })); });
it("selects only a reviewed Owner source when another principal's graph ID collides", async () => {
  const attacker = source("web:operator-device", other), reviewed = source("web:owner-device", owner);
  mocks.sources.mockResolvedValue([attacker, reviewed]);
  const binding = await reviewedChannelBinding("shared", "channel"); expect(binding).toEqual({ owner, nodeId: "trigger", revision });
  expect((await findActiveChannelSource("shared", "channel", binding))?.principal).toBe("web:owner-device");
  expect(await findActiveChannelSource("shared", "channel")).toBeNull();
  expect(await findActiveChannelSource("shared", "channel", { ...binding, revision: "d".repeat(64) })).toBeNull();
});
it("refuses ambiguous Owner bindings rather than choosing the first graph", async () => {
  mocks.sources.mockResolvedValue([source("web:owner-device", owner), source("web:owner-device", other)]);
  await expect(reviewedChannelBinding("shared", "channel")).rejects.toThrow(/unambiguous/);
});
