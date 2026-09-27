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
  UserRound,
} from "lucide-react";
import type { ComponentType } from "react";

export type SectionId =
  | "account"
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

type SectionFields = Omit<SettingsSectionMeta, "id">;

const CATALOG: Record<SectionId, SectionFields> = {
  account: {
    label: "Account",
    blurb: "Name, icon, password, devices, and about",
    icon: UserRound,
    color: "var(--primary)",
    group: "personalization",
  },
  appearance: {
    label: "Appearance",
    blurb: "Style, accent, wallpaper, device",
    icon: Palette,
    color: "var(--primary)",
    group: "personalization",
  },
  theme: {
    label: "Theme",
    blurb: "Mode, presets, font, contrast",
    icon: Paintbrush,
    color: "var(--primary)",
    group: "personalization",
  },
  ai: {
    label: "AI",
    blurb: "Model and API key",
    icon: Sparkles,
    color: "var(--primary)",
    group: "services",
  },
  quicklinks: {
    label: "Quicklink",
    blurb: "Website shortcuts with favicons",
    icon: Link2,
    color: "var(--primary)",
    group: "services",
  },
  mcp: {
    label: "MCP",
    blurb: "Connect ChatGPT, Cursor & AI apps; manage access and activity",
    icon: Plug,
    color: "var(--primary)",
    group: "services",
  },
  a2a: {
    label: "A2A",
    blurb: "Connect agents and review their tasks",
    icon: Network,
    color: "var(--primary)",
    group: "services",
  },
  devices: {
    label: "Devices",
    blurb: "Approved browsers and sessions",
    icon: ShieldCheck,
    color: "var(--primary)",
    group: "system",
  },
  server: {
    label: "Server",
    blurb: "Mock or live host data",
    icon: Server,
    color: "var(--primary)",
    group: "system",
  },
  cleanup: {
    label: "Cleanup",
    blurb: "Free disk space safely",
    icon: Trash2,
    color: "var(--primary)",
    group: "system",
  },
  backup: {
    label: "Backup",
    blurb: "Export or restore browser data",
    icon: DatabaseBackup,
    color: "var(--primary)",
    group: "system",
  },
  about: {
    label: "About",
    blurb: "System info and reset",
    icon: Info,
    color: "var(--primary)",
    group: "system",
  },
};

const NAV_ORDER: readonly SectionId[] = [
  "account",
  "appearance",
  "theme",
  "ai",
  "quicklinks",
  "mcp",
  "a2a",
  "server",
  "cleanup",
  "backup",
];

const SEARCH_EXTRA: Partial<Record<SectionId, string>> = {
  account: "devices approved browsers sessions about system info reset rename password icon",
};

function meta(id: SectionId): SettingsSectionMeta {
  return { id, ...CATALOG[id] };
}

/** Top-level Settings navigation. Devices and About are opened from Account. */
export const SECTIONS: ReadonlyArray<SettingsSectionMeta> = NAV_ORDER.map(meta);

export function settingsSection(id: SectionId): SettingsSectionMeta {
  return meta(id);
}

export function sectionFromSearch(value: string | null): SectionId | undefined {
  if (value === "devices" || value === "about") return value;
  return SECTIONS.find((section) => section.id === value)?.id;
}

export function settingsNavActive(id: SectionId, active: SectionId): boolean {
  return id === active || (id === "account" && (active === "devices" || active === "about"));
}

export function settingsBackTarget(active: SectionId): SectionId | null {
  return active === "devices" || active === "about" ? "account" : null;
}

export function filterSettingsSections(query: string): ReadonlyArray<SettingsSectionMeta> {
  const q = query.trim().toLowerCase();
  if (!q) return SECTIONS;
  return SECTIONS.filter((section) =>
    `${section.label} ${section.blurb} ${SEARCH_EXTRA[section.id] ?? ""}`.toLowerCase().includes(q),
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
