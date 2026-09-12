import { MSO_LOGO_SVG } from "@/lib/presentation/logo";
import {PORTABILITY_SCRIPT,PORTABILITY_STYLE} from "./portable/ui";
import { randomBytes } from "node:crypto";
import { MSO_WIDGET_TOKENS } from "@/lib/presentation/widget-tokens";
import { INTEGRATION_FORM_SCRIPT, INTEGRATION_FORM_STYLE } from "./setup-ui";
import { CONNECTION_MANAGER_SCRIPT, CONNECTION_MANAGER_STYLE } from "./connection-ui";
import { INTEGRATION_BROWSER_SCRIPT } from "./setup-browser";
import { connectionCatalog } from "./connection-registry";
export function integrationSetupPage() {
  const nonce = randomBytes(18).toString("base64");
  const catalog = JSON.stringify(connectionCatalog()).replace(/</g,"\\u003c");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Integrations · MSO</title><style nonce="${nonce}">${MSO_WIDGET_TOKENS}${INTEGRATION_FORM_STYLE}${CONNECTION_MANAGER_STYLE}${PORTABILITY_STYLE}*{box-sizing:border-box}body{margin:0;background:var(--surface);padding:clamp(var(--space-4),3vw,40px);font-family:var(--font-body);color:var(--text)}.site-bar{max-width:1180px;margin:0 auto 26px;font-size:var(--type-small);display:flex;justify-content:space-between;gap:var(--space-3)}.site-bar strong{display:flex;align-items:center;gap:var(--space-3);font-weight:750}.site-bar svg{width:30px;height:30px}.site-bar span{color:var(--text-dim)}button{border:var(--stroke) solid var(--sep-strong);border-radius:var(--radius-control);background:var(--field);color:var(--text);padding:var(--space-2) var(--space-3);cursor:pointer}a{color:var(--os-accent)}</style></head><body><header class="site-bar"><strong>${MSO_LOGO_SVG} MSO</strong><span>Your service connections</span></header><main id="setup" class="integration"><h1>Integrations</h1><p>Preparing the native provider catalog…</p><noscript>Enable JavaScript to open the secure credential form. Credentials can also be entered through the MSO terminal.</noscript></main><script nonce="${nonce}">const INTEGRATIONS_CATALOG=${catalog};${INTEGRATION_FORM_SCRIPT}${CONNECTION_MANAGER_SCRIPT}${PORTABILITY_SCRIPT}${INTEGRATION_BROWSER_SCRIPT}</script></body></html>`;
  return { html, csp: `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'` };
}
export function integrationPageResponse() {
  const page = integrationSetupPage();
  return new Response(page.html,{headers:{"Content-Type":"text/html; charset=utf-8","Content-Security-Policy":page.csp,"Cache-Control":"no-store, private","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY"}});
}
