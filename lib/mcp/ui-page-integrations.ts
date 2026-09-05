import { INTEGRATION_FORM_SCRIPT } from "@/lib/infra/setup-ui";
import { INFRA_PROVIDER_IDS } from "@/lib/infra/types";
import { MSO_ORIGIN } from "./ui-config";

/** Native secret form; shares the existing Page lifecycle without sending secrets to it. */
export const MSO_PAGE_INTEGRATIONS_SCRIPT = String.raw`
${INTEGRATION_FORM_SCRIPT}
const INTEGRATION_ENDPOINT=${JSON.stringify(MSO_ORIGIN + "/api/integrations/setup")};
const INTEGRATION_PROVIDERS=${JSON.stringify(INFRA_PROVIDER_IDS)};
let integrationAccess=null;
function captureIntegrationAccess(raw){
  const envelopes=[raw,raw&&raw._meta,raw&&raw.mcp_tool_result&&raw.mcp_tool_result._meta,raw&&raw.call_tool_result&&raw.call_tool_result._meta];
  for(const meta of envelopes){const access=meta&&meta.integrationSetup;if(access&&typeof access.token==="string"&&/^[A-Za-z0-9_-]{43}$/.test(access.token)&&access.endpoint===INTEGRATION_ENDPOINT){integrationAccess=access;return}}
}
async function openIntegrationReference(url){
  if(window.openai&&typeof window.openai.openExternal==="function")return window.openai.openExternal({href:url,redirectUrl:false});
  return rpcRequest("ui/open-link",{url});
}
function renderIntegrations(){
  if(current.setup){
    viewCleanup=mountIntegrationForm(body,current.setup,integrationAccess?{...integrationAccess,openLink:openIntegrationReference}:null)||(()=>{});
    return;
  }
  const root=el("div","integration");root.append(el("h2","","Integrations"),el("p","","Connect a service directly to MSO. Credentials stay outside the chat. Choose a service to open a ten-minute setup form."));
  const list=el("div","grid");
  for(const provider of INTEGRATION_PROVIDERS){
    const card=el("div","card");card.append(el("strong","",provider));
    for(const method of provider==="composio"?["project","organization"]:["direct"]){
      const b=button(provider==="composio"?method+" API key":"Connect",async()=>{
        b.disabled=true;
        try{const result=await rpcCall("integration_setup_open",{provider,method});if(!acceptPageResult(result)||!current.setup)throw new Error("Setup requires write permission and refreshed MSO tools.")}
        catch(error){showError(error)}
      });card.append(b);
    }
    list.append(card);
  }
  root.append(list);body.append(root);
}
`;
