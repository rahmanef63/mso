import { MSO_ORIGIN } from "./ui-config";

export function openInMsoControls(primaryClass = "primary"): string {
  const classAttr = primaryClass ? ` class="${primaryClass}"` : "";
  return `<button${classAttr} type="button" id="open">Open in MSO ↗</button><a class="open-direct" id="open-direct" href="${MSO_ORIGIN}" target="_blank" rel="noopener noreferrer" hidden>Open directly ↗</a><span class="open-feedback" id="open-feedback" role="status" aria-live="polite"></span>`;
}

export const OPEN_IN_MSO_SCRIPT = String.raw`
const MSO_URL="${MSO_ORIGIN}";
const openButton=document.getElementById("open");
const openDirect=document.getElementById("open-direct");
const openFeedback=document.getElementById("open-feedback");
function configureOpenInApp(){
  try {
    if(window.openai&&typeof window.openai.setOpenInAppUrl==="function") window.openai.setOpenInAppUrl({href:MSO_URL});
  } catch (_) {}
}
async function openMso(){
  if(!openButton)return;
  openButton.disabled=true;
  openButton.textContent="Opening…";
  if(openFeedback)openFeedback.textContent="";
  try {
    if(!window.openai||typeof window.openai.openExternal!=="function") throw new Error("openExternal unavailable");
    await window.openai.openExternal({href:MSO_URL,redirectUrl:false});
    openButton.textContent="Opened ✓";
    if(openFeedback)openFeedback.textContent="If no tab opened, use Open directly.";
    if(openDirect)openDirect.hidden=false;
  } catch (_) {
    openButton.textContent="Try again";
    if(openFeedback)openFeedback.textContent="Automatic open unavailable. Use Open directly.";
    if(openDirect)openDirect.hidden=false;
  } finally {
    openButton.disabled=false;
  }
}
if(openButton)openButton.addEventListener("click",openMso);
configureOpenInApp();
window.addEventListener("openai:set_globals",configureOpenInApp,{passive:true});
`;
