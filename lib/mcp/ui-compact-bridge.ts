/**
 * Standards-first MCP Apps bridge for compact MSO resources.
 *
 * The host-neutral ui/* postMessage protocol is authoritative. window.openai is
 * retained only as a compatibility fallback for older ChatGPT hosts.
 *
 * The embedded script expects render(raw) and applyHostTheme() in local scope.
 */
export function compactUiBridgeScript(appName: string): string {
  const safeName = JSON.stringify(appName);
  return String.raw`
let msoUiConnected=false,msoUiNextId=1;
const msoUiPending=new Map();
function msoUiRequest(method,params){
  const id=msoUiNextId++;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{msoUiPending.delete(id);reject(new Error("Host request timed out"))},10000);
    msoUiPending.set(id,{resolve,reject,timer});
    window.parent.postMessage({jsonrpc:"2.0",id,method,params},"*");
  });
}
async function msoUiSendMessage(prompt){
  if(msoUiConnected){
    return msoUiRequest("ui/message",{role:"user",content:[{type:"text",text:prompt}]});
  }
  if(window.openai&&typeof window.openai.sendFollowUpMessage==="function"){
    return window.openai.sendFollowUpMessage({prompt});
  }
  throw new Error("Host messaging unavailable");
}
function msoUiOnMessage(event){
  if(event.source!==window.parent)return;
  const message=event.data;
  if(!message||message.jsonrpc!=="2.0")return;
  if(message.id!==undefined&&msoUiPending.has(message.id)){
    const pending=msoUiPending.get(message.id);msoUiPending.delete(message.id);clearTimeout(pending.timer);
    message.error?pending.reject(new Error(message.error.message||"Host request failed")):pending.resolve(message.result);
    return;
  }
  if(message.method==="ui/notifications/tool-result"&&message.params?.structuredContent)render(message.params.structuredContent);
  if(message.method==="ui/notifications/host-context-changed")applyHostTheme();
  if(message.method==="ui/resource-teardown"&&message.id!==undefined){
    window.parent.postMessage({jsonrpc:"2.0",id:message.id,result:{}},"*");
  }
}
async function msoUiInitialize(){
  try{
    const result=await msoUiRequest("ui/initialize",{
      protocolVersion:"2026-01-26",
      appInfo:{name:${safeName},version:"1.0.0"},
      appCapabilities:{}
    });
    if(!result||typeof result.protocolVersion!=="string")throw new Error("Invalid host initialization response");
    msoUiConnected=true;
    window.parent.postMessage({jsonrpc:"2.0",method:"ui/notifications/initialized",params:{}},"*");
  }catch(_){}
}
window.addEventListener("message",msoUiOnMessage,{passive:true});
`;
}
