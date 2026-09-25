/** One native Google panel is used by the manager and the embedded connection catalogue. */
export const GOOGLE_CONNECTION_UI_SCRIPT = String.raw`
function mountNativeGoogleConnection(card,c,ctx){
  const{n,b,user,provider,snapshot,bridge,status,reload,selectProvider}=ctx;
  const info=c.google||{},apps=snapshot.connections.filter(row=>row.provider==="google-oauth-app"&&!row.sharedFrom),choice=n("select"),label=n("label","Google OAuth app"),empty=n("option","Choose an app…");empty.value="";choice.append(empty);
  for(const app of apps){const option=n("option",app.label+" · "+app.id);option.value=app.id;choice.append(option)}choice.value=info.appConnection||"";label.append(choice);
  const note=n("p","Google user consent is separate from the OAuth app configuration. This connector reads data only; it cannot change properties or send Analytics events.","identity-muted");card.append(note);
  if(info.account?.email)card.append(n("p","Google account: "+info.account.email));
  if(info.requiredScope)card.append(n("small","Required permission: "+info.requiredScope));
  if(provider.callbackUrl){const callback=n("div",undefined,"identity-credential-status");callback.append(n("span","Register this exact redirect in Google Cloud"),n("small",provider.callbackUrl));card.append(callback)}
  else card.append(n("p","An installation owner must configure OS_PUBLIC_ORIGIN as the canonical HTTPS origin before authorization.","identity-muted"));
  const actions=n("div",undefined,"identity-actions"),linkBox=n("div");
  const fail=error=>{status.textContent=({google_app_setup_required:"Finish the Google OAuth app's private setup first.",google_app_required:"Choose a configured Google OAuth app owned by this same credential owner.",google_disconnect_before_app_change:"Disconnect this Google account before changing its OAuth app.",google_account_changed_disconnect_first:"Reconnect with the same Google account, or disconnect first to switch accounts.",google_reauthorization_required:"Google authorization expired or changed. Reconnect with Google.",google_required_scope_missing:"Google did not grant the required read-only permission. Reconnect and review the requested scope.",google_same_origin_required:"Open native MSO at its configured public HTTPS origin before connecting.",google_public_https_origin_required:"Configure this installation's public HTTPS origin before connecting.",connection_busy:"This connection is in use. Retry when the current operation finishes."}[error.code||error.message]||error.message||"Google operation failed.")};
  const run=async(operation,args={})=>{status.textContent="Working on the selected Google connection…";try{const result=await bridge.execute({user,provider:provider.id,connection:c.id,operation,arguments:args,confirm:true});await reload();return result}catch(error){fail(error)}};
  const bind=b("Use selected app",()=>run("google.bind",{appConnection:choice.value}));bind.disabled=!bridge.execute;card.append(label);actions.append(bind);
  const appSetup=b(apps.length?"Manage Google OAuth apps":"Set up Google OAuth app",()=>selectProvider(ctx.catalog.find(p=>p.id==="google-oauth-app")));actions.append(appSetup);
  if(bridge.googleAuthorize){
    const connect=b(info.account?"Reconnect with Google":"Connect with Google",async()=>{connect.disabled=true;status.textContent="Preparing private Google consent…";try{
      const flow=await bridge.googleAuthorize({user,provider:provider.id,connection:c.id}),url=new URL(flow.authorizationUrl);
      if(url.origin!=="https://accounts.google.com"||url.pathname!=="/o/oauth2/v2/auth")throw new Error("Invalid authorization response");
      linkBox.replaceChildren();const a=n("a","Continue to Google");a.href=url.href;a.target="_blank";a.rel="noopener noreferrer";linkBox.append(a,n("p","Complete consent in the new browser tab, then return and refresh. The link expires in ten minutes."));status.textContent="Authorization prepared, not connected yet.";
    }catch(error){fail(error)}finally{connect.disabled=false}});connect.disabled=!info.appConnection||!provider.callbackUrl;actions.append(connect);
  }else{
    const open=n("a","Open native MSO to authorize Google");if(provider.openPath){open.href=provider.openPath;open.target="_blank";open.rel="noopener noreferrer";if(bridge.openLink)open.addEventListener("click",event=>{event.preventDefault();bridge.openLink(provider.openPath)})}card.append(open,n("small","Google consent is completed in a top-level browser, never through an API key field or chat message."));
  }
  const verify=b("Verify API access",async()=>{const result=await run("verify");if(result)status.textContent=(result.ok?"Verified: ":"Status: ")+result.detail});verify.disabled=!bridge.execute;actions.append(verify,b("Refresh status",reload));
  const disconnect=b("Disconnect from MSO",async()=>{if(!window.confirm("Remove this Google authorization from MSO? This does not revoke the app in your Google account."))return;const result=await run("google.disconnect");if(result)status.textContent=result.detail});disconnect.disabled=!bridge.execute;actions.append(disconnect);
  card.append(actions,linkBox);
  const operations=n("details");operations.append(n("summary","Available read-only operations"));for(const op of provider.operations||[]){const row=n("div");row.append(n("small",op.name),n("p",op.description));operations.append(row)}card.append(operations);
  const more=n("details"),manage=n("div",undefined,"identity-actions");more.append(n("summary","Connection management"));
  if(bridge.manage){
    if(!c.isDefault)manage.append(b("Make default",async()=>{try{await bridge.manage({action:"connection.default",confirm:true,user,provider:provider.id,connection:c.id});await reload()}catch(error){fail(error)}}));
    manage.append(b("Delete connection",async()=>{if(!window.confirm("Delete this named Google connection and its local authorization?"))return;try{await bridge.manage({action:"connection.delete",confirm:true,user,provider:provider.id,connection:c.id});await reload()}catch(error){fail(error)}},"danger"));
  }
  more.append(manage,n("small","Google user authorizations are not shared or transferred to other owners. Each account requires explicit consent."));card.append(more);
}
`;
