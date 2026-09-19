#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

const repo=path.resolve(path.dirname(new URL(import.meta.url).pathname),"..");
const target=path.join(repo,".app.json");
const args=process.argv.slice(2);
const fail=(message)=>{console.error(`openai-app: ${message}`);process.exit(2)};
if(args.includes("--clear")){
  await fs.writeFile(target,JSON.stringify({apps:{}},null,2)+"\n");
  console.log("openai-app: cleared registered app mapping; live MCP authorization is unchanged");
  process.exit(0);
}
const raw=args[0]?.trim();
if(!raw) fail("usage: bun run plugin:link-app -- <asdk_app...|connector_...|templated_apps_...> | --clear");
const id=raw.startsWith("plugin_asdk_app_")?raw.slice("plugin_".length):raw;
if(!/^(?:asdk_app_|connector_|templated_apps_)[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id))
  fail("expected an exact canonical OpenAI app/connector id; placeholders and URLs are rejected");
await fs.writeFile(target,JSON.stringify({apps:{mso:{id,required:true}}},null,2)+"\n");
console.log(`openai-app: linked mso -> ${id}${raw===id?"":" (normalized from plugin URL id)"}`);
