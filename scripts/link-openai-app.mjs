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
const id=args[0]?.trim();
if(!id) fail("usage: bun run plugin:link-app -- <plugin_asdk_app...|asdk_app...> | --clear");
if(!/^(?:plugin_)?asdk_app_[a-z0-9]+$/.test(id)) fail("expected an exact registered OpenAI app id; placeholders and URLs are rejected");
await fs.writeFile(target,JSON.stringify({apps:{mso:{id,required:true}}},null,2)+"\n");
console.log(`openai-app: linked mso -> ${id}`);
