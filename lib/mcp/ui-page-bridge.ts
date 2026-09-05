// Browser-side MCP Apps lifecycle. Source-checked postMessage remains inside the host bridge.
export const MSO_PAGE_BRIDGE_SCRIPT = String.raw`
let hostConnected=false, hostContext={}, lastOutputKey="", viewCleanup=()=>{};
let lastPageSize="";
function reportPageSize(){
  if(!hostConnected)return;const root=document.querySelector(".surface");if(!root)return;
  const rect=root.getBoundingClientRect(),style=getComputedStyle(document.body);
  const height=Math.ceil(rect.height+(parseFloat(style.paddingTop)||0)+(parseFloat(style.paddingBottom)||0));
  const width=Math.ceil(document.documentElement.clientWidth),key=width+","+height;
  if(height<1||height>1600||key===lastPageSize)return;lastPageSize=key;
  window.parent.postMessage({jsonrpc:"2.0",method:"ui/notifications/size-changed",params:{width,height}},"*");
}
const pageResizeObserver=typeof ResizeObserver==="function"?new ResizeObserver(()=>requestAnimationFrame(reportPageSize)):null;

function rpcRequest(method,params){
  const id=nextRpcId++;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error("Host request timed out"))},10000);
    pending.set(id,{resolve,reject,timer});
    window.parent.postMessage({jsonrpc:"2.0",id,method,params},"*");
  });
}
function acceptPageResult(result){
  const value=unbox(result);
  if(!value||typeof value!=="object"||!validRoute(value.route)||!["home","monitor","project","diff","browser","app"].includes(value.kind))return false;
  if(value.kind==="app"&&!safeAppResult(value.app))return false;
  const key=JSON.stringify([value.route,value.kind,value.project,value.sha,value.app?.url]);
  if(key===lastOutputKey)return true;
  lastOutputKey=key;current=value;render();return true;
}
function acceptPageInput(params){
  if(lastOutputKey)return;
  const args=params&&params.arguments;
  if(args&&validRoute(args.route)){routeEl.textContent=args.route;body.replaceChildren(el("div","loading","Waiting for page data…"))}
}
function onHostMessage(event){
  if(event.source!==window.parent)return;
  const msg=event.data;if(!msg||msg.jsonrpc!=="2.0")return;
  if(msg.id!==undefined&&pending.has(msg.id)){
    const request=pending.get(msg.id);pending.delete(msg.id);clearTimeout(request.timer);
    msg.error?request.reject(new Error(text(msg.error.message,"Host request failed"))):request.resolve(msg.result);return;
  }
  if(msg.method==="ui/notifications/tool-result"){if(msg.params?.isError)showError(new Error("The page tool reported an error. Retry from chat."));else if(!acceptPageResult(msg.params))showError(new Error("The host returned invalid page data."))}
  if(msg.method==="ui/notifications/tool-input")acceptPageInput(msg.params);
  if(msg.method==="ui/notifications/host-context-changed"){hostContext={...hostContext,...msg.params};applyHostGlobals()}
  if(msg.method==="ui/resource-teardown"&&msg.id!==undefined){viewCleanup();pageResizeObserver?.disconnect();window.parent.postMessage({jsonrpc:"2.0",id:msg.id,result:{}},"*")}
}
async function initializeMcpPage(){
  try{
    const result=await rpcRequest("ui/initialize",{
      protocolVersion:"2026-01-26",
      appInfo:{name:"MSO Page",version:"3.0.0"},
      appCapabilities:{availableDisplayModes:["inline","fullscreen","pip"]}
    });
    if(!result||typeof result.protocolVersion!=="string")throw new Error("Invalid host initialization response");
    hostConnected=true;hostContext=result.hostContext||{};applyHostGlobals();
    window.parent.postMessage({jsonrpc:"2.0",method:"ui/notifications/initialized",params:{}},"*");
    const root=document.querySelector(".surface");if(root)pageResizeObserver?.observe(root);reportPageSize();
  }catch(error){if(!lastOutputKey)showError(new Error("The chat host did not initialize the page. Reopen the preview or refresh the connector."))}
}
`;
