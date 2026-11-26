import type { ChromeProfile } from "./chrome-profile.ts";

export type AppIconVisual = {
  readonly image: string | null;
  readonly monogram: string;
  readonly gradient: string;
};

type IconStyle = {
  readonly monogram: string;
  readonly colors: readonly [string, string];
};

const ICON_FILE: Record<string, string> = {
  assistant: "assistant.webp",
  files: "files.webp",
  editor: "code.webp",
  docs: "docs.webp",
  media: "viewer.webp",
  "image-editor": "studio.webp",
  "media-studio": "studio.webp",
  "reel-editor": "reel.webp",
  "create-app": "create.webp",
  processes: "monitor.webp",
  inspector: "monitor.webp",
  settings: "settings.webp",
  "shell-settings": "settings.webp",
  store: "store.webp",
  extensions: "store.webp",
  terminal: "terminal.webp",
  integrations: "links.webp",
  channels: "links.webp",
  "agent-vault": "claude.webp",
  "agent-group": "claude.webp",
};

const ICON_STYLE: Record<string, IconStyle> = {
  assistant: { monogram: "AI", colors: ["#2563eb", "#7c3aed"] },
  files: { monogram: "FS", colors: ["#0ea5e9", "#2563eb"] },
  editor: { monogram: "ED", colors: ["#1d4ed8", "#0f172a"] },
  docs: { monogram: "DC", colors: ["#0284c7", "#0369a1"] },
  workflows: { monogram: "WF", colors: ["#7c3aed", "#4f46e5"] },
  n8n: { monogram: "N8", colors: ["#ea580c", "#dc2626"] },
  t3: { monogram: "T3", colors: ["#334155", "#0f172a"] },
  organization: { monogram: "OR", colors: ["#0d9488", "#0284c7"] },
  extensions: { monogram: "EX", colors: ["#6366f1", "#8b5cf6"] },
  media: { monogram: "MV", colors: ["#ec4899", "#8b5cf6"] },
  pickers: { monogram: "PK", colors: ["#f59e0b", "#ea580c"] },
  "image-editor": { monogram: "IE", colors: ["#db2777", "#7c3aed"] },
  "media-studio": { monogram: "MS", colors: ["#e11d48", "#9333ea"] },
  "reel-editor": { monogram: "RE", colors: ["#f97316", "#db2777"] },
  camoufox: { monogram: "CF", colors: ["#ea580c", "#b45309"] },
  "bot-desktops": { monogram: "BD", colors: ["#334155", "#0f172a"] },
  processes: { monogram: "PR", colors: ["#059669", "#0d9488"] },
  services: { monogram: "SV", colors: ["#16a34a", "#047857"] },
  packages: { monogram: "PG", colors: ["#d97706", "#b45309"] },
  apps: { monogram: "AP", colors: ["#2563eb", "#0891b2"] },
  settings: { monogram: "ST", colors: ["#475569", "#334155"] },
  "shell-settings": { monogram: "SH", colors: ["#64748b", "#1e293b"] },
  clipboard: { monogram: "CB", colors: ["#0284c7", "#0f766e"] },
  inspector: { monogram: "IN", colors: ["#0891b2", "#1d4ed8"] },
  "agent-vault": { monogram: "AV", colors: ["#4f46e5", "#1e1b4b"] },
  "agent-group": { monogram: "AG", colors: ["#6d28d9", "#1d4ed8"] },
  "create-app": { monogram: "CA", colors: ["#10b981", "#2563eb"] },
  memory: { monogram: "MG", colors: ["#8b5cf6", "#ec4899"] },
  store: { monogram: "AS", colors: ["#2563eb", "#0284c7"] },
  infra: { monogram: "IF", colors: ["#0f766e", "#155e75"] },
  integrations: { monogram: "IG", colors: ["#0284c7", "#4f46e5"] },
  channels: { monogram: "CH", colors: ["#2563eb", "#0d9488"] },
  terminal: { monogram: ">_", colors: ["#1e293b", "#09090b"] },
  devices: { monogram: "DV", colors: ["#3b82f6", "#1e40af"] },
};

