export const INTEGRATION_BROWSER_SCRIPT=String.raw`
(async()=>{
  const root=document.getElementById("setup"),endpoint=location.origin+"/api/integrations/setup";let cleanup=()=>{},state={},authController,wantsTransfer=new URLSearchParams(location.search).get("transfer")==="1";
  const error=data=>{const e=new Error(data.error||"integration_operation_failed");e.code=data.error;return e};
  async function json(url,init){const r=await fetch(url,{credentials:"same-origin",cache:"no-store",referrerPolicy:"no-referrer",...init});const data=await r.json();if(!r.ok)throw error(data);return data}
  const post=(mode,input)=>json("/api/v1/integrations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode,...input})});
  function showForm(setup,token){cleanup();authController?.abort();cleanup=mountIntegrationForm(root,setup,{endpoint,token,onBack:loadManager})||(()=>{})}
  function openTransfer(){
    cleanup();authController?.abort();wantsTransfer=true;
    cleanup=mountPortability(root,{back:()=>{wantsTransfer=false;void loadManager()},request:body=>json("/api/v1/integrations/transfer",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})});
  }
  async function loadManager(){
    cleanup();authController?.abort();authController=new AbortController();
    let owner=false;try{const auth=await json("/api/auth/me",{signal:authController.signal});owner=auth.role==="owner"}catch{}
    const bridge={remember:s=>state=s,openLink:url=>window.open(url,"_blank","noopener,noreferrer")};
    if(owner){
      bridge.openTransfer=openTransfer;
      bridge.query=args=>json("/api/v1/integrations?"+new URLSearchParams(args));
      bridge.manage=args=>post("manage",args);bridge.execute=args=>post("execute",args);
      bridge.openSetup=async args=>{const data=await json("/api/v1/infra/setup",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(args)});showForm(data.setup,data.token)};
    }
    if(owner&&wantsTransfer){openTransfer();return}
    cleanup=mountConnectionManager(root,INTEGRATIONS_CATALOG,bridge,state);
    if(!owner){const link=integrationNode("a","Sign in to MSO as Owner");link.href="/";link.target="_blank";link.rel="noopener noreferrer";root.prepend(link);const refresh=()=>{if(document.visibilityState!=="hidden")void loadManager()};document.addEventListener("visibilitychange",refresh,{signal:authController.signal});window.addEventListener("focus",refresh,{signal:authController.signal});}
  }
  window.addEventListener("pagehide",()=>{cleanup();authController?.abort()},{once:true});
  let token=location.hash.slice(1);history.replaceState(null,"",location.pathname);
  if(token){try{const data=await json(endpoint,{method:"POST",credentials:"omit",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({action:"schema"})});showForm(data,token);token="";return}catch{token=""}}
  await loadManager();
})();
`;
