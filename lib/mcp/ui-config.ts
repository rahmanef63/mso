export const MSO_ORIGIN = "https://mso.rahmanef.com";
// Dedicated sibling origin for ChatGPT MCP Apps. It intentionally does NOT sit
// below mso.rahmanef.com, whose session cookie may be scoped to that hostname.
export const MCP_UI_DOMAIN = "https://mso-ui.rahmanef.com";

export function widgetResourceMeta(description: string, options?: { frameDomains?: readonly string[]; connectDomains?: readonly string[]; resourceDomains?: readonly string[] }): Record<string, unknown> {
  const frameDomains = [...(options?.frameDomains ?? [])];
  const connectDomains = [...(options?.connectDomains ?? [])];
  const resourceDomains = [...(options?.resourceDomains ?? [])];
  return {
    ui: {
      domain: MCP_UI_DOMAIN,
      prefersBorder: true,
      csp: { connectDomains, resourceDomains, ...(frameDomains.length ? { frameDomains } : {}) },
    },
    "openai/widgetDescription": description,
    "openai/widgetPrefersBorder": true,
    "openai/widgetDomain": MCP_UI_DOMAIN,
    "openai/widgetCSP": { connect_domains: connectDomains, resource_domains: resourceDomains, ...(frameDomains.length ? { frame_domains: frameDomains } : {}), redirect_domains: [MSO_ORIGIN] },
  };
}
