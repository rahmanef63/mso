// Configured iframe apps are bounded by an exact reviewed origin/start path.
// Readiness is UX only: browser load/error updates the status; CSP/origin checks
// remain the security boundary and do not depend on an app-specific message.
export const MSO_PAGE_FRAME_SCRIPT = String.raw`
function mountReviewedFrame(safe,stage){
  const wrap=el("div","frame-wrap"),frame=document.createElement("iframe");
  const status=el("div","frame-status"),message=el("span","","Connecting to configured app…");
  status.setAttribute("role","status");status.setAttribute("aria-live","polite");
  const retry=button("Retry preview",()=>loadFrame());retry.hidden=true;
  const external=button("Open app ↗",()=>openProduction());
  status.append(message,retry,external);stage.content.append(status,wrap);
  frame.title=safe.title+" app";frame.setAttribute("sandbox",safe.sandbox);
  frame.referrerPolicy="no-referrer";frame.allow="fullscreen; autoplay; gamepad; accelerometer; gyroscope";
  wrap.append(frame);let timer=0,disposed=false;
  const clearAuth=mountReviewedAuth(safe,frame,status,message);
  function unavailable(){if(disposed)return;wrap.dataset.state="unavailable";message.textContent="Preview did not load. Retry or open the app directly.";retry.hidden=false}
  function loaded(){if(disposed)return;clearTimeout(timer);wrap.dataset.state="ready";message.textContent="App loaded";retry.hidden=true}
  function loadFrame(){clearTimeout(timer);wrap.dataset.state="loading";message.textContent="Connecting to configured app…";retry.hidden=true;frame.src=safe.url;timer=setTimeout(unavailable,12000)}
  async function openProduction(){
    try{
      if(hostConnected)await rpcRequest("ui/open-link",{url:safe.origin});
      else if(window.openai&&typeof window.openai.openExternal==="function")await window.openai.openExternal({href:safe.origin});
      else throw new Error("Host external navigation is unavailable");
    }catch(_){message.textContent="Open app in your browser: "+safe.origin}
  }
  frame.addEventListener("load",loaded);frame.addEventListener("error",unavailable);
  viewCleanup=()=>{clearAuth();disposed=true;clearTimeout(timer);frame.removeEventListener("load",loaded);frame.removeEventListener("error",unavailable)};
  loadFrame();
}
`;
