// The same DOM-only form runs in a temporary browser page and in MSO Page.
// No input, capability, or provider response is sent through the MCP bridge.
export const INTEGRATION_FORM_STYLE = String.raw`
[hidden]{display:none!important}
.integration{max-width:850px;margin:auto;font:14px/1.55 var(--font-body);color:var(--text)}.integration h2{font:700 24px/1.25 var(--font-display);margin:0 0 8px}.integration p{color:var(--text-dim);margin:6px 0 14px}.integration .setup-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:20px}.integration label{display:block;font-weight:650;margin-bottom:5px}.integration input,.integration select{width:100%;min-width:0;border:1px solid var(--sep-strong);border-radius:9px;background:var(--field);color:var(--text);padding:10px 12px;font:16px var(--font-body)}.integration .input-row{display:flex;gap:6px}.integration .input-row input{flex:1;width:0}.integration button{font-size:13px;min-height:42px;white-space:normal}.integration .field{margin-bottom:18px;min-width:0}.integration small{display:block;margin-top:5px;color:var(--text-dim);overflow-wrap:anywhere}.integration details{border:1px solid var(--sep-strong);border-radius:12px;padding:14px;background:var(--field);margin:12px 0}.integration summary{cursor:pointer;font-weight:650}.integration li{margin:8px 0}.integration a{color:var(--os-accent);text-underline-offset:3px;overflow-wrap:anywhere}.integration .setup-status{min-height:28px;overflow-wrap:anywhere}.integration button:disabled{cursor:not-allowed;opacity:.55}.integration .setup-tag{display:inline-block;border:1px solid var(--sep-strong);border-radius:99px;padding:3px 10px;margin-bottom:12px;font-size:12px}.integration .setup-actions{display:flex;gap:8px;flex-wrap:wrap}.integration .primary{background:var(--text);color:var(--surface);border-color:var(--text)}@media(max-width:620px){.integration .setup-grid{grid-template-columns:1fr;gap:0}.integration h2{font-size:21px}}`;

