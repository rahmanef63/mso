import type { ChromeProfile } from "./chrome-profile.ts";

export type AppIconVisual = {
  readonly image: string | null;
  readonly monogram: string;
  readonly gradient: string;
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

const FALLBACK_STYLE: Record<string, { monogram: string; gradient: string }> = {
  assistant: { monogram: "AI", gradient: "linear-gradient(135deg, #2563eb, #7c3aed)" },
  files: { monogram: "FS", gradient: "linear-gradient(135deg, #0ea5e9, #2563eb)" },
  editor: { monogram: "ED", gradient: "linear-gradient(135deg, #1d4ed8, #0f172a)" },
  docs: { monogram: "DC", gradient: "linear-gradient(135deg, #0284c7, #0369a1)" },
  workflows: { monogram: "WF", gradient: "linear-gradient(135deg, #7c3aed, #4f46e5)" },
  n8n: { monogram: "N8", gradient: "linear-gradient(135deg, #ea580c, #dc2626)" },
  organization: { monogram: "OR", gradient: "linear-gradient(135deg, #0d9488, #0284c7)" },
  extensions: { monogram: "EX", gradient: "linear-gradient(135deg, #6366f1, #8b5cf6)" },
  media: { monogram: "MV", gradient: "linear-gradient(135deg, #ec4899, #8b5cf6)" },
  pickers: { monogram: "PK", gradient: "linear-gradient(135deg, #f59e0b, #ea580c)" },
  "image-editor": { monogram: "IE", gradient: "linear-gradient(135deg, #db2777, #7c3aed)" },
  "media-studio": { monogram: "MS", gradient: "linear-gradient(135deg, #e11d48, #9333ea)" },
  "reel-editor": { monogram: "RE", gradient: "linear-gradient(135deg, #f97316, #db2777)" },
  camoufox: { monogram: "CF", gradient: "linear-gradient(135deg, #ea580c, #b45309)" },
  "bot-desktops": { monogram: "BD", gradient: "linear-gradient(135deg, #334155, #0f172a)" },
  processes: { monogram: "PR", gradient: "linear-gradient(135deg, #059669, #0d9488)" },
  services: { monogram: "SV", gradient: "linear-gradient(135deg, #16a34a, #047857)" },
  packages: { monogram: "PG", gradient: "linear-gradient(135deg, #d97706, #b45309)" },
  apps: { monogram: "AP", gradient: "linear-gradient(135deg, #2563eb, #0891b2)" },
  settings: { monogram: "ST", gradient: "linear-gradient(135deg, #475569, #334155)" },
  "shell-settings": { monogram: "SH", gradient: "linear-gradient(135deg, #64748b, #1e293b)" },
  clipboard: { monogram: "CB", gradient: "linear-gradient(135deg, #0284c7, #0f766e)" },
  inspector: { monogram: "IN", gradient: "linear-gradient(135deg, #0891b2, #1d4ed8)" },
  "agent-vault": { monogram: "AV", gradient: "linear-gradient(135deg, #4f46e5, #1e1b4b)" },
  "agent-group": { monogram: "AG", gradient: "linear-gradient(135deg, #6d28d9, #1d4ed8)" },
  "create-app": { monogram: "CA", gradient: "linear-gradient(135deg, #10b981, #2563eb)" },
  memory: { monogram: "MG", gradient: "linear-gradient(135deg, #8b5cf6, #ec4899)" },
  store: { monogram: "AS", gradient: "linear-gradient(135deg, #2563eb, #0284c7)" },
  infra: { monogram: "IF", gradient: "linear-gradient(135deg, #0f766e, #155e75)" },
  integrations: { monogram: "IG", gradient: "linear-gradient(135deg, #0284c7, #4f46e5)" },
  channels: { monogram: "CH", gradient: "linear-gradient(135deg, #2563eb, #0d9488)" },
  terminal: { monogram: ">_", gradient: "linear-gradient(135deg, #1e293b, #09090b)" },
  devices: { monogram: "DV", gradient: "linear-gradient(135deg, #3b82f6, #1e40af)" },
};

export function resolveAppIcon(app: string, chrome: ChromeProfile): AppIconVisual {
  const file = ICON_FILE[app];
  const fallback = FALLBACK_STYLE[app] ?? {
    monogram: app.slice(0, 2).toUpperCase(),
    gradient: "linear-gradient(135deg, #1f6df0, #1e40af)",
  };
  if (!file) return { image: null, ...fallback };
  const dir = chrome === "windows" ? "windows" : "macos";
  return { image: `/app-icons/${dir}/${file}`, ...fallback };
}
