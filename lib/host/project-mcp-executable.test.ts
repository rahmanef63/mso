import { describe, expect, it } from "vitest";
import { resolveProjectMcpExecutable } from "./project-mcp-transport";

describe("project MCP executable resolution", () => {
  it("uses the current trusted Node executable for portable node manifests", () => {
    expect(resolveProjectMcpExecutable("node")).toBe(process.execPath);
    expect(resolveProjectMcpExecutable("/opt/custom/bin/tool")).toBe("/opt/custom/bin/tool");
  });
});
