import { listInfraProviderDefinitions } from "./catalog";
import { setupGuidance } from "./setup-guidance";

export function setupCatalog() {
  return listInfraProviderDefinitions().map(p => ({
    id: p.id, title: p.title, description: p.description,
    methods: (p.id === "composio" ? ["project", "organization"] as const : ["direct"] as const).map(id => ({
      id, title: id === "direct" ? "API token" : `${id === "project" ? "Project" : "Organization"} API key`,
      guidance: setupGuidance(p.id, id),
    })),
  }));
}
export const SETUP_HUB_STYLE = String.raw`
[hidden]{display:none!important}.integration{width:100%;min-width:0}.integration .hub-heading{display:flex;gap:16px;align-items:start;justify-content:space-between;flex-wrap:wrap}.integration .hub-layout{display:grid;grid-template-columns:minmax(180px,.75fr) minmax(0,1.8fr);gap:24px;margin-top:24px}.integration .hub-sidebar{display:grid;gap:8px;align-content:start}.integration .hub-provider{display:block;width:100%;text-align:left;font:inherit;border:1px solid var(--sep-strong);border-radius:12px;padding:12px;background:var(--field);color:var(--text);cursor:pointer}.integration .hub-provider[aria-pressed=true]{border-color:var(--os-accent);box-shadow:inset 3px 0 0 var(--os-accent)}.integration .hub-provider span{display:block;font-size:12px;color:var(--text-dim);margin-top:2px}.integration .hub-panel{min-width:0;padding:20px;border:1px solid var(--sep-strong);border-radius:16px;background:var(--field)}.integration .hub-auth{border:1px solid var(--sep-strong);border-radius:12px;padding:14px;margin:16px 0}.integration .hub-status{font-size:13px;min-height:24px}.integration .hub-search{margin-bottom:8px}.integration .hub-provider strong{font-size:14px}.integration .setup-tag{margin:0 0 12px}.integration .hub-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.integration .hub-actions a{display:inline-flex;align-items:center;min-height:42px}.integration .hub-panel h3{margin:0 0 8px;font-size:20px}.integration .grid{grid-template-columns:repeat(2,minmax(0,1fr))}.integration .card strong{font-size:16px}.integration .card p{font-size:13px}.integration .hub-help{font-size:12px}.integration button:focus-visible,.integration a:focus-visible{outline:2px solid var(--os-accent);outline-offset:3px}@media(max-width:620px){.integration .grid{grid-template-columns:1fr}.integration .hub-layout{grid-template-columns:1fr;gap:16px}.integration .hub-sidebar{grid-template-columns:1fr 1fr}.integration .hub-search{grid-column:1/-1}.integration .hub-panel{padding:16px}.integration .hub-provider{padding:10px}}`;

