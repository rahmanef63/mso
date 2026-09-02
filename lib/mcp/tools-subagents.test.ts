import { describe, expect, it } from "vitest";
import { SUBAGENT_TOOLS } from "./tools-subagents";

describe("subagent MCP tool contract", () => {
  it("uses one explicit exec-gated foreground delegation boundary", () => {
    const tool = SUBAGENT_TOOLS.find((row) => row.name === "agent_subagent_run");
    expect(tool?.scope).toBe("exec");
    expect(tool?.description).toMatch(/foreground/i);
    expect(tool?.description).toMatch(/isolated context/i);
    expect(tool?.description).toMatch(/does not create a Local Agent peer/i);
    expect(tool?.inputSchema.properties).toHaveProperty("max_turns");
    expect(tool?.inputSchema.properties).toHaveProperty("max_scope");
  });
});
