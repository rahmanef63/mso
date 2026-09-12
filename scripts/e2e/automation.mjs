import { mkdir, writeFile, readFile, chmod } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect } from "@playwright/test";

export async function automationJourney(page, fixture) {
  await fixture.seedMcp("exec");
  const meta = {"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}};
  const rpc = async (method, params = {}) => {
    const response = await fetch(fixture.base+"/mcp", {method:"POST",headers:{authorization:"Bearer "+fixture.mcpToken,"content-type":"application/json","MCP-Protocol-Version":"2026-07-28","Mcp-Method":method,...(params.name?{"Mcp-Name":params.name}:{})},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params:{...params,_meta:{...meta,...params._meta}}})});
    return {status:response.status,session:response.headers.get("Mcp-Session-Id"),body:await response.json()};
  };
  const discovered = await rpc("server/discover");
  expect(discovered.status).toBe(200); expect(discovered.session).toBeNull();
  expect(discovered.body.result.resultType).toBe("complete");
  expect((await rpc("method/unknown")).status).toBe(404);
  const opened = await rpc("tools/call",{name:"agent_session_open",arguments:{conversation_key:"release-modern"}});
  expect(opened.status).toBe(200); expect(opened.body.result.isError).not.toBe(true);
  expect(opened.body.result.resultType).toBe("complete");
  const project = path.join(fixture.dir, "automation-project");
  await mkdir(project, { mode: 0o700 });
  const script = path.join(project, "fixture.cjs");
  await writeFile(script, `require("node:readline").createInterface({input:process.stdin}).on("line",line=>{
    const r=JSON.parse(line);if(r.id===undefined)return;
    const result=r.method==="initialize"?{protocolVersion:"2025-11-25",capabilities:{tools:{}},serverInfo:{name:"fixture",version:"1"}}:
      r.method==="tools/list"?{tools:[{name:"echo",inputSchema:{type:"object",properties:{message:{type:"string"}}}}]}:
      {content:[{type:"text",text:"echo"}],structuredContent:{message:r.params.arguments.message}};
    process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:r.id,result})+"\\n");
  });`);
  await writeFile(path.join(project, ".mcp.json"), JSON.stringify({mcpServers:{fixture:{command:process.execPath,args:[script]}}}), { mode: 0o600 });
  const call = (route, body) => page.evaluate(async ([route,body]) => {
    const response = await fetch(route, body ? {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)} : {});
    return {status:response.status,body:await response.json()};
  }, [route,body]);
  await page.goto(fixture.base + "/integrations");
  await page.getByRole("button", {name:"Add MCP",exact:true}).click();
  await page.getByLabel("Project id or path").fill(project);
  await page.getByLabel("Server alias", {exact:true}).fill("public-fixture");
  await page.getByLabel("HTTPS MCP endpoint").fill("https://example.com/mcp");
  if (process.env.MSO_SCREENSHOT_DIR) {
    const screenshot = path.join(process.env.MSO_SCREENSHOT_DIR, "add-project-mcp.png");
    await page.screenshot({path:screenshot}); await chmod(screenshot,0o600);
  }
  await page.getByRole("button", {name:"Add MCP",exact:true}).last().click();
  await expect(page.getByRole("status")).toContainText("MCP added to");
  const config = JSON.parse(await readFile(path.join(project,".mcp.json"),"utf8"));
  expect(Object.keys(config.mcpServers).sort()).toEqual(["fixture","public-fixture"]);
  const catalog = await call("/api/v1/flows?project="+encodeURIComponent(project));
  expect(catalog.status).toBe(200);
  const definition = {id:"fixture.echo",description:"Echo a supplied message through the project MCP.",inputs:{message:{type:"string",description:"Message to echo",required:true}},steps:[{id:"echo",tool:"project_mcp_call",arguments:{server:"fixture",tool:"echo",arguments:{message:{$ref:"input.message"}}}}]};
  const saved = await call("/api/v1/flows",{action:"upsert",project,flow:definition.id,definition,revision:catalog.body.revision});
  expect(saved.status).toBe(200);
  const input = {action:"run",project,flow:definition.id,input:{message:"verified flow ✓"},idempotency_key:"release-fixture-echo"};
  const run = await call("/api/v1/flows",input);
  expect(run.status).toBe(200);
  const receipt = run.body.result ?? run.body;
  expect(receipt.id).toBeTruthy();
  const finished = await call("/api/v1/flows?run_id="+receipt.id+"&wait_ms=25000");
  expect(finished.status).toBe(200);
  expect(finished.body.state).toBe("completed");
  expect(JSON.stringify(finished.body)).toContain("verified flow ✓");
  const duplicate = await call("/api/v1/flows",input);
  expect((duplicate.body.result ?? duplicate.body).id).toBe(receipt.id);
  const cli = execFileSync("bash", ["bin/mso","--base",fixture.base,"flow","run",definition.id,"--project",project,"--input",JSON.stringify({message:"CLI verified"}),"--key","release-cli","--wait"],{encoding:"utf8",timeout:30000,env:{...process.env,MSO_PASSWORD:fixture.password,MSO_DEVICE:fixture.device,MSO_PRIVATE_STATE_DIR:path.join(fixture.dir,"cli-private")}});
  expect(JSON.parse(cli).state).toBe("completed");
  expect(cli).toContain("CLI verified");
  const current = await call("/api/v1/flows?project="+encodeURIComponent(project));
  expect((await call("/api/v1/flows",{action:"delete",project,flow:definition.id,revision:current.body.revision})).status).toBe(200);
  const binding = await call("/api/v1/project-mcp",{action:"inspect",project});
  expect((await call("/api/v1/project-mcp",{action:"delete",project,server:"public-fixture",revision:binding.body.revision})).status).toBe(200);
  console.log("PASS Add MCP, preserved binding, project flow CRUD, execution, Unicode result and idempotent replay");
}
