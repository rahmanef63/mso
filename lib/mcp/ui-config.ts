/** Deployment-owned public browser origin. Never encode an operator instance here. */
function loopback(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  return host === "localhost" || host === "::1" || host.startsWith("127.");
}

export function sanitizedBrowserOrigin(
  value: string | undefined,
  fallback = "http://localhost:4005",
): string {
  const raw = value?.trim();
  if (raw) {
    try {
      const url = new URL(raw);
      if (
        !url.username &&
        !url.password &&
        (url.protocol === "https:" ||
          (url.protocol === "http:" && loopback(url.hostname)))
      )
        return url.origin;
    } catch {
      /* use safe local fallback */
    }
  }
  return fallback;
}

export function publicMsoOrigin(): string {
  return sanitizedBrowserOrigin(process.env.OS_PUBLIC_ORIGIN);
}

export function mcpUiOrigin(): string {
  const explicit = process.env.OS_MCP_UI_ORIGIN?.trim();
  if (explicit) return sanitizedBrowserOrigin(explicit, publicMsoOrigin());
  const publicOrigin = publicMsoOrigin();
  const url = new URL(publicOrigin);
  if (url.hostname.toLowerCase().startsWith("mso.")) {
    url.hostname = `mso-ui.${url.hostname.slice(4)}`;
    return url.origin;
  }
  return publicOrigin;
}

// Kept as exports for existing resource modules/tests. These are startup snapshots;
// widgetResourceMeta() recomputes the deployment origins whenever a resource is read.
export const MSO_ORIGIN = publicMsoOrigin();
export const MCP_UI_DOMAIN = mcpUiOrigin();

export function widgetResourceMeta(
  description: string,
  options?: {
    frameDomains?: readonly string[];
    connectDomains?: readonly string[];
    resourceDomains?: readonly string[];
    redirectDomains?: readonly string[];
  },
): Record<string, unknown> {
  const frameDomains = [...(options?.frameDomains ?? [])];
  const connectDomains = [...(options?.connectDomains ?? [])];
  const resourceDomains = [...(options?.resourceDomains ?? [])];
  const uiDomain = mcpUiOrigin();
  const msoOrigin = publicMsoOrigin();
  return {
    ui: {
      domain: uiDomain,
      prefersBorder: true,
      csp: {
        connectDomains,
        resourceDomains,
        ...(frameDomains.length ? { frameDomains } : {}),
      },
    },
    "openai/widgetDescription": description,
    "openai/widgetPrefersBorder": true,
    "openai/widgetDomain": uiDomain,
    "openai/widgetCSP": {
      ...(connectDomains.length ? { connect_domains: connectDomains } : {}),
      ...(frameDomains.length ? { frame_domains: frameDomains } : {}),
      redirect_domains: [msoOrigin, ...(options?.redirectDomains ?? [])],
    },
  };
}
