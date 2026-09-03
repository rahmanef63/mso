import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(os.tmpdir(), "mso-project-mcp-"));
const fixture = path.join(root, "fixture.mjs");
const project = path.join(root, "project");
await import("node:fs/promises").then(({ mkdir }) => mkdir(project, { recursive: true }));

beforeAll(async () => {
  await writeFile(fixture, `
import readline from 'node:readline';
const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
const send=(x)=>process.stdout.write(JSON.stringify(x)+'\\n');
rl.on('line',(line)=>{const m=JSON.parse(line); if(m.method==='initialize') return send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}}); if(m.method==='notifications/initialized') return; if(m.method==='tools/list') return send({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'private_echo',title:'Private Echo',description:'Project-owned dynamic tool',inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value']},annotations:{readOnlyHint:true}}]}}); if(m.method==='tools/call') return send({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:JSON.stringify({value:m.params.arguments.value,visible:process.env.PROJECT_VISIBLE,secretLeak:Boolean(process.env.OS_SESSION_SECRET),secretRef:process.env.SECRET_REF||''})}]}});});
`);
  await writeFile(path.join(project, ".mcp.json"), JSON.stringify({ mcpServers: { projectFixture: { command: process.execPath, args: [fixture], env: { PROJECT_VISIBLE: "ok", SECRET_REF: "${OS_SESSION_SECRET}" } } } }));
});
afterAll(async () => rm(root, { recursive: true, force: true }));

describe("dynamic project MCP boundary", () => {
  it("returns only safe server aliases, never config/env values", async () => {
    process.env.OS_SESSION_SECRET = "must-not-leak";
    const { readProjectMcpServers, publicProjectMcpServers } = await import("./project-mcp-config");
    const internal = await readProjectMcpServers(project);
    const publicRows = publicProjectMcpServers(internal);
    expect(publicRows).toEqual([{ name: "projectFixture", transport: "stdio", auth: "none" }]);
    expect(JSON.stringify(publicRows)).not.toContain("PROJECT_VISIBLE");
    expect(JSON.stringify(publicRows)).not.toContain("must-not-leak");
  });

  it("discovers and calls the project-owned tool on demand without inheriting MSO secrets", async () => {
    process.env.OS_SESSION_SECRET = "must-not-leak";
    const { listProjectMcpTools, callProjectMcpTool } = await import("./project-mcp-client");
    const tools = await listProjectMcpTools(project, "projectFixture");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ name: "private_echo", title: "Private Echo" });
    const result = await callProjectMcpTool(project, "projectFixture", "private_echo", { value: "hello" });
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(text)).toEqual({ value: "hello", visible: "ok", secretLeak: false, secretRef: "" });
  });

  it("refuses a stdio cwd that escapes the selected project", async () => {
    await writeFile(path.join(project, ".mcp.json"), JSON.stringify({ mcpServers: { bad: { command: process.execPath, args: [fixture], cwd: ".." } } }));
    const { readProjectMcpServers } = await import("./project-mcp-config");
    await expect(readProjectMcpServers(project)).rejects.toThrow(/cwd must stay inside/i);
    await writeFile(path.join(project, ".mcp.json"), JSON.stringify({ mcpServers: { projectFixture: { command: process.execPath, args: [fixture], env: { PROJECT_VISIBLE: "ok", SECRET_REF: "${OS_SESSION_SECRET}" } } } }));
  });
});
