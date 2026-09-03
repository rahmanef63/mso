import { SURFACE_APPS } from "./surface-catalog";

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

const BROWSER_CATALOG = SURFACE_APPS.map((app) => ({
  id: app.id,
  title: app.title,
  description: app.description,
  origin: app.origin,
  startPath: app.startPath,
  renderer: app.renderer,
  presentation: app.presentation,
  sandbox: app.sandbox ?? "",
  reason: app.reason ?? "",
}));

export const MSO_SURFACE_SCRIPT = String.raw`
const SAFE_APPS=${safeJson(BROWSER_CATALOG)};
const SAFE_BY_ID=new Map(SAFE_APPS.map(app=>[app.id,app]));
const $=id=>document.getElementById(id);
const body=$("surface-body"), titleEl=$("surface-title"), routeEl=$("surface-route"), modeEl=$("surface-mode");
const fsBtn=$("surface-fullscreen"), pipBtn=$("surface-pip"), homeBtn=$("surface-home");
let current={route:"/",kind:"home",title:"MSO",openPath:"/assistant/mcp",catalog:[]};
const pending=new Map();let nextRpcId=5000;

function text(value,fallback="—"){return typeof value==="string"&&value.trim()?value.trim():fallback}
function clear(node){while(node.firstChild)node.removeChild(node.firstChild)}
function el(tag,className,value){const node=document.createElement(tag);if(className)node.className=className;if(value!==undefined)node.textContent=String(value);return node}
function button(label,onClick,className=""){const node=el("button",className,label);node.type="button";node.addEventListener("click",onClick);return node}
function validRoute(route){return typeof route==="string"&&route.startsWith("/")&&!route.startsWith("//")&&route.length<=1024&&!/[\\\u0000-\u001f]/.test(route)}
function safeAppResult(raw){
  if(!raw||typeof raw!=="object")return null;
  const id=text(raw.id,"");const safe=SAFE_BY_ID.get(id);if(!safe)return null;
  let url;try{url=new URL(text(raw.url,""))}catch{return null}
  if(url.protocol!=="https:"||url.origin!==safe.origin||url.username||url.password)return null;
  const start=safe.startPath==="/"?"/":safe.startPath.replace(/\/$/,"");
  if(start!=="/"&&url.pathname!==start&&!url.pathname.startsWith(start+"/"))return null;
  return {...safe,url:url.href};
}
function openPath(path){setMsoTarget(validRoute(path)?path:"/assistant/mcp")}
function applyHostGlobals(){
  const api=window.openai||{};
  const max=Number(api.maxHeight);document.documentElement.style.setProperty("--host-max-h",Number.isFinite(max)&&max>180?Math.floor(max)+"px":"680px");
  const safe=api.safeArea||{};for(const [key,value] of [["top",safe.top],["right",safe.right],["bottom",safe.bottom],["left",safe.left]]){const n=Number(value);document.documentElement.style.setProperty("--safe-"+key,Number.isFinite(n)?Math.max(0,n)+"px":"0px")}
  modeEl.textContent=text(api.displayMode,"inline");
}
async function displayMode(mode){
  try{if(!window.openai||typeof window.openai.requestDisplayMode!=="function")throw new Error("unsupported");await window.openai.requestDisplayMode({mode})}catch(_){modeEl.textContent=mode+" unavailable"}
}
function persistRoute(){
  try{if(window.openai&&typeof window.openai.setWidgetState==="function")window.openai.setWidgetState({modelContent:"MSO Surface: "+current.route,privateContent:{route:current.route},imageIds:[]})}catch(_){}
}
function rpcCall(name,args){
  if(window.openai&&typeof window.openai.callTool==="function")return window.openai.callTool(name,args);
  const id=nextRpcId++;window.parent.postMessage({jsonrpc:"2.0",id,method:"tools/call",params:{name,arguments:args}},"*");
  return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});setTimeout(()=>{if(pending.has(id)){pending.delete(id);reject(new Error("tool timeout"))}},10000)})
}
function unbox(result){return result&&result.structuredContent?result.structuredContent:result}
function nav(route,extra={}){
  if(!validRoute(route))return;
  current={route,kind:route==="/"?"home":"loading",title:"MSO",openPath:"/assistant/mcp",catalog:current.catalog,...extra};render();
  if(route==="/")return;
  rpcCall("render_mso_surface",{route,...(extra.project?{project:extra.project}:{}),...(extra.sha?{sha:extra.sha}:{})}).then(result=>{const value=unbox(result);if(value&&typeof value==="object"){current=value;render()}}).catch(showError)
}
function showError(error){clear(body);const box=el("div","notice");const inner=el("div");inner.append(el("h3","","Surface unavailable"),el("p","error",error&&error.message?error.message:"The requested surface could not be loaded."));box.append(inner);body.append(box)}
function renderHome(){
  const root=el("div","home");const hero=el("section","hero");hero.append(el("h2","","MSO Surface"),el("p","","ChatGPT is another MSO presentation target. Open a native operator view or a reviewed live demo without leaving the conversation."));root.append(hero);
  root.append(el("div","section-title","Native surfaces"));const native=el("div","grid");
  for(const item of [{route:"/monitor",title:"System Monitor",desc:"Live bounded host status."},{route:"/project",title:"Project",desc:"Project snapshot and Git state."},{route:"/diff",title:"Diff",desc:"Review project changes."},{route:"/browser",title:"Remote Browser",desc:"Fallback seam for sites that deny framing."}]){const card=button("",()=>nav(item.route),"card");card.append(el("strong","",item.title),el("span","",item.desc));native.append(card)}root.append(native);
  root.append(el("div","section-title","Reviewed app demos"));const apps=el("div","grid");
  for(const app of SAFE_APPS){const card=button("",()=>nav("/apps/"+encodeURIComponent(app.id)),"card");card.append(el("strong","",app.title),el("span","",app.description),el("span","tag",app.renderer));apps.append(card)}root.append(apps);body.append(root)
}
function renderMonitor(){
  const stage=stageBase("Live bounded VPS status");const metrics=el("div","metrics");for(const name of ["CPU","Memory","Disk"]){const m=el("div","metric");m.append(el("span","",name),el("strong","","…"));metrics.append(m)}stage.content.append(metrics);const list=el("div","list");stage.content.append(list);body.append(stage.root);
  rpcCall("vps_status",{}).then(raw=>{const v=unbox(raw)||{},h=v.health||{},apps=Array.isArray(v.apps)?v.apps:[],browser=v.browser||{};const nodes=metrics.querySelectorAll("strong");nodes[0].textContent=String(h.cpuPercent??h.cpu??"—");nodes[1].textContent=String(h.memory?.percentUsed??h.memoryPercent??"—");nodes[2].textContent=String(h.disk?.percentUsed??h.diskPercent??"—");for(const [label,value] of [["Managed apps",apps.length],["Browser",browser.running?"running":"stopped"],["Infrastructure",Array.isArray(v.infrastructure)?v.infrastructure.filter(x=>x&&x.configured).length+" configured":"—"]]){const row=el("div","line");row.append(el("span","",label),el("strong","",value));list.append(row)}}).catch(showError)
}
function renderProject(kind){
  const project=text(current.project,"");if(!project){renderProjectPrompt(kind);return}const stage=stageBase(kind==="diff"?"Project diff":"Project status");const list=el("div","list");stage.content.append(list);body.append(stage.root);
  const tool=kind==="diff"?"project_diff":"project_get";const args={project,...(kind==="diff"&&current.sha?{sha:current.sha}:{})};rpcCall(tool,args).then(raw=>{const v=unbox(raw)||{};if(kind==="project"){const p=v.project||{},g=v.git||{},pkg=v.package||{};for(const [label,value] of [["Project",p.name||project],["Branch",g.branch],["HEAD",g.head?.sha?String(g.head.sha).slice(0,12):"—"],["Package",[pkg.name,pkg.version].filter(Boolean).join(" · ")||"—"],["Working tree",g.clean===true?"clean":g.clean===false?"changed":"—"]])appendLine(list,label,value)}else{const s=v.summary||{};for(const [label,value] of [["Project",v.project?.name||project],["Files",s.files??"—"],["Additions",s.additions??"—"],["Deletions",s.deletions??"—"],["Mode",v.mode??"—"]])appendLine(list,label,value)}}).catch(showError)
}
function renderProjectPrompt(kind){const box=el("div","notice");const inner=el("div");inner.append(el("h3","",kind==="diff"?"Choose a project in chat":"Project context needed"),el("p","","Ask ChatGPT to render this surface with a project id/name. The widget does not guess filesystem paths or enumerate private projects on its own."));box.append(inner);body.append(box)}
function appendLine(list,label,value){const row=el("div","line");row.append(el("span","",label),el("strong","mono",value==null?"—":value));list.append(row)}
function stageBase(subtitle){const root=el("div","stage"),head=el("div","stage-head"),content=el("div");head.append(button("←",()=>nav("/"),"back"));const t=el("div","stage-title");t.append(el("strong","",current.title),el("span","",subtitle));head.append(t);root.append(head,content);return{root,content}}
function renderApp(){
  const raw=current.app,safe=safeAppResult(raw);if(!safe){showError(new Error("The app result is not in the reviewed MSO Surface registry."));return}const stage=stageBase(safe.renderer==="iframe"?"Live app demo":"Remote-browser fallback");body.append(stage.root);openPath(safe.renderer==="remote"?"/browser":"/assistant/mcp");
  if(safe.renderer==="iframe"){const wrap=el("div","frame-wrap"),frame=document.createElement("iframe");frame.title=safe.title+" live demo";frame.src=safe.url;frame.setAttribute("sandbox",safe.sandbox);frame.referrerPolicy="no-referrer";frame.allow="fullscreen";wrap.append(frame);stage.content.append(wrap);return}
  const box=el("div","notice"),inner=el("div");inner.append(el("h3","",safe.title+" protects itself from framing"),el("p","",safe.reason||"This app is not allowlisted for nested framing. MSO preserves the app's own frame policy instead of stripping it."));const row=el("div","row");row.append(button("Open Remote Browser",()=>openMso(),"primary"));if(window.openai&&typeof window.openai.sendFollowUpMessage==="function")row.append(button("Ask ChatGPT to continue",()=>window.openai.sendFollowUpMessage({prompt:"Continue this demo using the MSO remote-browser fallback for "+safe.title+"."})));inner.append(row);box.append(inner);stage.content.append(box);if(safe.presentation==="pip")pipBtn.hidden=false
}
function renderBrowser(){const box=el("div","notice"),inner=el("div");inner.append(el("h3","","Remote Browser seam"),el("p","","Sites that deny iframe embedding stay isolated. MSO can continue them through Camoufox without exposing its VNC password or authenticated viewer URL to this widget."));const row=el("div","row");row.append(button("Open MSO Browser",()=>openMso(),"primary"));inner.append(row);box.append(inner);body.append(box);openPath("/browser")}
function render(){clear(body);titleEl.textContent=text(current.title,"MSO Surface");routeEl.textContent=text(current.route,"/");openPath(text(current.openPath,"/assistant/mcp"));persistRoute();if(current.kind==="home")renderHome();else if(current.kind==="monitor")renderMonitor();else if(current.kind==="project")renderProject("project");else if(current.kind==="diff")renderProject("diff");else if(current.kind==="app")renderApp();else if(current.kind==="browser")renderBrowser();else body.append(el("div","loading","Loading MSO Surface…"))}
function readOutput(){const value=window.openai&&window.openai.toolOutput;if(value&&typeof value==="object"){current=value;render()}}
window.addEventListener("message",event=>{if(event.source!==window.parent)return;const msg=event.data;if(!msg||msg.jsonrpc!=="2.0")return;if(msg.id!==undefined&&pending.has(msg.id)){const req=pending.get(msg.id);pending.delete(msg.id);msg.error?req.reject(msg.error):req.resolve(msg.result);return}if(msg.method==="ui/notifications/tool-result"&&msg.params&&msg.params.structuredContent){current=msg.params.structuredContent;render()}},{passive:true});
window.addEventListener("openai:set_globals",()=>{applyHostGlobals();readOutput()},{passive:true});
fsBtn.addEventListener("click",()=>displayMode("fullscreen"));pipBtn.addEventListener("click",()=>displayMode("pip"));homeBtn.addEventListener("click",()=>nav("/"));
applyHostGlobals();readOutput();render();
`;
