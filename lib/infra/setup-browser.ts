export const INTEGRATION_BROWSER_SCRIPT = String.raw`
(async()=>{
  const root=document.getElementById("setup"),endpoint=location.origin+"/api/integrations/setup";
  let teardown=()=>{};
  window.addEventListener("pagehide",()=>teardown(),{once:true});
  const preset=new URLSearchParams(location.search);
  function form(setup,token){teardown();teardown=mountIntegrationForm(root,setup,{endpoint,token,onBack:picker})||(()=>{})}
  function picker(){
    teardown();
    const session={loading:true,authenticated:false,role:null};let disposed=false;const abort=new AbortController();
    async function refreshAuth(){
      if(disposed)return;
      try{
        const response=await fetch("/api/auth/me",{credentials:"same-origin",cache:"no-store",signal:AbortSignal.any([abort.signal,AbortSignal.timeout(8000)])});
        if(!response.ok)throw new Error("unavailable");
        const data=await response.json();session.authenticated=data.authenticated===true;session.role=data.role;
      }catch{session.authenticated=false;session.role=null}
      if(disposed)return;session.loading=false;
      const label=root.querySelector("#integration-auth-status");
      if(label)label.textContent=session.role==="owner"?"Owner session ready. Credentials are never displayed.":session.authenticated?"This device is not an Owner. Use an approved Owner session to change credentials.":"Sign in to MSO as an owner to open a private form. The catalog and guidance remain available.";
      for(const b of root.querySelectorAll("[data-integration-start]"))b.disabled=session.role!=="owner";
    }
    const visible=()=>{if(document.visibilityState!=="hidden")void refreshAuth()};
    const disposePicker=mountIntegrationPicker(root,INTEGRATIONS_CATALOG,{
      provider:preset.get("provider"),method:preset.get("method"),session,
      browserLabel:"MSO sign-in",
      openBrowser:()=>{window.open(location.origin+"/","_blank","noopener,noreferrer")},
      openSetup:async(provider,method)=>{
        const response=await fetch("/api/v1/infra/setup",{method:"POST",credentials:"same-origin",cache:"no-store",referrerPolicy:"no-referrer",headers:{"Content-Type":"application/json"},body:JSON.stringify({provider,method}),signal:AbortSignal.timeout(15000)});
        if(response.status===401||response.status===403){await refreshAuth();throw new Error("Your Owner session is no longer available. Sign in using MSO sign-in, then return here.")}
        if(!response.ok)throw new Error("Setup is temporarily unavailable. Check the selected method and retry.");
        const data=await response.json();if(!data.setup||!data.token)throw new Error("Incomplete setup response. Reload this page.");form(data.setup,data.token);
      }
    });
    document.addEventListener("visibilitychange",visible);window.addEventListener("focus",visible);
    teardown=()=>{disposed=true;abort.abort();document.removeEventListener("visibilitychange",visible);window.removeEventListener("focus",visible);disposePicker()};
    void refreshAuth();
  }
  let token=location.hash.slice(1);history.replaceState(null,"",location.pathname+location.search);
  if(token){
    try{const response=await fetch(endpoint,{method:"POST",credentials:"omit",cache:"no-store",referrerPolicy:"no-referrer",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({action:"schema"}),signal:AbortSignal.timeout(12000)});if(!response.ok)throw new Error("This private form has expired or was already used. Open a new setup session below.");form(await response.json(),token);token="";return}
    catch(error){picker();const note=integrationNode("p",error.message);note.className="picker-note";root.prepend(note);token="";return}
  }
  picker();
})();
`;
