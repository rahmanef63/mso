// A reviewed app must acknowledge readiness; iframe load alone also fires for blocked pages.
export const MSO_PAGE_FRAME_SCRIPT = String.raw`
function mountReviewedFrame(safe,stage){
  const wrap=el("div","frame-wrap"),frame=document.createElement("iframe");
  const status=el("div","frame-status"),message=el("span","","Connecting to live production…");
  status.setAttribute("role","status");status.setAttribute("aria-live","polite");
  const retry=button("Retry preview",()=>loadFrame());retry.hidden=true;
  const external=button("Open production ↗",()=>openProduction());
  status.append(message,retry,external);stage.content.append(status,wrap);
  frame.title=safe.title+" live demo";frame.setAttribute("sandbox",safe.sandbox);
  frame.referrerPolicy="no-referrer";frame.allow="fullscreen; autoplay; gamepad; accelerometer; gyroscope";
  wrap.append(frame);let timer=0,disposed=false;
  function unavailable(){if(disposed)return;wrap.dataset.state="unavailable";message.textContent="Preview did not confirm readiness. Retry or open production directly.";retry.hidden=false}
  function loadFrame(){clearTimeout(timer);wrap.dataset.state="loading";message.textContent="Connecting to live production…";retry.hidden=true;frame.src=safe.url;timer=setTimeout(unavailable,12000)}
  function ready(event){
    if(event.source!==frame.contentWindow||event.origin!==safe.origin)return;
    const data=event.data;if(!data||data.type!=="play-together:embed-ready"||data.schemaVersion!==1)return;
    clearTimeout(timer);wrap.dataset.state="ready";message.textContent="Production app ready";retry.hidden=true;
  }
  async function openProduction(){
    try{
      if(hostConnected)await rpcRequest("ui/open-link",{url:safe.origin});
      else if(window.openai&&typeof window.openai.openExternal==="function")await window.openai.openExternal({href:safe.origin});
      else throw new Error("Host external navigation is unavailable");
    }catch(_){message.textContent="Open production in your browser: "+safe.origin}
  }
  window.addEventListener("message",ready);frame.addEventListener("error",unavailable);
  viewCleanup=()=>{disposed=true;clearTimeout(timer);window.removeEventListener("message",ready);frame.removeEventListener("error",unavailable)};
  loadFrame();
}
`;
