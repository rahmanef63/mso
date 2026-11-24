// Presentation facts for the six apps MSO manages. Kept separate from the API
// layer so a card can render before the host answers, and so the catalog never
// becomes a second source of truth for install state: everything here is static
// branding plus the loopback port each runtime is documented to bind.

export type ManagedAppBrand = {
  id: string;
  name: string;
  tagline: string;
  port: number;
  gradient: string;
  glyph: string;
};

export const APP_BRANDS: Record<string, ManagedAppBrand> = {
  hermes: {
    id: "hermes",
    name: "Hermes",
    tagline: "Agent runtime and messaging gateway",
    port: 9119,
    gradient: "linear-gradient(160deg,#8b5cf6,#4f46e5)",
    glyph: "H",
  },
  openclaw: {
    id: "openclaw",
    name: "OpenClaw",
    tagline: "Browser automation control surface",
    port: 18789,
    gradient: "linear-gradient(160deg,#f97316,#dc2626)",
    glyph: "O",
  },
  "9router": {
    id: "9router",
    name: "9Router",
    tagline: "One endpoint routing agents across providers",
    port: 20128,
    gradient: "linear-gradient(160deg,#0ea5e9,#2563eb)",
    glyph: "9",
  },
  orca: {
    id: "orca",
    name: "Orca",
    tagline: "Orchestrated worker agents and terminals",
    port: 3781,
    gradient: "linear-gradient(160deg,#0284c7,#1e3a8a)",
    glyph: "R",
  },
  t3: {
    id: "t3",
    name: "T3 Code",
    tagline: "Coding agent workspace",
    port: 3773,
    gradient: "linear-gradient(160deg,#18181b,#4f46e5)",
    glyph: "T3",
  },
  n8n: {
    id: "n8n",
    name: "n8n",
    tagline: "Workflow automation runtime",
    port: 5678,
    gradient: "linear-gradient(160deg,#ea4b71,#ff6d5a)",
    glyph: "n8",
  },
};

const UNKNOWN_BRAND: Omit<ManagedAppBrand, "id" | "name"> = {
  tagline: "Managed runtime",
  port: 0,
  gradient: "linear-gradient(160deg,#52525b,#27272a)",
  glyph: "?",
};

export function brandFor(id: string, name?: string): ManagedAppBrand {
  const known = APP_BRANDS[id];
  if (known) return known;
  return { id, name: name?.trim() || id, ...UNKNOWN_BRAND };
}

export function loopbackUrl(port: number): string | null {
  return port > 0 && port <= 65535 ? `http://127.0.0.1:${port}` : null;
}
