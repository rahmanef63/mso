import { MSO_HOST_STYLE_ALIASES } from "@/lib/presentation/widget-tokens";
import { MSO_PAGE_INTEGRATIONS_SCRIPT } from "./ui-page-integrations";
import { MSO_PAGE_BRIDGE_SCRIPT } from "./ui-page-bridge";
import { surfaceApps, type SurfaceApp } from "./surface-catalog";
import { MSO_WIDGET_THEME_SCRIPT } from "./ui-widget-tokens";

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function browserCatalog(apps: readonly SurfaceApp[]) {
  return apps.map((app) => ({
    id: app.id,
    title: app.title,
    description: app.description,
    origin: app.origin,
    startPath: app.startPath,
    renderer: app.renderer,
    presentation: app.presentation,
    environment: app.environment,
    reason: app.reason ?? "",
    project: app.project,
    sandbox: app.sandbox ?? "allow-scripts",
  }));
}

export async function msoSurfaceScript(apps?: readonly SurfaceApp[]): Promise<string> {
  const catalog = browserCatalog(apps ?? await surfaceApps());
  return String.raw`
${MSO_WIDGET_THEME_SCRIPT}
const SAFE_APPS=${safeJson(catalog)};
const HOST_STYLE_ALIASES=${safeJson(MSO_HOST_STYLE_ALIASES)};
const PAGE_VIEWS=[{route:"/",title:"Workspace"},{route:"/integrations",title:"Integrations"},{route:"/project",title:"Project"},{route:"/diff",title:"Diff"},{route:"/sessions",title:"Sessions"},{route:"/assets",title:"Session assets"},{route:"/monitor",title:"System Monitor"},{route:"/browser",title:"Remote Browser"}];
const SAFE_BY_ID=new Map(SAFE_APPS.map(app=>[app.id,app]));
const $=id=>document.getElementById(id);
const body=$("surface-body"), titleEl=$("surface-title"), routeEl=$("surface-route"), modeEl=$("surface-mode");
const fsBtn=$("surface-fullscreen"), pipBtn=$("surface-pip"), homeBtn=$("surface-home");
let viewVersion=0;
let current={route:"/",kind:"home",title:"MSO",openPath:"/assistant/mcp",catalog:[]};
const pending=new Map();let nextRpcId=5000;
${MSO_PAGE_BRIDGE_SCRIPT}
${MSO_PAGE_INTEGRATIONS_SCRIPT}

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
  const api=hostConnected?{...(window.openai||{}),...hostContext}:{...hostContext,...(window.openai||{})};
  applyHostTheme();
  const styles=api.styles?.variables||{},style=document.documentElement.style;
  for(const key of Array.from(style)){if(key.startsWith("--color-")||key.startsWith("--font-")||key.startsWith("--border-radius-"))style.removeProperty(key)}
  for(const [key,value] of Object.entries(styles)){if(/^--(?:color-|font-|border-radius-)[a-z-]+$/.test(key)&&typeof value==="string"&&value.length<=256&&!/[;{}<>]|url\s*\(/i.test(value))style.setProperty(key,value)}
  for(const [local,host] of Object.entries(HOST_STYLE_ALIASES)){style.removeProperty(local);if(style.getPropertyValue(host))style.setProperty(local,"var("+host+")")}

  if(api.theme==="light"||api.theme==="dark")document.documentElement.dataset.theme=api.theme;
  // MCP Apps fixed height fills the host; flexible height uses its full allowance.
  // Never derive our height from the current iframe viewport: resize feedback shrinks it.
  const dimensions=api.containerDimensions||{},values=[dimensions.height,dimensions.maxHeight,api.maxHeight];
  const height=values.find(value=>typeof value==="number"&&Number.isFinite(value)&&value>0)??680;
  document.documentElement.style.setProperty("--page-height",Math.floor(height)+"px");
  const safe=api.safeAreaInsets||api.safeArea||{};for(const [key,value] of [["top",safe.top],["right",safe.right],["bottom",safe.bottom],["left",safe.left]]){const n=Number(value);document.documentElement.style.setProperty("--safe-"+key,Number.isFinite(n)?Math.max(0,n)+"px":"0px")}
  const mode=["inline","fullscreen","pip"].includes(api.displayMode)?api.displayMode:"inline";
  document.documentElement.dataset.displayMode=mode;
  if(Array.isArray(api.availableDisplayModes)){pipBtn.hidden=!api.availableDisplayModes.includes("pip");fsBtn.hidden=mode!=="fullscreen"&&!api.availableDisplayModes.includes("fullscreen")}
  requestAnimationFrame(reportPageSize);
  fsBtn.title=mode==="fullscreen"?"Exit fullscreen":"Fullscreen";
  fsBtn.setAttribute("aria-label",mode==="fullscreen"?"Exit fullscreen":"Fullscreen");
}
async function displayMode(mode){
  try{const target=mode==="fullscreen"&&document.documentElement.dataset.displayMode==="fullscreen"?"inline":mode;let result;
  if(hostConnected){result=await rpcRequest("ui/request-display-mode",{mode:target});if(result&&["inline","fullscreen","pip"].includes(result.mode||result.displayMode))hostContext={...hostContext,displayMode:result.mode||result.displayMode};}
  else{if(!window.openai||typeof window.openai.requestDisplayMode!=="function")throw new Error("unsupported");result=await window.openai.requestDisplayMode({mode:target});}
  modeEl.textContent="";applyHostGlobals();}catch(_){modeEl.textContent="This host could not open "+mode+". Use Open in MSO."}
}
function persistRoute(){
  try{if(window.openai&&typeof window.openai.setWidgetState==="function")window.openai.setWidgetState({modelContent:"MSO Page: "+current.route,privateContent:{route:current.route},imageIds:[]})}catch(_){}
}
async function rpcCall(name,args){const version=viewVersion;const result=await rpcRequest("tools/call",{name,arguments:args});if(version!==viewVersion){const error=new Error("View changed");error.name="AbortError";throw error}if(result?.isError||result?.error)throw new Error("MSO could not complete this action. Check the selected context and connection.");return result}
function unbox(result){if(!result||typeof result!=="object")return result;if(result.structuredContent)return unbox(result.structuredContent);if(result.result)return unbox(result.result);return result}
function nav(route,extra={}){
  if(!validRoute(route))return;
  extra={...(current.project?{project:current.project}:{}),...extra};
  if(route!=="/integrations")integrationAccess=null;
  lastOutputKey="";current={route,kind:route==="/"?"home":"loading",title:"MSO",openPath:"/assistant/mcp",catalog:current.catalog,...extra};render();
  if(route==="/")return;
  rpcCall("render_mso_page",{route,...(extra.project?{project:extra.project}:{}),...(extra.sha?{sha:extra.sha}:{})}).then(result=>{if(!acceptPageResult(result))throw new Error("Invalid page result")}).catch(showError)
}
function showError(error){if(error?.name==="AbortError")return;viewCleanup();viewCleanup=()=>{};clear(body);const box=el("div","notice");const inner=el("div");inner.append(el("h3","","Page unavailable"),el("p","error",error&&error.message?error.message:"The requested page could not be loaded."));inner.append(button("Try again",()=>nav(current.route,{project:current.project,sha:current.sha})));box.append(inner);body.append(box)}
function renderHome(){
  const root=el("div","home");const hero=el("section","hero");hero.append(el("h2","","MSO Page"),el("p","","Manage your services, inspect projects, and check your server."));root.append(hero);
  root.append(el("div","section-title","Workspace"));const native=el("div","grid");
  for(const item of PAGE_VIEWS.filter(item=>item.route!=="/")){const card=button("",()=>nav(item.route),"card");card.append(el("strong","",item.title),el("span","",item.route));native.append(card)}root.append(native);
  root.append(el("div","section-title","Your apps"));const apps=el("div","grid");
  for(const app of SAFE_APPS){const card=button("",()=>nav("/apps/"+encodeURIComponent(app.id),{project:app.project}),"card");card.append(el("strong","",app.title),el("span","",app.description),el("span","tag",app.environment+" · "+app.renderer));apps.append(card)}root.append(apps);body.append(root)
}
function renderMonitor(){
  const stage=stageBase("Live bounded VPS status");const metrics=el("div","metrics");for(const name of ["CPU","Memory","Disk"]){const m=el("div","metric");m.append(el("span","",name),el("strong","","…"));metrics.append(m)}stage.content.append(metrics);const list=el("div","list");stage.content.append(list);body.append(stage.root);
  rpcCall("vps_status",{}).then(raw=>{const v=unbox(raw)||{},h=v.health||{},apps=Array.isArray(v.apps)?v.apps:[],browser=v.browser||{};const nodes=metrics.querySelectorAll("strong");const percent=value=>Number.isFinite(value)?Math.round(value)+"%":"—",used=metric=>metric?.total>0?metric.used/metric.total*100:NaN;nodes[0].textContent=percent(h.cpu?.pct);nodes[1].textContent=percent(used(h.mem));nodes[2].textContent=percent(used(h.disk));for(const [label,value] of [["Managed apps",apps.length],["Browser",browser.running?"running":"stopped"],["Infrastructure",Array.isArray(v.infrastructure)?v.infrastructure.filter(x=>x&&x.configured).length+" configured":"—"]]){const row=el("div","line");row.append(el("span","",label),el("strong","",value));list.append(row)}}).catch(showError)
}
function renderProject(kind){
  const project=text(current.project,"");if(!project){renderProjectPrompt(kind);return}const stage=stageBase(kind==="diff"?"Project diff":"Project status");const list=el("div","list");stage.content.append(list);body.append(stage.root);
  stage.content.prepend(button("Change project",()=>{clear(body);renderProjectPrompt(kind)}));
  const tool=kind==="diff"?"project_diff":"project_get";const args={project,...(kind==="diff"&&current.sha?{sha:current.sha}:{})};rpcCall(tool,args).then(raw=>{const v=unbox(raw)||{};if(kind==="project"){const p=v.project||{},g=v.git||{},pkg=v.package||{};for(const [label,value] of [["Project",p.name||project],["Branch",g.branch],["HEAD",g.head?.sha?String(g.head.sha).slice(0,12):"—"],["Package",[pkg.name,pkg.version].filter(Boolean).join(" · ")||"—"],["Working tree",g.clean===true?"clean":g.clean===false?"changed":"—"]])appendLine(list,label,value)}else{const s=v.summary||{};for(const [label,value] of [["Project",v.project?.name||project],["Files",s.files??"—"],["Additions",s.additions??"—"],["Deletions",s.deletions??"—"],["Mode",v.mode??"—"]])appendLine(list,label,value)}}).catch(showError)
}
function renderProjectPrompt(kind){
  const form=el("form","notice"),heading=el("h3","","Open a project"),label=el("label","","Project name, ID, or path"),input=el("input","project-input"),submit=button("Open project",()=>{} ,"primary");
  input.id="page-project";input.name="project";input.required=true;input.maxLength=512;input.autocomplete="off";input.value=current.project||"";label.htmlFor=input.id;submit.type="submit";
  form.append(heading,el("p","","Use a project registered in MSO. This context carries through status, changes and navigation."),label,input,submit);form.addEventListener("submit",event=>{event.preventDefault();if(form.reportValidity())nav(kind==="diff"?"/diff":"/project",{project:input.value.trim()})});body.append(form)
}
function appendLine(list,label,value){const row=el("div","line");row.append(el("span","",label),el("strong","mono",value==null?"—":value));list.append(row)}
function stageBase(subtitle){const root=el("div","stage"),head=el("div","stage-head"),content=el("div","stage-content");head.append(button("Back",()=>nav("/"),"back"));const t=el("div","stage-title");t.append(el("strong","",current.title),el("span","",subtitle));head.append(t);root.append(head,content);return{root,content}}
function renderApp(){
  const safe=safeAppResult(current.app);if(!safe){showError(new Error("This preview is not in the reviewed MSO registry. Reopen the Page after refreshing its tool definitions."));return}
  const stage=stageBase([safe.environment,current.project||safe.project,safe.origin].filter(Boolean).join(" · "));body.append(stage.root);openPath("/browser");
  const actions=el("div","row");actions.append(button("Open preview",()=>openIntegrationReference(safe.url)),button("MSO Browser",()=>openMso()));
  if(safe.renderer!=="iframe"){const note=el("div","notice");note.append(el("h3","",safe.title),el("p","",safe.reason||"This app requires its own browser session."),actions);stage.content.append(note);return}
  const frame=el("iframe","preview-frame"),status=el("p","preview-status","Loading reviewed preview…");status.setAttribute("role","status");
  frame.title=safe.title+" preview";frame.referrerPolicy="no-referrer";frame.setAttribute("sandbox",safe.sandbox);frame.src=safe.url;
  const fallback=setTimeout(()=>{status.textContent="Preview taking too long? Open it directly if this host or the project blocks embedding."},8000);
  frame.addEventListener("load",()=>{clearTimeout(fallback);status.textContent="Preview requested. If the frame is blank or sign-in is required, use Open preview."});
  frame.addEventListener("error",()=>{clearTimeout(fallback);status.textContent="The preview could not load. Open it directly."});
  stage.content.append(frame,status,actions);viewCleanup=()=>{clearTimeout(fallback);frame.remove()};
}
function renderSessions(){
  const stage=stageBase("Latest 50 saved conversations owned by this MCP connection. Open in MSO for the full searchable owner history.");body.append(stage.root);
  const list=el("div","list");stage.content.append(list,button("Refresh sessions",()=>nav("/sessions")));
  rpcCall("agent_sessions_list",{limit:50}).then(raw=>{const value=unbox(raw),rows=Array.isArray(value)?value:value?.sessions||[];if(!rows.length)list.append(el("p","","No sessions saved for this connection yet."));for(const row of rows){const item=el("article","card");item.append(el("strong","",row.title||row.name||row.id),el("span","mono",row.id),el("span","",[row.source,row.updatedAt,row.cwd].filter(Boolean).join(" · ")));list.append(item)}}).catch(showError)
}
function renderAssets(offset=0){
  const stage=stageBase("Private assets from this conversation. Select an image or report to preview it.");body.append(stage.root);const list=el("div","grid"),preview=el("div");stage.content.append(list,preview);
  rpcCall("session_artifacts",{limit:50,offset}).then(raw=>{const value=unbox(raw),rows=value?.artifacts||value?.files||[];if(!rows.length)list.append(el("p","","No saved assets in this session yet."));for(const asset of rows){const item=button("",async()=>{try{const response=await rpcCall("session_artifacts",{artifact_id:asset.id});clear(preview);const image=response.content?.find(c=>c.type==="image"&&["image/png","image/jpeg","image/webp"].includes(c.mimeType)&&typeof c.data==="string"&&c.data.length<=850000&&/^[A-Za-z0-9+/=]+$/.test(c.data));if(image){const img=el("img","artifact-preview");img.alt=asset.name||asset.filename||"Session image";img.src="data:"+image.mimeType+";base64,"+image.data;preview.append(img)}else preview.append(el("pre","report-preview",unbox(response)?.text||"No preview available."))}catch(error){showError(error)}},"card");item.append(el("strong","",asset.name||asset.filename||asset.id),el("span","",[asset.mimeType,asset.bytes?asset.bytes+" bytes":""].filter(Boolean).join(" · ")));list.append(item)}const paging=el("div","row");if(offset)paging.append(button("Previous assets",()=>{clear(body);renderAssets(Math.max(0,offset-50))}));if(Number.isInteger(value.nextOffset))paging.append(button("Next assets",()=>{clear(body);renderAssets(value.nextOffset)}));stage.content.append(paging)}).catch(showError)
}
function renderBrowser(){const box=el("div","notice"),inner=el("div");inner.append(el("h3","","Remote Browser seam"),el("p","","Sites that deny iframe embedding stay isolated. MSO can continue them through Camoufox without exposing its VNC password or authenticated viewer URL to this widget."));const row=el("div","row");row.append(button("Open MSO Browser",()=>openMso(),"primary"));inner.append(row);box.append(inner);body.append(box);openPath("/browser")}
function render(){viewVersion++;viewCleanup();viewCleanup=()=>{};clear(body);titleEl.textContent="MSO";routeEl.textContent=text(current.project||current.title,"Workspace");$("surface-nav").value=current.route;openPath(text(current.openPath,"/assistant/mcp"));persistRoute();if(current.kind==="home")renderHome();else if(current.kind==="integrations")renderIntegrations();else if(current.kind==="monitor")renderMonitor();else if(current.kind==="project")renderProject("project");else if(current.kind==="diff")renderProject("diff");else if(current.kind==="sessions")renderSessions();else if(current.kind==="assets")renderAssets();else if(current.kind==="app")renderApp();else if(current.kind==="browser")renderBrowser();else body.append(el("div","loading","Loading MSO Page…"))}
function readOutput(){return acceptPageResult(window.openai&&window.openai.toolOutput)}
window.addEventListener("message",onHostMessage,{passive:true});
window.addEventListener("openai:set_globals",()=>{applyHostGlobals();readOutput()},{passive:true});
fsBtn.addEventListener("click",()=>displayMode("fullscreen"));pipBtn.addEventListener("click",()=>displayMode("pip"));homeBtn.addEventListener("click",()=>nav("/"));
const navSelect=$("surface-nav");for(const item of [...PAGE_VIEWS,...SAFE_APPS.map(app=>({route:"/apps/"+app.id,title:app.title+" · Preview"}))]){const option=el("option","",item.title);option.value=item.route;navSelect.append(option)}
navSelect.addEventListener("change",()=>{const app=SAFE_APPS.find(app=>"/apps/"+app.id===navSelect.value);nav(navSelect.value,app?{project:app.project}:{} )});
openButton?.setAttribute("aria-label","Open in MSO");
if(openDirect&&openFeedback)document.querySelector(".page-feedback").append(openDirect,openFeedback);
applyHostGlobals();if(!readOutput())render();initializeMcpPage();
`;
}

// Compatibility snapshot for tests/consumers that import the historical constant.
// The canonical Page resource calls msoSurfaceScript() so registry changes are live.
export const MSO_SURFACE_SCRIPT = msoSurfaceScript();
