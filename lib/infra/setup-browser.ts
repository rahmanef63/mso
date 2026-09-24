export const INTEGRATION_BROWSER_SCRIPT=String.raw`
(async()=>{
  const root=document.getElementById("setup"),endpoint=location.origin+"/api/integrations/setup",params=new URLSearchParams(location.search);let cleanup=()=>{},state={...(params.get("section")==="ai-providers"?{section:"ai-providers"}:{})},authController,wantsTransfer=params.get("transfer")==="1";
  const error=data=>{const e=new Error(data.error||"integration_operation_failed");e.code=data.error;return e};
  async function json(url,init){const r=await fetch(url,{credentials:"same-origin",cache:"no-store",referrerPolicy:"no-referrer",...init});const data=await r.json();if(!r.ok)throw error(data);return data}
  const post=(mode,input)=>json("/api/v1/integrations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode,...input})});
  function showForm(setup,token){cleanup();authController?.abort();cleanup=mountIntegrationForm(root,setup,{endpoint,token,onBack:loadManager})||(()=>{})}
  const transferBridge=back=>({back,request:body=>json("/api/v1/integrations/transfer",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),download:async body=>{const r=await fetch("/api/v1/integrations/transfer",{method:"POST",credentials:"same-origin",cache:"no-store",referrerPolicy:"no-referrer",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});if(!r.ok)throw error(await r.json());const disposition=r.headers.get("content-disposition")||"",match=/filename="([^"]+)"/.exec(disposition);return{blob:await r.blob(),filename:match?.[1]||"mso-credentials.txt"}}});
  function openTransfer(){
    cleanup();authController?.abort();wantsTransfer=true;
    cleanup=mountPortability(root,transferBridge(()=>{wantsTransfer=false;void loadManager()}));
  }
  function mountTransfer(target,onBack){let release=()=>{};release=mountPortability(target,transferBridge(()=>{release();onBack?.()}));return release}

  async function loadManager(){
    cleanup();authController?.abort();authController=new AbortController();
    let owner=false,authenticated=false,role=null;try{const auth=await json("/api/auth/me",{signal:authController.signal});owner=auth.role==="owner";authenticated=auth.authenticated===true;role=auth.role}catch{}
    const bridge={headingLevel:1,remember:s=>state=s,openLink:url=>window.open(url,"_blank","noopener,noreferrer")};
    if(owner){
      bridge.openTransfer=openTransfer;bridge.mountTransfer=mountTransfer;
      bridge.projectMcp=args=>json("/api/v1/project-mcp",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(args)});
      bridge.query=args=>json("/api/v1/integrations?"+new URLSearchParams(args));
      bridge.manage=args=>post("manage",args);bridge.execute=args=>post("execute",args);
      bridge.aiConfig=()=>json("/api/config");bridge.aiCatalog=()=>json("/api/models/providers");bridge.aiModels=provider=>json("/api/models?provider="+encodeURIComponent(provider));
      bridge.aiSave=body=>json("/api/config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});bridge.aiRemove=provider=>json("/api/config?provider="+encodeURIComponent(provider),{method:"DELETE"});
      bridge.aiTest=()=>json("/api/models/test",{method:"POST"});bridge.aiOauth=body=>json("/api/oauth/openai",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      bridge.openSetup=async args=>{const data=await json("/api/v1/infra/setup",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(args)});showForm(data.setup,data.token)};
    }
    if(owner&&wantsTransfer){openTransfer();return}
    cleanup=mountConnectionManager(root,INTEGRATIONS_CATALOG,bridge,state);
    if(!owner&&authenticated)root.prepend(integrationNode("p","This device has "+role+" access. An Owner must approve Owner access before it can manage integrations."));
    if(!owner&&!authenticated){const link=integrationNode("a","Sign in to MSO as Owner");link.href="/login?returnTo=%2Fintegrations";link.className="primary integration-signin";link.target="_blank";link.rel="noopener noreferrer";root.prepend(link);const refresh=()=>{if(document.visibilityState!=="hidden")void loadManager()};document.addEventListener("visibilitychange",refresh,{signal:authController.signal});window.addEventListener("focus",refresh,{signal:authController.signal});}
  }
  window.addEventListener("pagehide",()=>{cleanup();authController?.abort()},{once:true});
  let token=location.hash.slice(1);history.replaceState(null,"",location.pathname);
  if(token){try{const data=await json(endpoint,{method:"POST",credentials:"omit",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({action:"schema"})});showForm(data,token);token="";return}catch{token=""}}
  await loadManager();
})();
`;
