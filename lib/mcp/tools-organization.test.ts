import { describe, expect, it } from "vitest";
import { ORGANIZATION_TOOLS } from "./tools-organization";

describe("organization MCP surface", () => {
  const tools = new Map(ORGANIZATION_TOOLS.map((tool) => [tool.name, tool]));
  it("keeps chart reads separate from revision-checked mutations", () => {
    expect(tools.get("organization_chart")?.scope).toBe("read");
    expect(tools.get("organization_chart")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.get("organization_manage")?.scope).toBe("write");
    expect(tools.get("organization_manage")?.inputSchema.required).toEqual(expect.arrayContaining(["action", "expected_revision"]));
    expect(JSON.stringify(tools.get("organization_manage")?.inputSchema)).not.toMatch(/password|token|credential/i);
  });
});
