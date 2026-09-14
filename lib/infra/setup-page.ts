import { MSO_LOGO_SVG } from "@/lib/presentation/logo";
import {PORTABILITY_SCRIPT,PORTABILITY_STYLE} from "./portable/ui";
import { randomBytes } from "node:crypto";
import { MSO_WIDGET_TOKENS } from "@/lib/presentation/widget-tokens";
import { INTEGRATION_FORM_SCRIPT, INTEGRATION_FORM_STYLE } from "./setup-ui";
import { CONNECTION_MANAGER_SCRIPT, CONNECTION_MANAGER_STYLE } from "./connection-ui";
import { INTEGRATION_BROWSER_SCRIPT } from "./setup-browser";
import { connectionCatalog } from "./connection-registry";
export const INTEGRATION_PAGE_STYLE = String.raw`
*{box-sizing:border-box}
body{margin:0;background:var(--background);padding:var(--space-6);font-family:var(--font-body);color:var(--foreground)}
.site-bar{max-width:var(--measure);margin:0 auto var(--space-6);font-size:var(--type-small);display:flex;justify-content:space-between;gap:var(--space-3)}
.site-bar strong{display:flex;align-items:center;gap:var(--space-3);font-weight:var(--weight-strong)}.site-bar svg{width:var(--brand-size);height:var(--brand-size)}.site-bar span{color:var(--muted-foreground)}
button{border:var(--stroke) solid var(--input);border-radius:var(--radius-control);background:var(--secondary);color:var(--secondary-foreground);padding:var(--space-2) var(--space-3);font:var(--type-small)/var(--line-body) var(--font-body);cursor:pointer}a{color:var(--settings-action-text)}
`;

export function integrationSetupPage(embedded = false) {
  const nonce = randomBytes(18).toString("base64");
  const catalog = JSON.stringify(connectionCatalog()).replace(/</g,"\\u003c");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Integrations · MSO</title><style nonce="${nonce}">${MSO_WIDGET_TOKENS}${INTEGRATION_PAGE_STYLE}${INTEGRATION_FORM_STYLE}${CONNECTION_MANAGER_STYLE}${PORTABILITY_STYLE}${embedded ? "html,body{height:100%}body{padding:0;overflow:hidden}.site-bar{display:none}#setup{height:100%}" : ""}</style></head><body><header class="site-bar"><strong>${MSO_LOGO_SVG} MSO</strong><span>Your service connections</span></header><main id="setup" class="integration"><h1>Integrations</h1><p>Preparing the native provider catalog…</p><noscript>Enable JavaScript to open the secure credential form. Credentials can also be entered through the MSO terminal.</noscript></main><script nonce="${nonce}">const INTEGRATIONS_CATALOG=${catalog};${INTEGRATION_FORM_SCRIPT}${CONNECTION_MANAGER_SCRIPT}${PORTABILITY_SCRIPT}${INTEGRATION_BROWSER_SCRIPT}</script></body></html>`;
  return { html, csp: `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors ${embedded ? "'self'" : "'none'"}` };
}
function integrationResponse(embedded: boolean) {
  const page = integrationSetupPage(embedded);
  return new Response(page.html,{headers:{"Content-Type":"text/html; charset=utf-8","Content-Security-Policy":page.csp,"Cache-Control":"no-store, private","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff","X-Frame-Options":embedded ? "SAMEORIGIN" : "DENY"}});
}

export const integrationPageResponse = (request?: Request) => integrationResponse(request ? new URL(request.url).searchParams.get("embed") === "shell" : false);
export const integrationManagerResponse = () => integrationResponse(true);
