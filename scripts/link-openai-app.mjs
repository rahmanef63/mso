#!/usr/bin/env node
import { constants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const repo=path.resolve(path.dirname(new URL(import.meta.url).pathname),"..");
const args=process.argv.slice(2);
const fail=(message)=>{console.error("openai-app: "+message);process.exit(2)};
const normalize=(raw)=>String(raw??"").trim().replace(/^plugin_(?=asdk_app_)/,"");
const canonicalApp=(raw)=>{
  const id=normalize(raw);
  if(!/^asdk_app_[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) fail("expected a registered OpenAI app id (asdk_app_… or plugin_asdk_app_… browser form)");
  return id;
};
const canonicalBinding=(raw)=>{
  const id=normalize(raw);
  if(!/^(?:asdk_app_|connector_|templated_apps_)[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) fail("expected an exact canonical OpenAI app/connector id");
  return id;
};
const option=(name)=>{
  const i=args.indexOf(name);
  return i>=0?args[i+1]:undefined;
};
const target=path.resolve(option("--output")??path.join(repo,".app.json"));
const store=path.resolve(process.env.OS_INFRA_STORE??path.join(os.homedir(),".mso","private","infra-providers.json"));

async function privateAppId(){
  let handle;
  try{
    handle=await fs.open(store,constants.O_RDONLY|constants.O_NOFOLLOW);
    const st=await handle.stat();
    if(!st.isFile()||st.size<1||st.size>1024*1024||(st.mode&0o077)||(typeof process.getuid==="function"&&st.uid!==process.getuid()))fail("Integrations store is missing or unsafe");
    const state=JSON.parse(await handle.readFile("utf8"));
    if(state?.version!==2||!state?.users||typeof state.users!=="object")fail("Integrations store is not v2");
    const user=option("--user")??process.env.MSO_OPENAI_APP_USER??state.defaultUser;
    if(!user||!state.users[user])fail("choose an Integrations user with --user or MSO_OPENAI_APP_USER");
    const rows=state.users[user].connections?.["openai-app"]??{};
    const connection=option("--connection")??process.env.MSO_OPENAI_APP_CONNECTION??state.users[user].defaults?.["openai-app"]??(Object.keys(rows).length===1?Object.keys(rows)[0]:undefined);
    if(!connection||!rows[connection])fail("choose an OpenAI App Integrations connection with --connection or MSO_OPENAI_APP_CONNECTION");
    const appId=rows[connection].values?.appId;
    if(!appId)fail("selected OpenAI App integration has no stored App ID");
    return canonicalApp(appId);
  }catch(error){
    if(error?.code==="ENOENT")fail("private Integrations store not found; configure OpenAI / ChatGPT App in MSO Integrations first");
    throw error;
  }finally{await handle?.close();}
}

if(args.includes("--clear")){
  await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});
  await fs.writeFile(target,JSON.stringify({apps:{}},null,2)+"\n",{mode:0o600});
  console.log("openai-app: cleared registered app mapping; live MCP authorization is unchanged");
  process.exit(0);
}

const optionValues=new Set([option("--output"),option("--user"),option("--connection")].filter(Boolean));
const explicit=args.find(v=>!v.startsWith("--")&&!optionValues.has(v));
const id=explicit?canonicalBinding(explicit):await privateAppId();
await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});
await fs.writeFile(target,JSON.stringify({apps:{mso:{id,required:true}}},null,2)+"\n",{mode:0o600});
console.log("openai-app: linked mso from "+(explicit?"explicit input":"private Integrations binding")+"; id redacted");
