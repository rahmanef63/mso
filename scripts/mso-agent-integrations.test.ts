import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

const commands = path.join(__dirname, "mso-agent-commands.mjs");

function invoke(line: string) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mso-agent-integrations-"));
  const cli = path.join(dir, "mso");
  const log = path.join(dir, "argv.log");
  writeFileSync(cli, "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$MSO_TEST_LOG\"\n");
  chmodSync(cli, 0o755);
  const script = `
    globalThis.fetch = async (url) => {
      const path = String(url);
      const data = path.endsWith('/api/config') ? {provider:'',model:''}
        : path.includes('/api/v1/agent-tools') ? {tools:[]}
        : path.includes('/api/skills') ? {skills:[]}
        : path.includes('/api/v1/infra/providers') ? {providers:[]}
        : {};
      return new Response(JSON.stringify(data), {status:200,headers:{'content-type':'application/json'}});
    };
    const {handleSlash}=await import(${JSON.stringify(`file://${commands}`)});
    const session={state:{skills:{skills:[]},tools:[]},agentSession:{id:'test'},history:[]};
    const result=await handleSlash({}, ${JSON.stringify(line)}, session, {runTurn:async()=>{},runSubagent:async()=>{}});
    process.stdout.write(String(result));
  `;
  const out = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: { ...process.env, MSO_AGENT_CLI: cli, MSO_TEST_LOG: log },
  });
  expect(out.status, out.stderr).toBe(0);
  return { result: out.stdout, argv: readFileSync(log, "utf8").trim().split("\n") };
}

it("routes canonical /integrations to the native integrations CLI surface", () => {
  expect(invoke("/integrations")).toEqual({ result: "refresh", argv: ["integrations"] });
  expect(invoke("/integrations status")).toEqual({ result: "refresh", argv: ["integrations status"] });
});

it("keeps legacy provider slash aliases executable while discovery hides them", () => {
  expect(invoke("/providers")).toEqual({ result: "refresh", argv: ["provider list"] });
  expect(invoke("/provider hostinger")).toEqual({ result: "refresh", argv: ["provider set hostinger"] });
});
