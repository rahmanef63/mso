// Browser-script fragment for the copyable connection address.
//
// Split out of connection-ui.ts to stay under the 220-line architecture ratchet, and
// because it is one idea: a connection names three coordinates (provider, owner,
// connection) and that triple is both what a human copies and what an agent resolves.
//
// The builders take their DOM helpers as arguments instead of closing over the
// manager's scope, so this stays a plain string with no hidden coupling.
export const CONNECTION_ADDRESS_SCRIPT = String.raw`
function connectionAddressHref(row,owner){
  const params=new URLSearchParams({provider:String(row.provider),user:String(row.user||owner||""),connection:String(row.id)});
  return "/integrations?"+params.toString();
}
function connectionAddressText(row,owner){return String(row.provider)+" / "+String(row.user||owner||"")+" / "+String(row.id)}
// Landing behaviour for an address. Runs once per address: a redraw must not keep
// pulling the pane back while the operator works. A stale address says so, because
// silently showing the provider would look like the link worked.
//
// One control so the manager does not hold address state in its already-dense scope.
function connectionAddressControl(deps){
  const {n,connectionAction,status,textError,detail}=deps;
  function row(row,owner){
    const wrap=n("div",undefined,"connection-address"),label=n("span","Address","connection-address-label"),value=n("code",connectionAddressText(row,owner),"connection-address-value");
    const copy=connectionAction("Copy connection address","link",async()=>{
      try{await navigator.clipboard.writeText(location.origin+connectionAddressHref(row,owner));status.textContent="Address copied. Opening it lands on this owner and connection."}
      catch(e){status.textContent=textError(e)}
    },"identity-icon-action",true);
    value.title=location.origin+connectionAddressHref(row,owner);label.setAttribute("aria-hidden","true");wrap.append(label,value,copy);return wrap;
  }
  // The caller owns "is there a pending address", because only it knows whether a redraw
  // is the first paint of that address or an unrelated reload.
  function reveal(rows,connection){
    if(!connection)return;
    const safe=String(connection).replaceAll('"','');
    const card=detail.querySelector('.connection-card[data-connection-id="'+safe+'"]');
    if(!card){if(rows.length)status.textContent="That connection address no longer matches a connection for this owner.";return}
    card.dataset.addressed="true";
    if(typeof card.scrollIntoView==="function")card.scrollIntoView({block:"center"});
    const heading=card.querySelector("h3");
    if(heading&&typeof heading.focus==="function"){heading.setAttribute("tabindex","-1");heading.focus({preventScroll:true})}
  }
  return {row,reveal};
}
`;
