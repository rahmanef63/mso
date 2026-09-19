#!/usr/bin/env node
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repo=path.resolve(path.dirname(new URL(import.meta.url).pathname),"..");
const stage=path.resolve(process.env.MSO_OPENAI_PLUGIN_STAGE??path.join(os.homedir(),".mso","private","plugin-packages","mso"));
const temp=stage+".tmp-"+process.pid;
await fs.rm(temp,{recursive:true,force:true});
await fs.mkdir(temp,{recursive:true,mode:0o700});
for(const entry of [".codex-plugin","claude-skills"]){
  await fs.cp(path.join(repo,entry),path.join(temp,entry),{recursive:true,errorOnExist:false,force:true});
}
const linker=spawnSync(process.execPath,[path.join(repo,"scripts","link-openai-app.mjs"),"--output",path.join(temp,".app.json")],{
  cwd:repo,stdio:["ignore","pipe","pipe"],encoding:"utf8",env:process.env,
});
if(linker.status!==0){
  await fs.rm(temp,{recursive:true,force:true});
  process.stderr.write(linker.stderr||"openai-app: private plugin staging failed\n");
  process.exit(linker.status??2);
}
await fs.rm(stage,{recursive:true,force:true});
await fs.mkdir(path.dirname(stage),{recursive:true,mode:0o700});
await fs.rename(temp,stage);
await fs.chmod(stage,0o700);
console.log("openai-app: private plugin package staged at "+stage+"; App ID is redacted and the source repository was not modified");
