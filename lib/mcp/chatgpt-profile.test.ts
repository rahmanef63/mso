import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const { dispatch } = await import("./dispatch");
const { CHATGPT_TOOL_NAMES } = await import("./tool-contract");

const context = { principal: "mcp-client:chatgpt-test", sessionId: "session-profile", toolProfile: "chatgpt" as const };

describe("ChatGPT compact MCP profile", () => {
  it("advertises only MSO-owned generic tools with complete OpenAI metadata and scanner headroom", async () => {
    const response = await dispatch({ id: 1, method: "tools/list" }, "exec", "test", context);
    const tools = (response.result as { tools: Array<Record<string, unknown>> }).tools;
    expect(tools.map((tool) => tool.name).sort()).toEqual([...CHATGPT_TOOL_NAMES].sort());
    expect(tools).toHaveLength(CHATGPT_TOOL_NAMES.size);

    for (const tool of tools) {
      expect(typeof tool.title, String(tool.name)).toBe("string");
      expect(String(tool.title).trim().length, String(tool.name)).toBeGreaterThan(0);
      const annotations = tool.annotations as Record<string, unknown>;
      for (const key of ["readOnlyHint", "destructiveHint", "openWorldHint"]) {
        expect(typeof annotations?.[key], `${String(tool.name)}.${key}`).toBe("boolean");
      }
      const schemes = tool.securitySchemes as Array<Record<string, unknown>>;
      expect(schemes?.[0]?.type, String(tool.name)).toBe("oauth2");
      expect(Array.isArray(schemes?.[0]?.scopes), String(tool.name)).toBe(true);
      expect((tool._meta as { securitySchemes?: unknown })?.securitySchemes, String(tool.name)).toEqual(schemes);
      expect(Buffer.byteLength(JSON.stringify(tool)), String(tool.name)).toBeLessThan(8 * 1024);
    }

    const bytes = Buffer.byteLength(JSON.stringify(tools));
    if (process.env.MSO_PROFILE_METRICS === "1") console.info(`CHATGPT_PROFILE_METRICS tools=${tools.length} bytes=${bytes} roughTokens4=${Math.ceil(bytes/4)} maxToolBytes=${Math.max(...tools.map((tool)=>Buffer.byteLength(JSON.stringify(tool))))}`);
    expect(bytes).toBeLessThan(72 * 1024);
    expect(tools.some((tool) => tool.name === "local_agent_inbox")).toBe(true);
    expect(tools.some((tool) => tool.name === "project_mcp_tools")).toBe(true);
    expect(tools.some((tool) => tool.name === "project_mcp_call")).toBe(true);
    const pipeline = tools.find((tool) => tool.name === "read_pipeline") as { inputSchema?: { properties?: { calls?: { items?: { properties?: { transform?: { properties?: { where?: { items?: { properties?: { value?: unknown } } } } } } } } } } } | undefined;
    expect(pipeline?.inputSchema?.properties?.calls?.items?.properties?.transform?.properties?.where?.items?.properties?.value).toEqual({
      anyOf: [{ type: "string", maxLength: 2048 }, { type: "number" }, { type: "boolean" }, { type: "null" }],
    });
    expect(tools.some((tool) => String(tool.name) === "private_echo" || String(tool.name).startsWith("project_fixture_"))).toBe(false);
  });

  it("fails closed when a compact-profile client guesses a full-catalog tool", async () => {
    const result = await dispatch({ id: 2, method: "tools/call", params: { name: "tool_forge_promote", arguments: { id: "candidate-hidden" } } }, "exec", "test", context);
    expect(result.error).toMatchObject({ code: -32602 });
  });
});
