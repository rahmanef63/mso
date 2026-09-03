import { widgetResourceMeta } from "./ui-config";
import { OPEN_IN_MSO_SCRIPT, openInMsoControls } from "./ui-navigation";
import { surfaceFrameDomains } from "./surface-catalog";
import { MSO_SURFACE_SCRIPT } from "./ui-surface-script";
import { MSO_SURFACE_STYLE } from "./ui-surface-style";

export const MSO_SURFACE_URI = "ui://mso/surface-v1.html";
const MIME = "text/html;profile=mcp-app";

const html = String.raw`<main class="surface" aria-label="MSO Surface">
<style>${MSO_SURFACE_STYLE}</style>
<header class="bar">
  <div class="brand" aria-hidden="true">M</div>
  <div class="heading"><strong id="surface-title">MSO Surface</strong><span id="surface-route">/</span></div>
  <span class="mode-badge" id="surface-mode">inline</span>
  <div class="tools">
    <button type="button" id="surface-home" class="optional">Home</button>
    <button type="button" id="surface-pip" class="optional">PiP</button>
    <button type="button" id="surface-fullscreen">Fullscreen</button>
    ${openInMsoControls("primary", "/assistant/mcp")}
  </div>
</header>
<section class="body" id="surface-body"><div class="loading">Loading MSO Surface…</div></section>
<script>(()=>{${OPEN_IN_MSO_SCRIPT}${MSO_SURFACE_SCRIPT}})();</script>
</main>`;

export const MSO_SURFACE_RESOURCE = {
  uri: MSO_SURFACE_URI,
  name: "MSO Surface",
  description: "Universal secure MSO presentation target for native operator views and reviewed live app demos inside ChatGPT.",
  mimeType: MIME,
  text: html,
  _meta: widgetResourceMeta(
    "Interactive MSO Surface. It renders native MSO views and reviewed app demos. Nested frames are exact-origin allowlisted; arbitrary HTML and URLs are never accepted from the model.",
    { frameDomains: surfaceFrameDomains() },
  ),
} as const;
