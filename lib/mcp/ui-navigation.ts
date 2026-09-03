import { MSO_ORIGIN } from "./ui-config";

function safePath(path: string): string {
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

export function openInMsoControls(primaryClass = "primary", targetPath = "/"): string {
  const classAttr = primaryClass ? ` class="${primaryClass}"` : "";
  const path = safePath(targetPath);
  const href = new URL(path, MSO_ORIGIN).href;
  return `<button${classAttr} type="button" id="open" data-mso-path="${path}">Open in MSO ↗</button><a class="open-direct" id="open-direct" href="${href}" target="_blank" rel="noopener noreferrer" hidden>Open directly ↗</a><span class="open-feedback" id="open-feedback" role="status" aria-live="polite"></span>`;
}

export const OPEN_IN_MSO_SCRIPT = String.raw`
const MSO_ORIGIN="${MSO_ORIGIN}";
const openButton=document.getElementById("open");
const openDirect=document.getElementById("open-direct");
const openFeedback=document.getElementById("open-feedback");
function msoTargetUrl(){
  const path=openButton&&typeof openButton.dataset.msoPath==="string"?openButton.dataset.msoPath:"/";
  try{return new URL(path&&path.startsWith("/")&&!path.startsWith("//")?path:"/",MSO_ORIGIN).href}catch(_){return MSO_ORIGIN}
}
function setMsoTarget(path){
  const safe=typeof path==="string"&&path.startsWith("/")&&!path.startsWith("//")?path:"/";
  if(openButton)openButton.dataset.msoPath=safe;
  if(openDirect)openDirect.href=msoTargetUrl();
  configureOpenInApp();
}
function configureOpenInApp(){
  try {
    if(window.openai&&typeof window.openai.setOpenInAppUrl==="function") window.openai.setOpenInAppUrl({href:msoTargetUrl()});
  } catch (_) {}
}
async function openMso(){
  if(!openButton)return;
  openButton.disabled=true;
  openButton.textContent="Opening…";
  if(openFeedback)openFeedback.textContent="";
  try {
    if(!window.openai||typeof window.openai.openExternal!=="function") throw new Error("openExternal unavailable");
    await window.openai.openExternal({href:msoTargetUrl(),redirectUrl:false});
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
