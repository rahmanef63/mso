import { describe, expect, it } from "vitest";
import { READ_PIPELINE_TOOLS } from "./tools-read-pipeline";

describe("read_pipeline MCP contract", () => {
  it("is a single read-only, idempotent, bounded orchestration surface", () => {
    expect(READ_PIPELINE_TOOLS).toHaveLength(1);
    const tool = READ_PIPELINE_TOOLS[0]!;
    expect(tool.name).toBe("read_pipeline"); expect(tool.scope).toBe("read");
    expect(tool.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true });
    expect(tool.limit).toMatchObject({ key: "read.pipeline", max: 30 });
    expect(tool.inputSchema.required).toEqual(["calls"]);
  });
});
