import { INTEGRATION_FORM_SCRIPT } from "@/lib/infra/setup-ui";
import { setupCatalog } from "@/lib/infra/setup-hub";
import { MSO_ORIGIN } from "./ui-config";

export const MSO_PAGE_INTEGRATIONS_SCRIPT = String.raw`
${INTEGRATION_FORM_SCRIPT}
const INTEGRATION_ENDPOINT=${JSON.stringify(MSO_ORIGIN + "/api/integrations/setup")};
const INTEGRATION_BROWSER=${JSON.stringify(MSO_ORIGIN + "/integrations")};
const INTEGRATION_CATALOG=${JSON.stringify(setupCatalog()).replace(/</g, "\\u003c")};
let integrationAccess=null;
function captureIntegrationAccess(raw){
  const envelopes=[raw,raw&&raw._meta,raw&&raw.mcp_tool_result&&raw.mcp_tool_result._meta,raw&&raw.call_tool_result&&raw.call_tool_result._meta,raw&&raw.result&&raw.result._meta];
  for(const meta of envelopes){const access=meta&&meta.integrationSetup;if(access&&typeof access.token==="string"&&/^[A-Za-z0-9_-]{43}$/.test(access.token)&&access.endpoint===INTEGRATION_ENDPOINT){integrationAccess=access;return}}
}
async function openIntegrationReference(url){
  if(window.openai&&typeof window.openai.openExternal==="function")return window.openai.openExternal({href:url,redirectUrl:false});
  return rpcRequest("ui/open-link",{url});
}
function integrationLink(url,label,feedback){
  const a=el("a","button",label);a.href=url;a.target="_blank";a.rel="noopener noreferrer";
  a.addEventListener("click",event=>{event.preventDefault();openIntegrationReference(url).catch(()=>{feedback.textContent="The host could not open the browser. Copy this public address: "+url})});return a;
}
function renderIntegrations(){
  if(current.setup&&integrationAccess){viewCleanup=mountIntegrationForm(body,current.setup,{...integrationAccess,openLink:openIntegrationReference})||(()=>{});return;}
  const root=el("div","integration"),feedback=el("p","setup-status");feedback.setAttribute("role","status");
  root.append(el("h2","","Integrations"),el("p","","Choose a provider below. Browser setup works independently of whether this chat has refreshed its tool catalog."));
  const external=el("div","setup-actions");external.append(integrationLink(INTEGRATION_BROWSER,"Open secure setup in browser",feedback));root.append(external,el("p","mono",INTEGRATION_BROWSER));
  if(current.setup&&!integrationAccess)feedback.textContent="The chat host did not deliver the private setup authorization. No key input is shown here. Use the secure browser page or refresh the MSO connection.";
  const list=el("div","grid");
  for(const provider of INTEGRATION_CATALOG){
    const card=el("div","card");card.append(el("strong","",provider.title),el("p","",provider.description));
    for(const method of provider.methods){
      const details=el("details"),summary=el("summary","",method.title),steps=el("ol");details.append(summary);
      for(const step of method.guidance.steps)steps.append(el("li","",step));details.append(steps,integrationLink(method.guidance.url,"Provider dashboard",feedback),integrationLink(method.guidance.reference,"Official documentation",feedback));
      const browserUrl=INTEGRATION_BROWSER+"?provider="+encodeURIComponent(provider.id)+"&method="+encodeURIComponent(method.id);
      const b=button("Set up in chat",async()=>{b.disabled=true;feedback.textContent="Opening secure form…";try{const result=await rpcCall("integration_setup_open",{provider:provider.id,method:method.id});captureIntegrationAccess(result);captureIntegrationAccess(window.openai&&window.openai.toolResponseMetadata);if(result?.isError||!unbox(result)?.setup)throw new Error("setup tool unavailable");if(!acceptPageResult(result))throw new Error("missing setup data")}catch{feedback.textContent="This chat could not open the setup tool. Refresh the MSO connection to load its new tools, or use Open in browser. Your credentials have not changed.";b.disabled=false}},"primary");
      const actions=el("div","setup-actions");actions.append(b,integrationLink(browserUrl,"Open in browser",feedback));details.append(actions);card.append(details);
    }
    list.append(card);
  }
  root.append(feedback,list);body.append(root);
}
`;