/** Display data only. Authentication is checked before presenting a usable Save path. */
export const SETUP_HUB_SCRIPT = String.raw`
function mountIntegrationHub(root,catalog){
  let userState={authenticated:false,role:null},selected=catalog.find(p=>p.id===new URLSearchParams(location.search).get("provider"))||catalog[0],busy=false,disposed=false;
  const endpoint=location.origin+"/api/integrations/setup";
  const n=integrationNode;root.replaceChildren();
  const head=n("div"),intro=n("div");head.className="hub-heading";intro.append(n("h2","Integrations"),n("p","Connect your services to MSO. Choose a provider, follow its guide, then enter the credential securely."));head.append(intro);root.append(head);
  const auth=n("div"),authText=n("p","Checking sign-in…"),authActions=n("div"),login=n("a","Sign in to MSO"),refresh=n("button","Check sign-in again");auth.className="hub-auth";authText.setAttribute("role","status");authActions.className="hub-actions";login.href="/";login.target="_blank";login.rel="noopener noreferrer";refresh.type="button";authActions.append(login,refresh);auth.append(authText,authActions);root.append(auth);
  const layout=n("div"),sidebar=n("nav"),panel=n("section"),search=n("input");layout.className="hub-layout";sidebar.className="hub-sidebar";sidebar.setAttribute("aria-label","Providers");panel.className="hub-panel";search.type="search";search.placeholder="Find a provider";search.setAttribute("aria-label","Find a provider");search.className="hub-search";sidebar.append(search);layout.append(sidebar,panel);root.append(layout);
  const buttons=[];
  for(const provider of catalog){const b=n("button"),title=n("strong",provider.title);b.type="button";b.className="hub-provider";b.append(title,n("span",provider.methods.length>1?"Choose key type":"Direct connection"));b.onclick=()=>{if(!busy){selected=provider;renderPanel()}};sidebar.append(b);buttons.push({provider,b})}
  search.oninput=()=>{for(const {provider,b} of buttons)b.hidden=!provider.title.toLowerCase().includes(search.value.toLowerCase())};
  function renderPanel(){
    if(disposed)return;panel.replaceChildren();for(const {provider,b} of buttons)b.setAttribute("aria-pressed",String(provider.id===selected.id));
    panel.append(n("h3",selected.title),n("p",selected.description));
    const label=n("label","Authentication method"),method=n("select");method.id="setup-method";label.htmlFor=method.id;
    for(const m of selected.methods){const option=n("option",m.title);option.value=m.id;method.append(option)}
    const desired=new URLSearchParams(location.search).get("method");if(selected.methods.some(m=>m.id===desired))method.value=desired;
    panel.append(label,method);
    const guide=n("details"),guideBody=n("div"),summary=n("summary","How to get this credential");guide.open=true;guide.append(summary,guideBody);panel.append(guide);
    function renderGuide(){guideBody.replaceChildren();const g=selected.methods.find(m=>m.id===method.value).guidance;for(const [url,text] of [[g.url,"Provider dashboard"],[g.reference,"Official documentation"]]){const a=n("a",text);a.href=url;a.target="_blank";a.rel="noopener noreferrer";const p=n("p");p.append(a);guideBody.append(p)}const list=n("ol");for(const step of g.steps)list.append(n("li",step));guideBody.append(list)}method.onchange=renderGuide;renderGuide();
    const actions=n("div"),start=n("button","Open secure form"),status=n("p");actions.className="hub-actions";start.type="button";start.className="primary";start.disabled=userState.role!=="owner";status.className="hub-status";status.setAttribute("role","status");status.textContent=userState.role==="owner"?"Ready. Existing keys stay hidden and are kept until validation succeeds.":"Read the guide now. Sign in with an approved Owner device to enter or change credentials.";actions.append(start);panel.append(actions,status,n("p","A form expires after ten minutes. MSO never asks you to put a key in chat."));
    start.onclick=async()=>{if(busy||start.disabled)return;busy=true;start.disabled=true;status.textContent="Opening your secure form…";try{const r=await fetch("/api/v1/infra/setup",{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({provider:selected.id,method:method.value}),signal:AbortSignal.timeout(15000)});const data=await r.json();if(!r.ok){if(r.status===403){await refreshAuth();throw new Error("Your Owner session is no longer available. Sign in again.")}throw new Error("Setup is temporarily unavailable. Retry without changing your existing credentials.")}disposed=true;removeListeners();const back=n("button","← All integrations");back.type="button";const host=n("div"),formRoot=n("div");root.replaceChildren(back,host);host.append(formRoot);let cleanup=mountIntegrationForm(formRoot,data.setup,{endpoint,token:data.token});back.onclick=()=>{cleanup?.();mountIntegrationHub(root,catalog)}}catch(e){status.textContent=e.message;start.disabled=userState.role!=="owner"}finally{busy=false}};
  }
  async function refreshAuth(){if(disposed)return;refresh.disabled=true;try{const r=await fetch("/api/auth/me",{cache:"no-store",credentials:"same-origin",signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error();userState=await r.json();authText.textContent=userState.role==="owner"?"Owner session ready. Your credentials are stored only on this MSO server.":userState.authenticated?"You are signed in, but credential changes require an approved Owner device.":"You are not signed in. Open MSO sign-in, then return to this page.";login.hidden=userState.role==="owner";renderPanel()}catch{authText.textContent="Cannot reach MSO. Check your connection, then retry."}finally{refresh.disabled=false}}
  function visible(){if(document.visibilityState==="visible")refreshAuth()}function removeListeners(){window.removeEventListener("focus",refreshAuth);document.removeEventListener("visibilitychange",visible)}
  refresh.onclick=refreshAuth;window.addEventListener("focus",refreshAuth);document.addEventListener("visibilitychange",visible);renderPanel();refreshAuth();
}
`;
