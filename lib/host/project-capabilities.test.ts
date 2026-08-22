import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { projectCapabilities, runProjectFunction } from "./project-capabilities";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))); });

async function project() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mso-project-cap-"));
  roots.push(dir);
  await fs.mkdir(path.join(dir, ".mso"));
  return dir;
}

const manifest = (command: string[]) => ({
  version: 1,
  functions: [{
    name: "echo_payload",
    description: "Echo the JSON payload received on stdin.",
    inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false },
    command,
    timeoutMs: 5000,
  }],
});

describe("project capability manifests", () => {
  it("is invisible when a project did not opt in", async () => {
    const dir = await project();
    expect(await projectCapabilities(dir)).toBeUndefined();
  });

  it("reports MCP + public function metadata without exposing argv or MCP contents", async () => {
    const dir = await project();
    await fs.writeFile(path.join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { secretServer: { env: { TOKEN: "do-not-return" } } } }));
    await fs.writeFile(path.join(dir, ".mso/functions.json"), JSON.stringify(manifest([process.execPath, "-e", ""])), { mode: 0o600 });
    const capabilities = await projectCapabilities(dir);
    expect(capabilities?.mcp).toEqual({ config: ".mcp.json" });
    expect(capabilities?.functions).toMatchObject({ valid: true, version: 1, count: 1 });
    const text = JSON.stringify(capabilities);
    expect(text).toContain("echo_payload");
    expect(text).not.toContain("do-not-return");
    expect(text).not.toContain(process.execPath);
  });

  it("executes fixed argv with caller input on JSON stdin, never shell interpolation", async () => {
    const dir = await project();
    const code = "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({payload:JSON.parse(s),fn:process.env.MSO_PROJECT_FUNCTION})))";
    await fs.writeFile(path.join(dir, ".mso/functions.json"), JSON.stringify(manifest([process.execPath, "-e", code])));
    const payload = { value: "$(touch /tmp/should-not-run); hello" };
    const result = await runProjectFunction(dir, "echo_payload", payload);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ payload, fn: "echo_payload" });
  });

  it("validates required fields and additionalProperties before spawning project code", async () => {
    const dir = await project();
    const code = "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('ran'))";
    await fs.writeFile(path.join(dir, ".mso/functions.json"), JSON.stringify(manifest([process.execPath, "-e", code])));
    await expect(runProjectFunction(dir, "echo_payload", {})).rejects.toThrow(/required input\.value/i);
    await expect(runProjectFunction(dir, "echo_payload", { value: "x", surprise: true })).rejects.toThrow(/unknown input\.surprise/i);
  });

  it("fails closed on a symlinked .mso directory or invalid manifest", async () => {
    const dir = await project();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "mso-project-cap-outside-"));
    roots.push(outside);
    await fs.rm(path.join(dir, ".mso"), { recursive: true });
    await fs.writeFile(path.join(outside, "functions.json"), JSON.stringify(manifest([process.execPath, "-e", ""])), { mode: 0o600 });
    await fs.symlink(outside, path.join(dir, ".mso"));
    expect(await projectCapabilities(dir)).toBeUndefined();
    await expect(runProjectFunction(dir, "echo_payload", {})).rejects.toThrow(/no \.mso\/functions\.json/i);

    const second = await project();
    await fs.writeFile(path.join(second, ".mso/functions.json"), JSON.stringify({ version: 1, functions: [{ name: "BAD NAME" }] }));
    expect(await projectCapabilities(second)).toMatchObject({ functions: { valid: false } });
    await expect(runProjectFunction(second, "anything", {})).rejects.toThrow(/invalid|name/i);
  });
});
