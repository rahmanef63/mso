import {
DatabaseBackup,
Info,
Link2,
Network,
Paintbrush,
Palette,
Plug,
Server,
ShieldCheck,
Sparkles,
Trash2,
} from "lucide-react";
import type { ComponentType } from "react";

export type SectionId =
  | "appearance"
  | "theme"
  | "ai"
  | "quicklinks"
  | "mcp"
  | "a2a"
  | "devices"
  | "server"
  | "cleanup"
  | "backup"
  | "about";
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
  {
    id: "appearance",
    label: "Appearance",
    blurb: "Style, accent, wallpaper, device",
    icon: Palette,
    color: "var(--primary)",
    group: "personalization",
  },
  {
    id: "theme",
    label: "Theme",
    blurb: "Mode, presets, font, contrast",
    icon: Paintbrush,
    color: "var(--primary)",
    group: "personalization",
  },
  {
    id: "ai",
    label: "AI",
    blurb: "Model and API key",
    icon: Sparkles,
    color: "var(--primary)",
    group: "services",
  },
  {
    id: "quicklinks",
    label: "Quicklink",
    blurb: "Website shortcuts with favicons",
    icon: Link2,
    color: "var(--primary)",
    group: "services",
  },
  {
    id: "mcp",
    label: "MCP",
    blurb: "Connect ChatGPT, Cursor & AI apps; manage access and activity",
    icon: Plug,
    color: "var(--primary)",
    group: "services",
  },
  {
    id: "a2a",
    label: "A2A",
    blurb: "Connect agents and review their tasks",
    icon: Network,
    color: "var(--primary)",
    group: "services",
  },
  {
    id: "devices",
    label: "Devices",
    blurb: "Approved browsers and sessions",
    icon: ShieldCheck,
    color: "var(--primary)",
    group: "system",
  },
  {
    id: "server",
    label: "Server",
    blurb: "Mock or live host data",
    icon: Server,
    color: "var(--primary)",
    group: "system",
  },
  {
    id: "cleanup",
    label: "Cleanup",
    blurb: "Free disk space safely",
    icon: Trash2,
    color: "var(--primary)",
    group: "system",
  },
  {
    id: "backup",
    label: "Backup",
    blurb: "Export or restore browser data",
    icon: DatabaseBackup,
    color: "var(--primary)",
    group: "system",
  },
  {
    id: "about",
    label: "About",
    blurb: "System info and reset",
    icon: Info,
    color: "var(--primary)",
    group: "system",
  },
];

export function settingsSection(id: SectionId): SettingsSectionMeta {
  return SECTIONS.find((section) => section.id === id)!;
}

export function filterSettingsSections(
  query: string,
): ReadonlyArray<SettingsSectionMeta> {
  const q = query.trim().toLowerCase();
  if (!q) return SECTIONS;
  return SECTIONS.filter((section) =>
    `${section.label} ${section.blurb}`.toLowerCase().includes(q),
  );
}

export function groupSettingsSections(
  sections: ReadonlyArray<SettingsSectionMeta> = SECTIONS,
): SettingsSectionMeta[][] {
  return sections.reduce<SettingsSectionMeta[][]>((groups, section) => {
    const last = groups[groups.length - 1];
    if (last && last[0]?.group === section.group) last.push(section);
    else groups.push([section]);
    return groups;
  }, []);
}
