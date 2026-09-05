import { INTEGRATION_FORM_SCRIPT } from "@/lib/infra/setup-ui";
import { INTEGRATION_PICKER_SCRIPT } from "@/lib/infra/setup-picker";
import { integrationCatalog } from "@/lib/infra/setup-catalog";
import { MSO_ORIGIN } from "./ui-config";
export const MSO_PAGE_INTEGRATIONS_SCRIPT = String.raw`
${INTEGRATION_FORM_SCRIPT}
${INTEGRATION_PICKER_SCRIPT}
const INTEGRATION_ENDPOINT=${JSON.stringify(MSO_ORIGIN + "/api/integrations/setup")};
const INTEGRATION_BROWSER=${JSON.stringify(MSO_ORIGIN + "/integrations")};
const INTEGRATION_CATALOG=${JSON.stringify(integrationCatalog()).replace(/</g,"\\u003c")};
let integrationAccess=null;
function captureIntegrationAccess(raw,depth=0){
  if(!raw||typeof raw!=="object"||depth>4)return;
  const access=raw.integrationSetup;
  if(access&&typeof access.token==="string"&&/^[A-Za-z0-9_-]{43}$/.test(access.token)&&access.endpoint===INTEGRATION_ENDPOINT){integrationAccess=access;return}
  for(const key of ["_meta","mcp_tool_result","call_tool_result","result"])if(raw[key])captureIntegrationAccess(raw[key],depth+1);
}
async function openIntegrationReference(url){
  if(hostConnected)return rpcRequest("ui/open-link",{url});
  if(window.openai&&typeof window.openai.openExternal==="function")return window.openai.openExternal({href:url,redirectUrl:false});
  return rpcRequest("ui/open-link",{url});
}
function renderIntegrations(){
  const onBack=()=>{integrationAccess=null;lastOutputKey="";current={route:"/integrations",kind:"integrations",title:"Integrations",openPath:"/integrations",catalog:[]};render()};
  const openBrowser=()=>openIntegrationReference(INTEGRATION_BROWSER);
  if(current.setup){
    captureIntegrationAccess(window.openai&&window.openai.toolResponseMetadata);
    viewCleanup=mountIntegrationForm(body,current.setup,{...(integrationAccess||{}),openLink:openIntegrationReference,onBack,openBrowser})||(()=>{});return;
  }
  viewCleanup=mountIntegrationPicker(body,INTEGRATION_CATALOG,{
    openBrowser,openLink:openIntegrationReference,
    openSetup:async(provider,method)=>{
      const result=await rpcCall("integration_setup_open",{provider,method});
      captureIntegrationAccess(result);captureIntegrationAccess(window.openai&&window.openai.toolResponseMetadata);
      if(!acceptPageResult(result)||!current.setup)throw new Error("The connector could not open the secure form. Use Open in browser, or refresh the MSO connector to load the new setup action.");
    }
  });
}
`;