const GENERIC_GLYPH =
  '<path d="M12 4.2L19.5 8.5 12 12.8 4.5 8.5 12 4.2z" fill="currentColor" fill-opacity="0.26"/>'
  + '<path d="M4.5 12.4L12 16.7l7.5-4.3M4.5 16L12 20.3 19.5 16"/>';

const APP_GLYPH: Record<string, string> = {
  workflows:
    '<circle cx="6" cy="6.5" r="2.4" fill="currentColor" fill-opacity="0.22"/>'
    + '<circle cx="18" cy="6.5" r="2.4" fill="currentColor" fill-opacity="0.22"/>'
    + '<circle cx="12" cy="17.5" r="2.4" fill="currentColor" fill-opacity="0.22"/>'
    + '<path d="M8.4 6.5h7.2M7.3 8.6l3.4 6.8M16.7 8.6l-3.4 6.8"/>',
  n8n: '<path d="M13.2 3.2L6.6 12.6h4.9l-1 8.2 6.9-9.4h-5l.8-8.2z" fill="currentColor" fill-opacity="0.22"/>',
  organization:
    '<rect x="9.5" y="3.5" width="5" height="4" rx="1.2" fill="currentColor" fill-opacity="0.22"/>'
    + '<rect x="3.5" y="16" width="5" height="4" rx="1.2" fill="currentColor" fill-opacity="0.22"/>'
    + '<rect x="15.5" y="16" width="5" height="4" rx="1.2" fill="currentColor" fill-opacity="0.22"/>'
    + '<path d="M12 7.5v4.2M6 16v-2.2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2V16"/>',
  camoufox:
    '<circle cx="12" cy="12" r="8.2"/>'
    + '<polygon points="15.6,8.4 13.4,13.4 8.4,15.6 10.6,10.6" fill="currentColor" fill-opacity="0.28"/>'
    + '<circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
  "bot-desktops":
    '<rect x="3.5" y="4.5" width="17" height="12" rx="2.2" fill="currentColor" fill-opacity="0.16"/>'
    + '<path d="M9 19.5h6M12 16.5v3M7 8.5h10M7 11.8h6"/>',
  services:
    '<circle cx="12" cy="12" r="3.2" fill="currentColor" fill-opacity="0.22"/>'
    + '<circle cx="12" cy="12" r="7.2" stroke-dasharray="2.4 2.4"/>'
    + '<path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2"/>',
  packages:
    '<path d="M12 3.2L19.5 7.4v9.2L12 20.8 4.5 16.6V7.4L12 3.2z" fill="currentColor" fill-opacity="0.18"/>'
    + '<path d="M12 12v8.8M12 12L4.5 7.4M12 12l7.5-4.6M8.3 5.3l7.4 4.3"/>',
  apps:
    '<rect x="4" y="4" width="6.5" height="6.5" rx="1.7" fill="currentColor" fill-opacity="0.24"/>'
    + '<rect x="13.5" y="4" width="6.5" height="6.5" rx="1.7" fill="currentColor" fill-opacity="0.24"/>'
    + '<rect x="4" y="13.5" width="6.5" height="6.5" rx="1.7" fill="currentColor" fill-opacity="0.24"/>'
    + '<rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.7" fill="currentColor" fill-opacity="0.24"/>',
  clipboard:
    '<rect x="5.5" y="5.5" width="13" height="15" rx="2.2" fill="currentColor" fill-opacity="0.16"/>'
    + '<rect x="9" y="3.3" width="6" height="3.4" rx="1.1" fill="currentColor" fill-opacity="0.32"/>'
    + '<path d="M9 11.5h6M9 15.2h4.2"/>',
  devices:
    '<rect x="3" y="5.5" width="12" height="9" rx="1.6" fill="currentColor" fill-opacity="0.18"/>'
    + '<path d="M5.5 17.5h7"/>'
    + '<rect x="15.5" y="8" width="5.5" height="10.5" rx="1.5" fill="currentColor" fill-opacity="0.26"/>',
  infra:
    '<path d="M7.2 14.5a3.8 3.8 0 0 1-.4-7.5A5 5 0 0 1 16.6 6.5a3.5 3.5 0 0 1-.2 8H7.2z" fill="currentColor" fill-opacity="0.2"/>'
    + '<rect x="5" y="16.5" width="14" height="3.6" rx="1.2" fill="currentColor" fill-opacity="0.24"/>'
    + '<circle cx="8" cy="18.3" r="0.7" fill="currentColor" stroke="none"/>',
  memory:
    '<circle cx="12" cy="5.5" r="2" fill="currentColor" fill-opacity="0.28"/>'
    + '<circle cx="5.8" cy="12" r="2" fill="currentColor" fill-opacity="0.28"/>'
    + '<circle cx="18.2" cy="12" r="2" fill="currentColor" fill-opacity="0.28"/>'
    + '<circle cx="12" cy="18.5" r="2" fill="currentColor" fill-opacity="0.28"/>'
    + '<circle cx="12" cy="12" r="2.2" fill="currentColor"/>'
    + '<path d="M12 7.5v2.3M12 14.2v2.3M7.8 12h2M14.2 12h2M7.3 10.6l3.3-3.5M16.7 10.6l-3.3-3.5"/>',
  pickers:
    '<path d="M12 3.8a8.2 8.2 0 1 0 0 16.4h1.1a2.1 2.1 0 0 0 1.4-3.6 1.7 1.7 0 0 1 1.2-2.9h1.4a3.1 3.1 0 0 0 3.1-3.1A7.6 7.6 0 0 0 12 3.8z" fill="currentColor" fill-opacity="0.18"/>'
    + '<circle cx="8.2" cy="10.2" r="1.1" fill="currentColor" stroke="none"/>'
    + '<circle cx="12" cy="8.2" r="1.1" fill="currentColor" stroke="none"/>'
    + '<circle cx="15.8" cy="10.2" r="1.1" fill="currentColor" stroke="none"/>',
};

