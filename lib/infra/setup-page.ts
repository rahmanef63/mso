import { randomBytes } from "node:crypto";
import { MSO_WIDGET_TOKENS } from "@/lib/presentation/widget-tokens";
import { INTEGRATION_FORM_SCRIPT, INTEGRATION_FORM_STYLE } from "./setup-ui";

export function integrationSetupPage() {
  const nonce = randomBytes(18).toString("base64");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>MSO Integrations</title><style nonce="${nonce}">${MSO_WIDGET_TOKENS}${INTEGRATION_FORM_STYLE}*{box-sizing:border-box}body{margin:0;background:var(--surface);padding:clamp(18px,4vw,50px);font-family:var(--font-body);color:var(--text)}header{max-width:850px;margin:0 auto 28px;font-size:13px}button{border:1px solid var(--sep-strong);border-radius:10px;background:var(--field);color:var(--text);padding:9px 15px;cursor:pointer}select{margin:8px 0 16px}a{color:var(--os-accent)}</style></head><body><header>MSO / Integrations · Secure setup</header><main id="setup" class="integration"></main><script nonce="${nonce}">${INTEGRATION_FORM_SCRIPT}
(async()=>{
const root=document.getElementById("setup"),endpoint=location.origin+"/api/integrations/setup";
let token=location.hash.slice(1);history.replaceState(null,"",location.pathname);
if(token){try{const response=await fetch(endpoint,{method:"POST",credentials:"omit",cache:"no-store",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({action:"schema"})});if(!response.ok)throw new Error("Setup expired or unavailable. Open a new session.");mountIntegrationForm(root,await response.json(),{endpoint,token});token="";return}catch(error){root.append(integrationNode("p",error.message));return}}
root.append(integrationNode("h2","Connect a service"),integrationNode("p","Sign in to MSO as an owner, then start a temporary credential form. No extra plugin is required."));
const label=integrationNode("label","Provider"),select=integrationNode("select");select.id="provider";label.htmlFor=select.id;for(const name of ["composio","dokploy","cloudflare","hostinger"]){const o=integrationNode("option",name[0].toUpperCase()+name.slice(1));o.value=name;select.append(o)}
const ml=integrationNode("label","Composio key type"),method=integrationNode("select");method.id="method";ml.htmlFor=method.id;for(const name of ["project","organization"]){const o=integrationNode("option",name+" API key");o.value=name;method.append(o)}select.addEventListener("change",()=>{method.hidden=ml.hidden=select.value!=="composio"});
const open=integrationNode("button","Start secure setup"),status=integrationNode("p"),login=integrationNode("a","Open MSO sign-in");login.href="/";login.target="_blank";login.rel="noopener noreferrer";open.type="button";
root.append(label,select,ml,method,open,status,login);open.addEventListener("click",async()=>{open.disabled=true;try{const response=await fetch("/api/v1/infra/setup",{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({provider:select.value,method:select.value==="composio"?method.value:"direct"})});if(!response.ok)throw new Error("Owner sign-in is required, or setup is temporarily unavailable.");const data=await response.json();mountIntegrationForm(root,data.setup,{endpoint,token:data.token})}catch(error){status.textContent=error.message;open.disabled=false}})
})();</script></body></html>`;
  return { html, csp: `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'` };
}
