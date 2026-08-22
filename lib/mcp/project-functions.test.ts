import { afterAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { promises as fs } from "fs";
import os from "os";
import path from "path";

const base = await fs.mkdtemp(path.join(os.tmpdir(), "mso-mcp-project-fn-"));
const project = path.join(base, "widget");
await fs.mkdir(path.join(project, ".mso"), { recursive: true });
const code = "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>process.stdout.write(s))";
await fs.writeFile(path.join(project, ".mso/functions.json"), JSON.stringify({
  version: 1,
  functions: [{
    name: "echo_json", description: "Echo input JSON.",
    inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
    command: [process.execPath, "-e", code],
  }],
}));
const previous = process.env.OS_FS_READ_ROOTS;
process.env.OS_FS_READ_ROOTS = base;
const { TOOLS_BY_NAME } = await import("./tools");

afterAll(async () => {
  if (previous === undefined) delete process.env.OS_FS_READ_ROOTS;
  else process.env.OS_FS_READ_ROOTS = previous;
  await fs.rm(base, { recursive: true, force: true });
});

describe("project function MCP bridge", () => {
  it("is one stable exec-scope tool, not a dynamic tool per project function", () => {
    const tool = TOOLS_BY_NAME.get("project_function_call");
    expect(tool?.scope).toBe("exec");
    expect(TOOLS_BY_NAME.has("echo_json")).toBe(false);
  });

  it("runs an opted-in project function with exact JSON stdin", async () => {
    const result = await TOOLS_BY_NAME.get("project_function_call")!.run({
      project,
      name: "echo_json",
      input: { value: "hello; $(not-a-shell)" },
    }, { scope: "exec" });
    expect(result).toEqual({ code: 0, stdout: JSON.stringify({ value: "hello; $(not-a-shell)" }), stderr: "" });
  });
});
