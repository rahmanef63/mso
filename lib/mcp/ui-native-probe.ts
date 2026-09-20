export const MSO_NATIVE_UI_PROBE_URI = "ui://mso/native-probe-v1.html";
const MIME = "text/html;profile=mcp-app";

const html = String.raw`<!doctype html><meta charset="utf-8"><title>MSO Native UI Probe</title><main style="box-sizing:border-box;padding:16px;font:600 16px/1.4 system-ui,sans-serif">MSO NATIVE UI WORKS</main>`;

export const MSO_NATIVE_UI_PROBE_RESOURCE = {
  uri: MSO_NATIVE_UI_PROBE_URI,
  name: "MSO Native UI Probe",
  description: "Minimal static MCP App resource used only to isolate ChatGPT host-side native UI mounting.",
  mimeType: MIME,
  text: html,
  _meta: {
    ui: {
      prefersBorder: true,
      csp: { connectDomains: [], resourceDomains: [] },
    },
  },
} as const;
