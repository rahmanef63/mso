import type { ComponentType } from "react";
import {
  DatabaseBackup,
  Info,
  Link2,
  Paintbrush,
  Palette,
  Plug,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";

export type SectionId =
  | "appearance" | "theme" | "ai" | "quicklinks" | "mcp" | "devices" | "server" | "cleanup" | "backup" | "about";
export type SettingsGroup = "personalization" | "services" | "system";

export type SettingsSectionMeta = {
  id: SectionId;
  label: string;
  blurb: string;
  icon: ComponentType<{ className?: string }>;
  color: string;
  group: SettingsGroup;
};

/** Presentation-agnostic Settings navigation model. */
export const SECTIONS: ReadonlyArray<SettingsSectionMeta> = [
  { id: "appearance", label: "Appearance", blurb: "Style, accent, wallpaper, device", icon: Palette, color: "#0a84ff", group: "personalization" },
  { id: "theme", label: "Theme", blurb: "Mode, presets, font, contrast", icon: Paintbrush, color: "#ff375f", group: "personalization" },
  { id: "ai", label: "AI", blurb: "Model and API key", icon: Sparkles, color: "#bf5af2", group: "services" },
  { id: "quicklinks", label: "Quicklink", blurb: "Website shortcuts with favicons", icon: Link2, color: "#5e5ce6", group: "services" },
  { id: "mcp", label: "MCP", blurb: "Control this VPS from ChatGPT", icon: Plug, color: "#00c7be", group: "services" },
  { id: "devices", label: "Devices", blurb: "Approved browsers and sessions", icon: ShieldCheck, color: "#30d158", group: "system" },
  { id: "server", label: "Server", blurb: "Mock or live host data", icon: Server, color: "#ff9f0a", group: "system" },
  { id: "cleanup", label: "Cleanup", blurb: "Free disk space safely", icon: Trash2, color: "#64d2ff", group: "system" },
  { id: "backup", label: "Backup", blurb: "Export or restore browser data", icon: DatabaseBackup, color: "#a2845e", group: "system" },
  { id: "about", label: "About", blurb: "System info and reset", icon: Info, color: "#8e8e93", group: "system" },
];

export function settingsSection(id: SectionId): SettingsSectionMeta {
  return SECTIONS.find((section) => section.id === id)!;
}

export function filterSettingsSections(query: string): ReadonlyArray<SettingsSectionMeta> {
  const q = query.trim().toLowerCase();
  if (!q) return SECTIONS;
  return SECTIONS.filter((section) => `${section.label} ${section.blurb}`.toLowerCase().includes(q));
}

export function groupSettingsSections(sections: ReadonlyArray<SettingsSectionMeta> = SECTIONS): SettingsSectionMeta[][] {
  return sections.reduce<SettingsSectionMeta[][]>((groups, section) => {
    const last = groups[groups.length - 1];
    if (last && last[0]?.group === section.group) last.push(section);
    else groups.push([section]);
    return groups;
  }, []);
}
