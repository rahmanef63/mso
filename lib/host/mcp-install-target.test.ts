import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
vi.mock("@/lib/host/projects-api", async importOriginal => ({ ...await importOriginal<object>(), resolveProjectHint: async () => null }));
import { resolveMcpInstallTarget } from "./mcp-install-target";
import { inspectProjectMcp, manageProjectMcp } from "./project-mcp-manage";
import { readProjectMcpServers } from "./project-mcp-config";
let root = "";
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-host-mcp-")); vi.stubEnv("OS_FS_READ_ROOTS", root); vi.stubEnv("OS_FS_WRITE_ROOTS", root); });
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }); });
describe("explicit host MCP install target", () => {
  it("does not create a binding during inspection and does not use private credentials state", async () => {
    const target = await resolveMcpInstallTarget("@host"); expect(target).toMatchObject({ id: "@host", installationScope: "host", path: path.join(root, ".mso-host-mcp") });
    expect(await inspectProjectMcp(target.path)).toEqual({ revision: "new", servers: [] });
    await expect(fs.stat(target.path)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("installs/removes on disk without inheriting into unrelated projects", async () => {
    const target = await resolveMcpInstallTarget("@host", true), project = path.join(root, "project"); await fs.mkdir(project);
    const saved = await manageProjectMcp(target.path, { action: "upsert", server: "external", revision: "new", url: "https://example.test/mcp" });
    expect((await inspectProjectMcp(target.path)).servers[0].name).toBe("external"); expect(await readProjectMcpServers(project)).toEqual([]);
    await manageProjectMcp(target.path, { action: "delete", server: "external", revision: saved.revision });
    expect((await inspectProjectMcp(target.path)).servers).toEqual([]);
  });
  it("refuses a symlinked host directory", async () => {
    const outside = path.join(root, "outside"); await fs.mkdir(outside); await fs.symlink(outside, path.join(root, ".mso-host-mcp"));
    await expect(resolveMcpInstallTarget("@host", true)).rejects.toThrow("symlink");
  });
  it("preserves host read/write bounds and exact-project resolution", async () => {
    const target = await resolveMcpInstallTarget("@host", true); expect(target.path).toContain(root);
    const elsewhere = path.join(root, "limited"); await fs.mkdir(elsewhere); vi.stubEnv("OS_FS_READ_ROOTS", elsewhere);
    await expect(resolveMcpInstallTarget("@host")).rejects.toThrow();
    await expect(resolveMcpInstallTarget("unknown-project")).rejects.toThrow("exact project");
  });
  it("discovers and calls a new stdio plugin dynamically, then denies it after uninstall", async () => {
    vi.stubEnv("OS_SESSION_SECRET", "never-expose-this-test-secret");
    const target = await resolveMcpInstallTarget("@host", true), script = path.join(target.path, "fixture.mjs");
    await fs.writeFile(script, `import readline from 'node:readline';const r=readline.createInterface({input:process.stdin});r.on('line',l=>{const m=JSON.parse(l);if(!m.id)return;let result=m.method==='initialize'?{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:m.method==='tools/list'?{tools:[{name:'fixture_echo',inputSchema:{type:'object',properties:{value:{type:'string'}}}}]}:{content:[{type:'text',text:JSON.stringify({echo:m.params.arguments.value,leaked:!!process.env.OS_SESSION_SECRET})}]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`);
    // Test fixture provisioned explicitly by the owner, not an untrusted Store command.
    await fs.writeFile(path.join(target.path, ".mcp.json"), JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: [script] } } }));
    const { PROJECT_MCP_TOOLS } = await import("@/lib/mcp/tools-project-mcp");
    const discovered = await PROJECT_MCP_TOOLS[0].run({ project: "@host", server: "fixture", refresh: true }, {} as never);
    expect(JSON.stringify(discovered)).toContain("fixture_echo");
    const result = await PROJECT_MCP_TOOLS[1].run({ project: "@host", server: "fixture", tool: "fixture_echo", arguments: { value: "dynamic-success" } }, {} as never);
    expect(JSON.stringify(result)).toContain("dynamic-success"); expect(JSON.stringify(result)).not.toContain("never-expose-this-test-secret");
    const before = await inspectProjectMcp(target.path); await manageProjectMcp(target.path, { action: "delete", server: "fixture", revision: before.revision });
    await expect(PROJECT_MCP_TOOLS[0].run({ project: "@host", server: "fixture" }, {} as never)).rejects.toThrow("not found");
    await expect(PROJECT_MCP_TOOLS[1].run({ project: "@host", server: "fixture", tool: "fixture_echo" }, {} as never)).rejects.toThrow();
  });
});
