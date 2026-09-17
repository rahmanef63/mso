import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { capabilityRateLimited } from "./rate-limit";
import type { CapabilityTool } from "./tool";
function fixture(): CapabilityTool { return { name: "rate_fixture", scope: "write", description: "test", inputSchema: { type: "object", properties: {} }, run: async () => ({}), limit: { key: randomUUID(), max: 2, windowMs: 60_000, actionLimits: { inspect: { max: 3, windowMs: 60_000 } } } }; }
it("inspection gets its bounded budget without exhausting mutation quota", () => {
  const tool = fixture();
  for (let i = 0; i < 3; i++) expect(capabilityRateLimited(tool, { action: "inspect" }, "owner")).toBe(false);
  expect(capabilityRateLimited(tool, { action: "inspect" }, "owner")).toBe(true);
  expect(capabilityRateLimited(tool, { action: "upsert" }, "owner")).toBe(false);
  expect(capabilityRateLimited(tool, { action: "delete" }, "owner")).toBe(false);
  expect(capabilityRateLimited(tool, { action: "delete" }, "owner")).toBe(true);
});
it("unknown/prototype actions use the base limit and actor isolation stays intact", () => {
  const tool = fixture();
  expect(capabilityRateLimited(tool, { action: "constructor" }, "owner")).toBe(false);
  expect(capabilityRateLimited(tool, { action: "__proto__" }, "owner")).toBe(false);
  expect(capabilityRateLimited(tool, { action: "unknown" }, "owner")).toBe(true);
  expect(capabilityRateLimited(tool, { action: "delete" }, "other-owner")).toBe(false);
});
it("legacy budgets and keyArg semantics remain unchanged", () => {
  const tool = fixture(); tool.limit = { key: randomUUID(), max: 1, windowMs: 60_000, keyArg: "project" };
  expect(capabilityRateLimited(tool, { project: "one" }, "owner")).toBe(false);
  expect(capabilityRateLimited(tool, { project: "one" }, "other-owner")).toBe(true);
  expect(capabilityRateLimited(tool, { project: "two" }, "owner")).toBe(false);
});
