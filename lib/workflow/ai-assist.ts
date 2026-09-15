import { prepareSelectedModel, streamPreparedSelectedModel } from "@/lib/ai/selected-model-stream";
import { WORKFLOW_GRAPH_NODE_TYPES } from "@/lib/contracts/workflow-graph";
import { parseWorkflowGraphDefinition } from "./graph-schema";
export async function suggestWorkflowGraph(prompt:string){
 const request=prompt.trim();if(!request||request.length>4000)throw new Error("workflow AI prompt must be 1-4000 characters");
 const prepared=await prepareSelectedModel(),abort=new AbortController(),timer=setTimeout(()=>abort.abort(new Error("workflow AI suggestion timed out")),45_000);let text="";
 const system=["Design one MSO workflow graph as strict JSON only. No markdown.",`Allowed node types: ${WORKFLOW_GRAPH_NODE_TYPES.join(", ")}.`,`Return keys: name, description, status, inputs, metadata, nodes, edges. Status must be draft.`,"Every node needs id,name,type,position{x,y},config. Every edge needs id,source,target and optional sourceHandle, style (solid|dashed), disabled (boolean).","Never output credentials, tokens, passwords, cookies, authorization headers, or secret values. Use {$var:\"NAME\"} for runtime private variables and integration nodes for credential-backed provider actions.","Use schedule/webhook nodes only as roots. Use true/false handles for condition, named handles/default for switch, error handle for failure branches. Prefer DRY subflows and explicit output nodes."].join(" ");
 try{await streamPreparedSelectedModel({prepared,messages:[{role:"user",text:request}],system,signal:abort.signal,emit:(event,data)=>{if(event==="delta"&&typeof data==="string"&&text.length<256*1024)text+=data;}});}finally{clearTimeout(timer);}
 const clean=text.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,""),start=clean.indexOf("{"),end=clean.lastIndexOf("}");if(start<0||end<=start)throw new Error("workflow AI did not return JSON");
 let raw:unknown;try{raw=JSON.parse(clean.slice(start,end+1));}catch{throw new Error("workflow AI returned invalid JSON");}
 if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error("workflow AI returned invalid graph");const row=raw as Record<string,unknown>,metadata=row.metadata&&typeof row.metadata==="object"&&!Array.isArray(row.metadata)?row.metadata as Record<string,unknown>:{};
 return parseWorkflowGraphDefinition({...row,status:"draft",metadata:{...metadata,provenance:"ai-assisted"}});
}
