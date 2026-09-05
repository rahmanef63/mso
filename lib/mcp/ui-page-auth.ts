// Login leaves the nested app through an explicit host-side button, not an iframe redirect.
export const MSO_PAGE_AUTH_SCRIPT = String.raw`
function mountReviewedAuth(safe,frame,status,message){
  const path=safe.externalAuthPath;
  if(typeof path!=="string"||!path.startsWith("/")||path.startsWith("//"))return()=>{};
  const target=new URL(path,safe.origin);
  if(target.origin!==safe.origin||target.username||target.password)return()=>{};
  const action=button("Google login in browser",async()=>{
    action.disabled=true;
    try{
      if(hostConnected)await rpcRequest("ui/open-link",{url:target.href});
      else if(window.openai&&typeof window.openai.openExternal==="function")await window.openai.openExternal({href:target.href});
      else throw new Error("Host navigation unavailable");
      message.textContent="Complete Google sign-in in the browser tab and continue playing there. Preview sessions are separate.";
    }catch(_){message.textContent="Use Open production to continue Google sign-in in your browser."}
    finally{action.disabled=false}
  });
  status.append(action);
  function requested(event){
    if(event.source!==frame.contentWindow||event.origin!==safe.origin)return;
    const data=event.data;
    if(data?.type!=="mso:app-auth-request"||data.schemaVersion!==1||data.provider!=="google")return;
    message.textContent="Click Google login in browser above to continue securely outside this preview.";
    action.focus();
  }
  window.addEventListener("message",requested);
  return()=>window.removeEventListener("message",requested);
}
`;
