import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { READ_TOOLS } = await import("./tools-read");

describe("sys_stats model contract", () => {
  it("returns uptime with explicit units and no ambiguous uptime field", async () => {
    const tool = READ_TOOLS.find((row) => row.name === "sys_stats");
    expect(tool?.description).toContain("uptimeMs");
    const result = await tool!.run({}, { scope: "read" }) as Record<string, unknown>;
    expect(result.uptime).toBeUndefined();
    expect(result.uptimeMs).toEqual(expect.any(Number));
    expect(result.uptimeSeconds).toEqual(expect.any(Number));
    expect(Number(result.uptimeMs)).toBeGreaterThan(Number(result.uptimeSeconds));
  });
});
