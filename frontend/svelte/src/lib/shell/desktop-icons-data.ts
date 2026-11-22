export type ShellRole = "viewer" | "operator" | "owner" | null | undefined;

export type DesktopIconDef = {
  readonly app: string;
  readonly title: string;
  readonly badge: string;
  readonly ownerOnly?: boolean;
  readonly multi?: boolean;
  readonly payload?: unknown;
};

export const MIN_FONT_SCALE = 0.9;
export const MAX_FONT_SCALE = 1.2;
export const DEFAULT_FONT_SCALE = 1;

export const DESKTOP_ICONS: readonly DesktopIconDef[] = [
  { app: "assistant", title: "Alfa Assistant", badge: "AI" },
  { app: "files", title: "Files", badge: "FS", multi: true, payload: "~" },
  { app: "editor", title: "Code Editor", badge: "ED", multi: true },
  { app: "docs", title: "Docs & Changelog", badge: "DC" },
  { app: "workflows", title: "Workflows", badge: "WF" },
  { app: "organization", title: "Organization", badge: "OR" },
  { app: "extensions", title: "Extensions", badge: "EX" },
  { app: "processes", title: "Processes", badge: "PR" },
  { app: "services", title: "Services", badge: "SV" },
  { app: "packages", title: "Packages", badge: "PK" },
  { app: "apps", title: "Managed Apps", badge: "AP" },
  { app: "settings", title: "Settings", badge: "ST" },
  { app: "clipboard", title: "Clipboard", badge: "CB" },
  { app: "inspector", title: "Inspector", badge: "IN" },
  { app: "memory", title: "Memory Graph", badge: "MG", ownerOnly: true },
  { app: "store", title: "App Store", badge: "AS", ownerOnly: true },
  { app: "infra", title: "Infrastructure", badge: "IF", ownerOnly: true },
  { app: "integrations", title: "Integrations", badge: "IG", ownerOnly: true },
  { app: "channels", title: "Channels", badge: "CH", ownerOnly: true },
  { app: "terminal", title: "Terminal", badge: "TM", ownerOnly: true },
  { app: "devices", title: "Devices", badge: "DV", ownerOnly: true },
];

export function visibleDesktopIcons(role: ShellRole): DesktopIconDef[] {
  const isOwner = role === "owner";
  return DESKTOP_ICONS.filter((item) => !item.ownerOnly || isOwner);
}

export function clampFontScale(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_FONT_SCALE;
  }
  const bounded = Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, value));
  return Math.round(bounded * 100) / 100;
}
