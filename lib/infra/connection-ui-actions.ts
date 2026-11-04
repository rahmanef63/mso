// Lucide icon geometry, lucide-react 1.61.0 (ISC), copyright Lucide Contributors.
// Permission to use, copy, modify, and/or distribute this software for any purpose with or
// without fee is hereby granted, provided this notice appears in all copies.
// THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES INCLUDING
// MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL,
// DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR DAMAGES RESULTING FROM LOSS OF USE, DATA
// OR PROFITS, WHETHER IN CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
// OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
export const CONNECTION_ACTION_SCRIPT = String.raw`
const CONNECTION_ACTION_ICONS = {"eye":[["path",{"d":"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"}],["circle",{"cx":"12","cy":"12","r":"3"}]],"eye-off":[["path",{"d":"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"}],["path",{"d":"M14.084 14.158a3 3 0 0 1-4.242-4.242"}],["path",{"d":"M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"}],["path",{"d":"m2 2 20 20"}]],"copy":[["rect",{"width":"14","height":"14","x":"8","y":"8","rx":"2","ry":"2"}],["path",{"d":"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"}]],"trash-2":[["path",{"d":"M10 11v6"}],["path",{"d":"M14 11v6"}],["path",{"d":"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"}],["path",{"d":"M3 6h18"}],["path",{"d":"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"}]],"ellipsis-vertical":[["circle",{"cx":"12","cy":"12","r":"1"}],["circle",{"cx":"12","cy":"5","r":"1"}],["circle",{"cx":"12","cy":"19","r":"1"}]],"pencil":[["path",{"d":"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"}],["path",{"d":"m15 5 4 4"}]],"star":[["path",{"d":"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"}]],"share-2":[["circle",{"cx":"18","cy":"5","r":"3"}],["circle",{"cx":"6","cy":"12","r":"3"}],["circle",{"cx":"18","cy":"19","r":"3"}],["line",{"x1":"8.59","x2":"15.42","y1":"13.51","y2":"17.49"}],["line",{"x1":"15.41","x2":"8.59","y1":"6.51","y2":"10.49"}]],"eraser":[["path",{"d":"M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21"}],["path",{"d":"m5.082 11.09 8.828 8.828"}]],"unlink":[["path",{"d":"m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71"}],["path",{"d":"m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71"}],["line",{"x1":"8","x2":"8","y1":"2","y2":"5"}],["line",{"x1":"2","x2":"5","y1":"8","y2":"8"}],["line",{"x1":"16","x2":"16","y1":"19","y2":"22"}],["line",{"x1":"19","x2":"22","y1":"16","y2":"16"}]],"chevron-down":[["path",{"d":"m6 9 6 6 6-6"}]],"check":[["path",{"d":"M20 6 9 17l-5-5"}]]};
function connectionIcon(name){
  const ns="http://www.w3.org/2000/svg",svg=document.createElementNS(ns,"svg");
  for(const [key,value] of Object.entries({viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":"2","stroke-linecap":"round","stroke-linejoin":"round","aria-hidden":"true",focusable:"false"}))svg.setAttribute(key,value);
  svg.classList.add("identity-action-icon");
  for(const [tag,attributes] of CONNECTION_ACTION_ICONS[name]){const child=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attributes))child.setAttribute(key,value);svg.append(child)}return svg;
}
function decorateConnectionAction(element,label,icon,iconOnly=false){
  element.replaceChildren(connectionIcon(icon));element.classList.add(iconOnly?"identity-icon-action":"identity-label-action");
  if(element.tagName==="SUMMARY")element.setAttribute("role","button");
  if(iconOnly){element.setAttribute("aria-label",label);element.title=label}else element.append(document.createTextNode(label));return element;
}
function connectionMenu(label){
  const more=integrationNode("details"),secondary=integrationNode("div");more.className="identity-tools";secondary.className="identity-actions";
  const trigger=decorateConnectionAction(integrationNode("summary"),"More actions for "+label,"ellipsis-vertical",true);
  trigger.setAttribute("aria-expanded","false");
  const away=event=>{if(!more.contains(event.target))more.open=false};
  more.addEventListener("keydown",event=>{if(event.key==="Escape"){event.preventDefault();more.open=false;trigger.focus()}});
  more.addEventListener("toggle",()=>{trigger.setAttribute("aria-expanded",String(more.open));document.removeEventListener("pointerdown",away,true);if(more.open)document.addEventListener("pointerdown",away,true)});
  more.append(trigger,secondary);return{more,secondary};
}
function connectionAction(label,icon,handler,cls,iconOnly=false){
  const button=integrationNode("button");button.type="button";if(cls)button.className=cls;
  button.addEventListener("click",handler);return decorateConnectionAction(button,label,icon,iconOnly);
}
`;
