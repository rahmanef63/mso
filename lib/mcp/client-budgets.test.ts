import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { TOOLS } = await import("./tools");
const { toolDescriptor } = await import("./tool-contract");
it("checks published metadata limits separately from MSO's byte policy without inventing token limits", () => {
  // Official OpenAI plugin reference: invocation status strings <=64 characters.
  // MCP tool names SHOULD be <=128; MSO also meets OpenAI function-name <=64.
  for (const tool of TOOLS) {
    expect(tool.name.length, tool.name).toBeLessThanOrEqual(64);
    expect(tool.name, tool.name).toMatch(/^[A-Za-z0-9_-]+$/);
    for (const key of ["openai/toolInvocation/invoking", "openai/toolInvocation/invoked"]) {
      const value = tool.meta?.[key];
      if (value !== undefined) expect([...String(value)].length, tool.name + "." + key).toBeLessThanOrEqual(64);
    }
  }
  const descriptors = TOOLS.map(tool => toolDescriptor(tool, "chatgpt"));
  // Internal project budgets, NOT an OpenAI/MCP token guarantee.
  expect(Buffer.byteLength(JSON.stringify(descriptors))).toBeLessThan(96 * 1024);
  expect(Math.max(...descriptors.map(d => Buffer.byteLength(JSON.stringify(d))))).toBeLessThan(8 * 1024);
});
