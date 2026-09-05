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

  it("renders a validated project image envelope as direct MCP image content", async () => {
    const png = Buffer.from([137,80,78,71,13,10,26,10,0]);
    const visual = path.join(base, "visual");
    await fs.mkdir(path.join(visual, ".mso"), { recursive: true });
    const envelope = JSON.stringify({ protocol: "mso.project-function-content.v1", content: [
      { type: "image", data: png.toString("base64"), mimeType: "image/png" },
      { type: "text", text: "scene hub · r33" },
    ] });
    await fs.writeFile(path.join(visual, "envelope.json"), envelope);
    await fs.writeFile(path.join(visual, "visual.mjs"), 'import fs from "node:fs"; process.stdin.resume(); process.stdin.on("end", () => process.stdout.write(fs.readFileSync(new URL("./envelope.json", import.meta.url), "utf8")));');
    await fs.writeFile(path.join(visual, ".mso/functions.json"), JSON.stringify({
      version: 1, functions: [{ name: "capture_scene", description: "Capture scene.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false }, command: [process.execPath, "visual.mjs"] }],
    }));
    const result = await TOOLS_BY_NAME.get("project_function_call")!.run({ project: visual, name: "capture_scene", input: {} }, { scope: "exec" }) as {
      __mcpDirect?: boolean; __capabilityDirect?: boolean; code?: number; content?: Array<{ type: string; mimeType?: string; text?: string }>;
    };
    expect(result.__mcpDirect || result.__capabilityDirect).toBe(true);
    expect(result.code).toBe(0);
    expect(result.content?.map((row) => row.type)).toEqual(["image", "text"]);
    expect(result.content?.[0]?.mimeType).toBe("image/png");
  });
});
