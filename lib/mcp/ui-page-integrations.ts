import { INTEGRATION_FORM_SCRIPT } from "@/lib/infra/setup-ui";
import { CONNECTION_MANAGER_SCRIPT } from "@/lib/infra/connection-ui";
import { connectionCatalog } from "@/lib/infra/connection-registry";
import { MSO_ORIGIN } from "./ui-config";
export const MSO_PAGE_INTEGRATIONS_SCRIPT=String.raw`
${INTEGRATION_FORM_SCRIPT}
${CONNECTION_MANAGER_SCRIPT}
const INTEGRATION_ENDPOINT=${JSON.stringify(MSO_ORIGIN+"/api/integrations/setup")};
const INTEGRATION_BROWSER=${JSON.stringify(MSO_ORIGIN+"/integrations")};
const INTEGRATION_CATALOG=${JSON.stringify(connectionCatalog()).replace(/</g,"\\u003c")};
let integrationAccess=null,integrationSelection={};
function privateIntegrationMeta(raw,key,depth=0){if(!raw||typeof raw!=="object"||depth>5)return null;if(raw[key])return raw[key];for(const k of ["_meta","result","mcp_tool_result","call_tool_result"]){const found=privateIntegrationMeta(raw[k],key,depth+1);if(found)return found}return null}
function captureIntegrationAccess(raw){const access=privateIntegrationMeta(raw,"integrationSetup");if(access&&/^[A-Za-z0-9_-]{43}$/.test(access.token)&&access.endpoint===INTEGRATION_ENDPOINT)integrationAccess=access}
function openIntegrationReference(url){if(hostConnected)return rpcRequest("ui/open-link",{url});if(window.openai?.openExternal)return window.openai.openExternal({href:url,redirectUrl:false});return rpcRequest("ui/open-link",{url})}
async function integrationTool(name,args){
  const response=await rpcCall(name,args);if(response?.isError||response?.error){const e=new Error("Integration action unavailable or rejected. Check permissions, or refresh the MSO connector's tools.");throw e}
  const out=unbox(response);return{response,data:out?.result??out};
}
function renderIntegrations(){
  const back=()=>{integrationAccess=null;lastOutputKey="";current={route:"/integrations",kind:"integrations",title:"Integrations",openPath:"/integrations",catalog:[]};render()};
  if(current.setup){captureIntegrationAccess(window.openai?.toolResponseMetadata);viewCleanup=mountIntegrationForm(body,current.setup,{...(integrationAccess||{}),onBack:back,openLink:openIntegrationReference,openBrowser:()=>openIntegrationReference(INTEGRATION_BROWSER)})||(()=>{});return}
  const bridge={remember:s=>integrationSelection=s,openLink:openIntegrationReference,
    query:async args=>(await integrationTool("integration_query",args)).data,
    manage:async args=>{const{response,data}=await integrationTool("integration_manage",args);const meta=privateIntegrationMeta(response,"integrationAuthorization")||privateIntegrationMeta(window.openai?.toolResponseMetadata,"integrationAuthorization");return{...data,...(meta?.url?{privateUrl:meta.url}:{})}},
    execute:async args=>(await integrationTool("integration_execute",args)).data,
    openSetup:async args=>{const{response}=await integrationTool("integration_setup_open",args);captureIntegrationAccess(response);captureIntegrationAccess(window.openai?.toolResponseMetadata);if(!acceptPageResult(response))throw new Error("The host did not return a valid setup Page. Use Open in MSO or refresh this connector.")},
  };
  viewCleanup=mountConnectionManager(body,INTEGRATION_CATALOG,bridge,{...integrationSelection,snapshot:current.integrations});
}
`;
