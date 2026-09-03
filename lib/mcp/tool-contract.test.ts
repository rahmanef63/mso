import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { TOOLS } = await import("./tools");
const { toolDescriptor } = await import("./tool-contract");

describe("MCP advertised tool contract", () => {
  it("gives every global MSO tool a title, required safety hints, and matching OAuth security metadata", () => {
    expect(new Set(TOOLS.map((tool) => tool.name)).size).toBe(TOOLS.length);
    for (const tool of TOOLS) {
      const descriptor = toolDescriptor(tool);
      expect(descriptor.title.trim().length, tool.name).toBeGreaterThan(0);
      expect(descriptor.title.length, tool.name).toBeLessThanOrEqual(80);
      expect(descriptor.annotations).toEqual(expect.objectContaining({ readOnlyHint: expect.any(Boolean), destructiveHint: expect.any(Boolean), openWorldHint: expect.any(Boolean) }));
      expect(descriptor.securitySchemes).toEqual([{ type: "oauth2", scopes: [tool.scope] }]);
      expect(descriptor._meta.securitySchemes).toEqual(descriptor.securitySchemes);
    }
  });

  it("keeps private project MCP tool names out of the global catalog", () => {
    const names = TOOLS.map((tool) => tool.name);
    expect(names).toContain("project_mcp_tools");
    expect(names).toContain("project_mcp_call");
    expect(names.some((name) => name === "private_echo" || name.startsWith("project_fixture_"))).toBe(false);
  });

  it("adds the generic output envelope only to the compact ChatGPT profile", () => {
    const fileList = TOOLS.find((tool) => tool.name === "fs_list");
    expect(fileList).toBeDefined();
    expect(toolDescriptor(fileList!, "full")).not.toHaveProperty("outputSchema");
    expect(toolDescriptor(fileList!, "chatgpt").outputSchema).toEqual({ type: "object", properties: { result: {} }, required: ["result"], additionalProperties: false });
  });

});
