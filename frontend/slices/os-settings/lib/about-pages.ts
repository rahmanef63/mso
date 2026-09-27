import type { SettingsBreadcrumb } from "@/features/shell-settings";

export const ABOUT_PAGES = [
  { id: "version", title: "Version", description: "App version, build id, and the commit this server is running." },
  { id: "updates", title: "Updates", description: "Check for a software update and apply it on this host." },
  { id: "whats-new", title: "What's new", description: "Changes already shipped to this deployment." },
  { id: "maintenance", title: "Maintenance", description: "Guided setup and reset tools." },
] as const;

export type AboutPage = "overview" | (typeof ABOUT_PAGES)[number]["id"];

const PAGE_ALIASES: Record<string, AboutPage> = { update: "updates" };

export function aboutPageFromSearch(value: string | null): AboutPage {
  if (!value) return "overview";
  const id = PAGE_ALIASES[value] ?? value;
  return ABOUT_PAGES.some((page) => page.id === id) ? (id as AboutPage) : "overview";
}

/** Deep link `?section=about` stays the overview. `page` selects a nested detail. */
export function initialAboutPage(section: string | null, page: string | null): AboutPage {
  return section === "about" ? aboutPageFromSearch(page) : "overview";
}

export function aboutBreadcrumbs(
  page: AboutPage,
  actions: { onAccount?: () => void; onAbout: () => void },
): SettingsBreadcrumb[] | undefined {
  if (page === "overview") return undefined;
  const title = ABOUT_PAGES.find((item) => item.id === page)?.title ?? "About";
  const items: SettingsBreadcrumb[] = [];
  if (actions.onAccount) items.push({ label: "Account", onSelect: actions.onAccount });
  items.push({ label: "About", onSelect: actions.onAbout }, { label: title });
  return items;
}
