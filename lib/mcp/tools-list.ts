import { MSO_LIST_URI } from "./ui-list";
import { type McpTool, READ_ONLY, S, str } from "./tool-kit";

const META_SCHEMA={type:"object",properties:{label:{type:"string",maxLength:80},value:{type:"string",maxLength:240}},required:["value"],additionalProperties:false} as const;
const ACTION_SCHEMA={type:"object",properties:{id:{type:"string",maxLength:80},label:{type:"string",maxLength:80},style:{type:"string",enum:["primary","secondary"]},prompt:{type:"string",minLength:1,maxLength:1200}},required:["label","prompt"],additionalProperties:false} as const;
const ITEM_SCHEMA={type:"object",properties:{id:{type:"string",minLength:1,maxLength:120},title:{type:"string",minLength:1,maxLength:240},subtitle:{type:"string",maxLength:500},badge:{type:"string",maxLength:80},status:{type:"string",enum:["neutral","info","success","warning","error"]},icon:{type:"string",enum:["project","file","folder","workflow","session","app","integration","agent","server","code","item"]},meta:{type:"array",maxItems:4,items:META_SCHEMA},actions:{type:"array",maxItems:2,items:ACTION_SCHEMA}},required:["id","title"],additionalProperties:false} as const;

export const LIST_OUTPUT_SCHEMA={type:"object",properties:{title:{type:"string"},description:{type:"string"},layout:{type:"string"},searchable:{type:"boolean"},emptyMessage:{type:"string"},items:{type:"array"},actions:{type:"array"}},required:["title","layout","searchable","emptyMessage","items","actions"],additionalProperties:false} as const;
const text=(v:unknown,max:number,f="")=>typeof v==="string"&&v.trim()?v.trim().slice(0,max):f;
const rows=(v:unknown,max:number):Array<Record<string,unknown>>=>Array.isArray(v)?v.filter((x):x is Record<string,unknown>=>Boolean(x)&&typeof x==="object"&&!Array.isArray(x)).slice(0,max):[];
const choice=<T extends string>(v:unknown,a:readonly T[],f:T):T=>typeof v==="string"&&a.includes(v as T)?v as T:f;
const normalizeAction=(a:Record<string,unknown>,i:number)=>({id:text(a.id,80,`action-${i+1}`),label:text(a.label,80,"Open"),style:choice(a.style,["primary","secondary"] as const,"secondary"),prompt:text(a.prompt,1200,"Continue with the selected MSO item.")});
function normalizeList(input:Record<string,unknown>){
  const items=rows(input.items,40).map((item,index)=>({id:text(item.id,120,`item-${index+1}`),title:text(item.title,240,`Item ${index+1}`),...(text(item.subtitle,500)?{subtitle:text(item.subtitle,500)}:{}),...(text(item.badge,80)?{badge:text(item.badge,80)}:{}),status:choice(item.status,["neutral","info","success","warning","error"] as const,"neutral"),icon:choice(item.icon,["project","file","folder","workflow","session","app","integration","agent","server","code","item"] as const,"item"),meta:rows(item.meta,4).map(m=>({...(text(m.label,80)?{label:text(m.label,80)}:{}),value:text(m.value,240)})),actions:rows(item.actions,2).map(normalizeAction)}));
  return {title:text(input.title,240,"MSO list"),...(text(input.description,1000)?{description:text(input.description,1000)}:{}),layout:choice(input.layout,["list","grid"] as const,"list"),searchable:input.searchable===true,emptyMessage:text(input.emptyMessage,240,"No items."),items,actions:rows(input.actions,3).map(normalizeAction)};
}

export const LIST_TOOLS:McpTool[]=[{
  name:"render_mso_list",title:"Render MSO List",
  description:"Render a compact searchable MCP App list/grid after a data tool has returned the relevant items. Use it for projects, files, sessions, workflows, apps, integrations, agents, or other bounded collections. Keep data tools headless; this render tool only presents model-selected data. Item/global buttons send follow-up prompts and never execute mutations directly.",
  chatgptDescription:"Render a compact list/grid from already-fetched MSO data. Use after list/search tools; buttons only return follow-ups to chat.",
  scope:"read",annotations:READ_ONLY,
  inputSchema:S({title:{type:"string",minLength:1,maxLength:240},description:{type:"string",maxLength:1000},layout:{type:"string",enum:["list","grid"]},searchable:{type:"boolean"},emptyMessage:{type:"string",maxLength:240},items:{type:"array",maxItems:40,items:ITEM_SCHEMA},actions:{type:"array",maxItems:3,items:ACTION_SCHEMA}},["title","items"]),
  outputSchema:LIST_OUTPUT_SCHEMA,
  meta:{ui:{resourceUri:MSO_LIST_URI,visibility:["model","app"]},"ui/resourceUri":MSO_LIST_URI,"openai/toolInvocation/invoking":"Preparing list…","openai/toolInvocation/invoked":"List ready","openai/widgetAccessible":true},
  run:async input=>normalizeList({...input,title:str(input,"title")}),
}];
