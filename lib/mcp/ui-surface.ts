import { surfaceApps, type SurfaceApp } from "./surface-catalog";
import { MSO_LOGO_SVG } from "@/lib/presentation/logo";
import { CONNECTION_MANAGER_STYLE } from "@/lib/infra/connection-ui";
import { INTEGRATION_FORM_STYLE } from "@/lib/infra/setup-ui";
import { publicMsoOrigin, widgetResourceMeta } from "./ui-config";
import { OPEN_IN_MSO_SCRIPT, openInMsoControls } from "./ui-navigation";
import { msoSurfaceScript } from "./ui-surface-script";
import { MSO_SURFACE_STYLE } from "./ui-surface-style";

export const MSO_PAGE_URI = "ui://mso/page-v15.html";
const MIME = "text/html;profile=mcp-app";

async function pageHtml(apps: readonly SurfaceApp[]): Promise<string> {
  return String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MSO workspace</title></head><body><main class="surface" aria-label="MSO Page">
<style>${MSO_SURFACE_STYLE}${INTEGRATION_FORM_STYLE}${CONNECTION_MANAGER_STYLE}</style>
<header class="bar">
  <div class="brand" aria-hidden="true">${MSO_LOGO_SVG}</div>
  <div class="heading"><strong id="surface-title">MSO Page</strong><span id="surface-route">/</span></div>
  <select id="surface-nav" class="page-nav" aria-label="MSO page"></select>
  <div class="tools">
    <button type="button" id="surface-home" hidden>Home</button>
    <button type="button" id="surface-pip" class="optional">PiP</button>
    <button type="button" id="surface-fullscreen" class="icon-button" aria-label="Fullscreen" title="Fullscreen"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg></button>
    ${openInMsoControls("primary", "/assistant/mcp")}
  </div>
</header>
<div class="page-feedback"><span class="mode-badge" id="surface-mode" role="status" aria-live="polite"></span></div>
<section class="body" id="surface-body"><div class="loading">Loading MSO Page…</div></section>
<script>(()=>{${OPEN_IN_MSO_SCRIPT}${await msoSurfaceScript(apps)}})();</script>
</main></body></html>`;
}

/** Read-time registry and CSP stay aligned. Only reviewed preview origins can frame. */
export async function msoPageResource() {
  const apps = await surfaceApps();
  const frameDomains = [...new Set(apps.filter(app => app.renderer === "iframe").map(app => app.origin))];
  return {
    uri: MSO_PAGE_URI,
    name: "MSO Page",
    description: "Responsive MSO workspace for integrations, project state, sessions, assets and reviewed demo previews.",
    mimeType: MIME,
    text: await pageHtml(apps),
    _meta: widgetResourceMeta(
      "Interactive MSO workspace with native operator views and sandboxed previews from an owner-reviewed origin registry. Arbitrary HTML and URLs are rejected.",
      { connectDomains: [publicMsoOrigin()], frameDomains, redirectDomains: frameDomains },
    ),
  } as const;
}

// Compatibility promise for tests/consumers that imported the historical export.
// resources/read calls msoPageResource() and therefore remains live/dynamic.
export const MSO_PAGE_RESOURCE = msoPageResource();
