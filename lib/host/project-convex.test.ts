import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(os.tmpdir(), "mso-convex-mcp-"));
const project = path.join(root, "project");
const bin = path.join(project, "node_modules", ".bin", "convex");

beforeAll(async () => {
  await mkdir(path.dirname(bin), { recursive: true });
  await mkdir(path.join(project, "convex"), { recursive: true });
  await writeFile(path.join(project, "package.json"), JSON.stringify({ dependencies: { convex: "1.0.0" } }));
  await writeFile(bin, `#!/usr/bin/env node\nconst readline=require('node:readline');const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');const tools=['status','tables','data','runOneoffQuery','functionSpec','run','logs','insights','envList','envGet','envSet','envRemove'].map(name=>({name,inputSchema:{type:'object',properties:{projectDir:{type:'string'},value:{type:'string'}}}}));rl.on('line',line=>{const m=JSON.parse(line);if(m.method==='initialize')return send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'convex-fixture',version:'1'}}});if(m.method==='notifications/initialized')return;if(m.method==='tools/list')return send({jsonrpc:'2.0',id:m.id,result:{tools}});if(m.method==='tools/call')return send({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:JSON.stringify({tool:m.params.name,args:m.params.arguments,argv:process.argv.slice(2)})}]}})});\n`);
  await chmod(bin, 0o755);
});

afterAll(async () => rm(root, { recursive: true, force: true }));

describe("first-class Convex project adapter", () => {
  it("discovers only supported official Convex MCP tools", async () => {
    const { listProjectConvexTools } = await import("./project-convex");
    const tools = await listProjectConvexTools(project, "dev");
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["status", "runOneoffQuery", "tables", "run"]));
    expect(tools.map((tool) => tool.name)).not.toContain("envGet");
    expect(tools.map((tool) => tool.name)).not.toContain("envSet");
    expect(tools).toHaveLength(8);
  });

  it("pins project dir, strips nested projectDir overrides and forwards safe deployment selection", async () => {
    const { callProjectConvexTool } = await import("./project-convex");
    const result = await callProjectConvexTool(project, "status", { projectDir: "/escape", value: "ok" }, "dev/team") as { content: Array<{ text: string }> };
    const echoed = JSON.parse(result.content[0].text) as { args: Record<string, unknown>; argv: string[] };
    expect(echoed.args).toEqual({ value: "ok" });
    expect(echoed.argv).toEqual(["mcp", "start", "--project-dir", project, "--deployment", "dev/team"]);
  });

  it("refuses cross-project deployment selectors and unknown tools", async () => {
    const { callProjectConvexTool } = await import("./project-convex");
    await expect(callProjectConvexTool(project, "status", {}, "prod:other-project")).rejects.toThrow(/cross-project/i);
    await expect(callProjectConvexTool(project, "notReal", {})).rejects.toThrow(/unsupported Convex MCP tool/i);
  });
});
