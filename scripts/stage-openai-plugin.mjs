#!/usr/bin/env node
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repo=path.resolve(path.dirname(new URL(import.meta.url).pathname),"..");
const stage=path.resolve(process.env.MSO_OPENAI_PLUGIN_STAGE??path.join(os.homedir(),".mso","private","plugin-packages","mso"));
const temp=stage+".tmp-"+process.pid;
const legacySource=path.join(repo,".codex-plugin","plugin.json");
const portableSchema="https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";

const legacy=JSON.parse(await fs.readFile(legacySource,"utf8"));
if(legacy?.name!=="mso"||typeof legacy?.version!=="string"||!legacy?.interface||typeof legacy.interface!=="object"){
  throw new Error("openai-app: source compatibility manifest is invalid");
}

const portable={
  $schema:portableSchema,
  name:legacy.name,
  version:legacy.version,
  description:legacy.description,
  ...(legacy.author?{author:legacy.author}:{}),
  ...(legacy.homepage?{homepage:legacy.homepage}:{}),
  extensions:{
    "com.openai":{
      apps:"./.app.json",
      interface:legacy.interface,
    },
  },
};

await fs.rm(temp,{recursive:true,force:true});
await fs.mkdir(temp,{recursive:true,mode:0o700});

// Portable Agent Plugins discover skills only from root skills/. Keep claude-skills/
// authoritative in source, but project that reviewed tree into the staged package.
await fs.cp(path.join(repo,"claude-skills"),path.join(temp,"skills"),{recursive:true,errorOnExist:false,force:true});

await fs.writeFile(path.join(temp,"plugin.json"),JSON.stringify(portable,null,2)+"\n",{mode:0o600});

// Preserve the OpenAI/Codex compatibility manifest for clients that still consume it.
// Its staged skill path points at the portable root skills/ projection.
const compatibility={...legacy,skills:"./skills/",apps:"./.app.json"};
await fs.mkdir(path.join(temp,".codex-plugin"),{recursive:true,mode:0o700});
await fs.writeFile(path.join(temp,".codex-plugin","plugin.json"),JSON.stringify(compatibility,null,2)+"\n",{mode:0o600});

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
console.log("openai-app: portable private plugin package staged at "+stage+"; App ID is redacted and the source repository was not modified");

const doctor=spawnSync(process.execPath,[path.join(repo,"scripts","openai-plugin-doctor.mjs")],{
  cwd:repo,
  stdio:["ignore","pipe","pipe"],
  encoding:"utf8",
  env:{...process.env,MSO_OPENAI_PLUGIN_STAGE:stage},
});
if(doctor.status!==0){
  process.stderr.write(doctor.stderr||"openai-app: staged package verification failed\n");
  process.exit(doctor.status??2);
}
process.stdout.write(doctor.stdout);
console.log("openai-app: no ChatGPT install or refresh was attempted; staging is preparation only");