const DATA_URI_CACHE = new Map<string, string>();

export function appGlyphMarkup(app: string): string {
  return APP_GLYPH[app] ?? GENERIC_GLYPH;
}

export function appGradient(app: string): string {
  const style = ICON_STYLE[app];
  const [from, to] = style ? style.colors : (["#1f6df0", "#1e40af"] as const);
  return `linear-gradient(135deg, ${from}, ${to})`;
}

/** Inline SVG squircle so apps without a .webp asset never fall back to a monogram box. */
export function squircleIconDataUri(app: string): string {
  const cached = DATA_URI_CACHE.get(app);
  if (cached) return cached;
  const [from, to] = ICON_STYLE[app]?.colors ?? ["#1f6df0", "#1e40af"];
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
    + '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
    + `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>`
    + "</linearGradient></defs>"
    + '<rect width="64" height="64" rx="15" fill="url(#g)"/>'
    + '<g transform="translate(8 8) scale(2)" style="color:#ffffff" fill="none" stroke="currentColor" '
    + 'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
    + appGlyphMarkup(app)
    + "</g></svg>";
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  DATA_URI_CACHE.set(app, uri);
  return uri;
}

export function resolveAppIcon(app: string, chrome: ChromeProfile): AppIconVisual {
  const file = ICON_FILE[app];
  const style = ICON_STYLE[app] ?? { monogram: app.slice(0, 2).toUpperCase(), colors: ["#1f6df0", "#1e40af"] as const };
  const gradient = appGradient(app);
  if (!file) return { image: squircleIconDataUri(app), monogram: style.monogram, gradient };
  const dir = chrome === "windows" ? "windows" : "macos";
  return { image: `/app-icons/${dir}/${file}`, monogram: style.monogram, gradient };
}