export const INTEGRATION_FORM_SCRIPT = String.raw`
function integrationNode(tag,value){const n=document.createElement(tag);if(value!==undefined)n.textContent=value;return n}
function mountIntegrationForm(root,setup,access){
  root.replaceChildren();root.classList.add("integration");
  const token=access&&access.token,endpoint=access&&access.endpoint;
  const back=()=>{if(typeof access?.onBack==="function"){const b=integrationNode("button","← All integrations");b.type="button";b.className="back-link";b.addEventListener("click",access.onBack);root.append(b)}};back();
  if(!token||!endpoint){root.append(integrationNode("h2","Secure form unavailable"),integrationNode("p","The chat host did not deliver private setup authorization. Reopen the form or use the browser entrypoint; never paste a credential into chat."));if(access?.openBrowser){const b=integrationNode("button","Open Integrations in browser");b.type="button";b.addEventListener("click",()=>access.openBrowser());root.append(b)}return()=>{root.replaceChildren();root.classList.remove("integration")}}
  const heading=integrationNode("h2",setup.title+" connection"),tag=integrationNode("span",setup.method+" · single-use session");tag.className="setup-tag";
  root.append(tag,heading,integrationNode("p","API keys go directly to your MSO server. They are not sent to ChatGPT or saved in browser storage."));
  const grid=integrationNode("div"),form=integrationNode("form"),aside=integrationNode("aside");grid.className="setup-grid";form.autocomplete="off";form.setAttribute("action","#");
  const inputs=[];
  for(const f of setup.fields){
    const wrap=integrationNode("div"),label=integrationNode("label",f.label+(f.required&&!f.stored?" *":"")),row=integrationNode("div"),input=integrationNode("input");
    wrap.className="field";row.className="input-row";input.id="setup-"+f.key;label.htmlFor=input.id;input.type=f.secret?"password":"text";input.autocomplete="off";input.spellcheck=false;input.maxLength=4096;input.required=f.required&&!f.stored;input.placeholder=f.stored?"Already stored — leave blank to keep":(f.placeholder||"");
    row.append(input);inputs.push({key:f.key,input});
    if(f.secret){const toggle=integrationNode("button","Show");toggle.type="button";toggle.setAttribute("aria-label","Show or hide "+f.label);toggle.addEventListener("click",()=>{input.type=input.type==="password"?"text":"password";toggle.textContent=input.type==="password"?"Show":"Hide"});row.append(toggle)}
    wrap.append(label,row,integrationNode("small",f.description));form.append(wrap);
  }
  const save=integrationNode("button","Validate & save"),status=integrationNode("p");save.type="button";save.className="primary";status.className="setup-status";status.setAttribute("role","status");status.setAttribute("aria-live","polite");form.append(save,status);
  const guide=integrationNode("details"),summary=integrationNode("summary","How to get this credential"),steps=integrationNode("ol");guide.open=true;guide.append(summary);
  function link(url,label){const a=integrationNode("a",label);try{const u=new URL(url);if(u.protocol!=="https:")return integrationNode("span",label);a.href=u.href}catch{return integrationNode("span",label)}a.target="_blank";a.rel="noopener noreferrer";if(typeof access.openLink==="function")a.addEventListener("click",e=>{e.preventDefault();Promise.resolve(access.openLink(a.href)).catch(()=>{status.textContent="The host could not open this reference. Open the provider dashboard in your browser."})});return a}
  guide.append(link(setup.guidance.url,"Open official provider dashboard"));for(const text of setup.guidance.steps)steps.append(integrationNode("li",text));guide.append(steps,link(setup.guidance.reference,"Official documentation"));
  const storage=integrationNode("details");storage.append(integrationNode("summary","Storage and privacy"),integrationNode("p",setup.store),integrationNode("p","The form expires after 10 minutes and closes after a successful save. Existing keys are never displayed. Blank fields keep existing values. If a key was shared publicly, revoke it at its provider."));
  aside.append(guide,storage);grid.append(form,aside);root.append(grid);
  let used=false;const abort=new AbortController();
  const expire=()=>{used=true;save.disabled=true;inputs.forEach(f=>{f.input.value="";f.input.disabled=true});status.textContent="Setup expired. Open a new secure form."};
  const timer=setTimeout(expire,Math.max(0,setup.expiresAt-Date.now()));
  form.addEventListener("submit",e=>e.preventDefault());
  form.addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target instanceof HTMLInputElement){e.preventDefault();save.click()}});
  save.addEventListener("click",async e=>{
    e.preventDefault();if(used||save.disabled||!form.reportValidity())return;save.disabled=true;status.textContent="Checking provider access…";
    const values={};for(const f of inputs)if(f.input.value.trim())values[f.key]=f.input.value.trim();
    try{
      const response=await fetch(endpoint,{method:"POST",credentials:"omit",cache:"no-store",referrerPolicy:"no-referrer",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({action:"save",values}),signal:AbortSignal.any([abort.signal,AbortSignal.timeout(45000)])});
      const data=await response.json();
      if(!response.ok){const messages={credential_validation_failed:"The provider rejected this key or could not be reached. Check key type, permissions, and expiry; nothing was saved.",invalid_credential_format:"Check the credential format and remove pasted line breaks.",required_fields_missing:"Complete all required fields.",enter_at_least_one_value:"Enter a value to update.",setup_expired_or_invalid:"Setup expired or already used. Open a new form."};throw new Error(messages[data.error]||"Unable to save. Reopen setup or check the provider; nothing was displayed.")}
      used=true;clearTimeout(timer);inputs.forEach(f=>{f.input.value="";f.input.disabled=true});save.textContent="Saved";status.textContent="Verified and saved in MSO. This setup session is now closed.";
    }catch(error){status.textContent=error.message||"Connection failed. Check MSO connectivity."}finally{if(!used)save.disabled=false;for(const key of Object.keys(values))delete values[key]}
  });
  return()=>{abort.abort();clearTimeout(timer);inputs.forEach(f=>{f.input.value=""});root.replaceChildren();root.classList.remove("integration")};
}
`;
