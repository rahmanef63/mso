import { CONNECTION_MANAGER_STYLE } from "@/lib/infra/connection-ui";
import { INTEGRATION_FORM_STYLE } from "@/lib/infra/setup-ui";
import { publicMsoOrigin, widgetResourceMeta } from "./ui-config";
import { OPEN_IN_MSO_SCRIPT, openInMsoControls } from "./ui-navigation";
import { msoSurfaceScript } from "./ui-surface-script";
import { MSO_SURFACE_STYLE } from "./ui-surface-style";

export const MSO_PAGE_URI = "ui://mso/page-v13.html";
const MIME = "text/html;profile=mcp-app";

async function pageHtml(): Promise<string> {
  return String.raw`<main class="surface" aria-label="MSO Page">
<style>${MSO_SURFACE_STYLE}${INTEGRATION_FORM_STYLE}${CONNECTION_MANAGER_STYLE}</style>
<header class="bar">
  <div class="brand" aria-hidden="true">M</div>
  <div class="heading"><strong id="surface-title">MSO Page</strong><span id="surface-route">/</span></div>
  <span class="mode-badge" id="surface-mode">inline</span>
  <div class="tools">
    <button type="button" id="surface-home" class="optional">Home</button>
    <button type="button" id="surface-pip" class="optional">PiP</button>
    <button type="button" id="surface-fullscreen">Fullscreen</button>
    ${openInMsoControls("primary", "/assistant/mcp")}
  </div>
</header>
<section class="body" id="surface-body"><div class="loading">Loading MSO Page…</div></section>
<script>(()=>{${OPEN_IN_MSO_SCRIPT}${await msoSurfaceScript()}})();</script>
</main>`;
}

/** Build the canonical Page at read time. External apps remain registry-driven,
 * but ChatGPT presentation is iframe-free to avoid external-frame review and to
 * preserve each app's own auth/frame boundary through the remote-browser seam. */
export async function msoPageResource() {
  return {
    uri: MSO_PAGE_URI,
    name: "MSO Page",
    description: "Full-page MSO presentation target for native operator views and registry-backed external app handoff through the remote-browser seam.",
    mimeType: MIME,
    text: await pageHtml(),
    _meta: widgetResourceMeta(
      "Interactive MSO Page. It renders native operator views and registry-backed external app handoff without nested external iframes; arbitrary HTML and URLs are never accepted from the model.",
      { connectDomains: [publicMsoOrigin()] },
    ),
  } as const;
}

// Compatibility promise for tests/consumers that imported the historical export.
// resources/read calls msoPageResource() and therefore remains live/dynamic.
export const MSO_PAGE_RESOURCE = msoPageResource();
