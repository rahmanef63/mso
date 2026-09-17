import path from "node:path";
import { agentSessionsDir } from "@/lib/agent/session-paths";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { workflowGraphOwner } from "./graph-store";

import { readWorkflowJson, writeWorkflowFile } from "./private-file";

export type WorkflowVariableValue = string | number | boolean | null | Record<string, unknown> | unknown[];
type Row = { value: WorkflowVariableValue; secret: boolean; updatedAt: string };
type Store = { version: 1; owner: string; values: Record<string, Row> };
const KEY = /^[A-Z][A-Z0-9_]{0,63}$/;
function file(owner: string) { if (!/^[a-f0-9]{64}$/.test(owner)) throw new Error("invalid workflow variable owner"); return path.join(agentSessionsDir(), ".workflow-variables", owner, "variables.json"); }
async function read(owner: string): Promise<Store> {
  try {
    const row = await readWorkflowJson(file(owner), 256 * 1024, "workflow variable store") as Store;
    if (row.version !== 1 || row.owner !== owner || !row.values || typeof row.values !== "object") throw new Error("invalid workflow variable store");
    return row;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, owner, values: {} }; throw error; }
}
async function write(store: Store) {
  const body = JSON.stringify(store);
  if (Buffer.byteLength(body) > 256 * 1024) throw new Error("workflow variable store too large");
  await writeWorkflowFile(file(store.owner), body);
}
function validValue(value: unknown): asserts value is WorkflowVariableValue { const body=JSON.stringify(value); if(value===undefined||!body||Buffer.byteLength(body)>16*1024) throw new Error("workflow variable value invalid"); }
export async function listWorkflowVariables(principal:string){ const owner=workflowGraphOwner(principal),store=await read(owner); return Object.entries(store.values).sort(([a],[b])=>a.localeCompare(b)).map(([key,row])=>({key,secret:row.secret,updatedAt:row.updatedAt,...(!row.secret?{value:structuredClone(row.value)}:{})})); }
export async function setWorkflowVariable(principal:string,key:string,value:unknown,secret=false){ if(!KEY.test(key)) throw new Error("workflow variable key must be A-Z, 0-9, underscore"); validValue(value); const owner=workflowGraphOwner(principal); return withSecurityStoreLock(file(owner),async()=>{const store=await read(owner); if(!Object.hasOwn(store.values,key)&&Object.keys(store.values).length>=128) throw new Error("workflow variable limit reached"); store.values[key]={value:structuredClone(value),secret:Boolean(secret),updatedAt:new Date().toISOString()}; await write(store); return {key,secret:Boolean(secret),updatedAt:store.values[key]!.updatedAt};}); }
export async function deleteWorkflowVariable(principal:string,key:string){ const owner=workflowGraphOwner(principal); return withSecurityStoreLock(file(owner),async()=>{const store=await read(owner); delete store.values[key]; await write(store); return {key,deleted:true};}); }
export async function workflowVariableValues(principal:string){ const owner=workflowGraphOwner(principal),store=await read(owner); return Object.fromEntries(Object.entries(store.values).map(([key,row])=>[key,structuredClone(row.value)])); }
export async function workflowSecretValues(principal:string){ const owner=workflowGraphOwner(principal),store=await read(owner); return Object.values(store.values).filter((row)=>row.secret).map((row)=>row.value).filter((value):value is string=>typeof value==="string"&&value.length>=4); }
