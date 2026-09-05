import { CONNECTION_MANAGER_STYLE } from "@/lib/infra/connection-ui";
import { INTEGRATION_FORM_STYLE } from "@/lib/infra/setup-ui";
import { widgetResourceMeta, MSO_ORIGIN } from "./ui-config";
import { OPEN_IN_MSO_SCRIPT, openInMsoControls } from "./ui-navigation";
import { surfaceFrameDomains } from "./surface-catalog";
import { MSO_SURFACE_SCRIPT } from "./ui-surface-script";
import { MSO_SURFACE_STYLE } from "./ui-surface-style";

export const MSO_PAGE_URI = "ui://mso/page-v7.html";
const MIME = "text/html;profile=mcp-app";

const html = String.raw`<main class="surface" aria-label="MSO Page">
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
<script>(()=>{${OPEN_IN_MSO_SCRIPT}${MSO_SURFACE_SCRIPT}})();</script>
</main>`;

export const MSO_PAGE_RESOURCE = {
  uri: MSO_PAGE_URI,
  name: "MSO Page",
  description: "Full-page MSO presentation target for native operator views and explicitly reviewed development or production app embeds.",
  mimeType: MIME,
  text: html,
  _meta: widgetResourceMeta(
    "Interactive MSO Page. It renders native operator views and exact-origin reviewed development or production targets. Nested frames are limited to explicit CSP frame domains and dedicated embed routes; arbitrary HTML and URLs are never accepted from the model.",
    { frameDomains: surfaceFrameDomains(), redirectDomains: surfaceFrameDomains(), connectDomains: [MSO_ORIGIN] },
  ),
} as const;
