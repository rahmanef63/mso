import { FIELD_MAP } from "./mapping";
import { readIntegrationState } from "../connection-storage";
import { connectionCatalog } from "../connection-registry";
import { IntegrationError, resolveSharedConnection } from "../identity";
import { assertTransferSelectionExists, normalizeTransferSelection, transferSelectionMatches } from "./selection";

export type RawCredentialFormat = "json" | "env";
type RawRow = { user:string; provider:string; connection:string; label:string; values:Record<string,string> };

function envKey(value:string){ return value.toUpperCase().replace(/[^A-Z0-9]+/g,"_").replace(/^_+|_+$/g,"") || "VALUE"; }
function dotenvQuote(value:string){return JSON.stringify(value).replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');}

async function rawRows(selectionInput: unknown):Promise<RawRow[]> {
  const state=await readIntegrationState(),selection=normalizeTransferSelection(selectionInput);assertTransferSelectionExists(state,selection);
  const rows:RawRow[]=[];
  for(const [user,profile] of Object.entries(state.users))for(const [provider,connections] of Object.entries(profile.connections))for(const [connection,c] of Object.entries(connections)){
    if(!transferSelectionMatches(selection,user,provider,connection)||c.source!=="direct")continue;
    const backing=resolveSharedConnection(state,user,c).connection,map=FIELD_MAP[provider]??{},reverse=Object.fromEntries(Object.entries(map).map(([wire,native])=>[native,wire]));
    if(Object.keys(backing.values).some(key=>!reverse[key]))throw new IntegrationError("unmapped_export_field");const values=Object.fromEntries(Object.entries(backing.values).map(([key,value])=>[reverse[key],value]));
    if(Object.keys(values).length)rows.push({user,provider,connection,label:c.label,values});
  }
  return rows;
}

export async function exportRawCredentials(selectionInput:unknown,format:RawCredentialFormat){
  const rows=await rawRows(selectionInput),stamp=new Date().toISOString();if(!rows.length)throw new IntegrationError("no_plaintext_credentials_selected",409);
  if(format==="json"){
    const users=[...new Set(rows.map(row=>row.user))].map(user=>({id:user,connections:rows.filter(row=>row.user===user).map(({provider,connection,label,values})=>({provider,id:connection,label,values}))}));
    return{content:JSON.stringify({format:"mso-raw-credentials",version:1,exportedAt:stamp,users},null,2)+"\n",contentType:"application/json; charset=utf-8",filename:`mso-credentials-${stamp.slice(0,10)}.json`,connectionCount:rows.length};
  }
  const single=rows.length===1;const lines=["# MSO RAW CREDENTIAL EXPORT — KEEP PRIVATE",`# Exported ${stamp}`,"# Values below are plaintext. Rotate credentials if this file is exposed.",""];
  for(const row of rows){lines.push(`# ${row.user} / ${row.provider} / ${row.connection} / ${row.label}`);for(const[key,value]of Object.entries(row.values)){const name=single?key:`${envKey(row.user)}__${envKey(row.provider)}__${envKey(row.connection)}__${key}`;lines.push(`${name}=${dotenvQuote(value)}`)}lines.push("")}
  return{content:lines.join("\n"),contentType:"text/plain; charset=utf-8",filename:`mso-credentials-${stamp.slice(0,10)}.env`,connectionCount:rows.length};
}

export async function exportSelectionTree(){
  const state=await readIntegrationState(),titles=Object.fromEntries(connectionCatalog().map(row=>[row.id,row.title]));
  return{users:Object.values(state.users).map(profile=>({id:profile.id,label:profile.label,providers:Object.entries(profile.connections).filter(([,rows])=>Object.keys(rows).length).map(([provider,rows])=>({id:provider,title:titles[provider]??provider,connections:Object.values(rows).map(c=>({id:c.id,label:c.label,source:c.source,storedFields:c.source==="direct"?Object.keys(resolveSharedConnection(state,profile.id,c).connection.values).length:0}))}))}))};
}
