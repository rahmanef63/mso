// Multi-tab workspace state for the terminal slice. Pure functions so the tab
// rules stay testable without a DOM; ids are monotonic and never reused.
export type Tab = {
  id: number;
  title: string;
  sessionId: string | null;
  cwd: string | undefined;
};

export const MAX_TABS = 8;
export const DEFAULT_TAB_TITLE = "Terminal";
const MIN_TITLE = 1;
const MAX_TITLE = 40;

export function createTab(id: number, cwd?: string): Tab {
  return { id, title: id === 1 ? DEFAULT_TAB_TITLE : `${DEFAULT_TAB_TITLE} ${id}`, sessionId: null, cwd };
}

export function nextTabNumber(tabs: Tab[]): number {
  return tabs.reduce((max, tab) => Math.max(max, tab.id), 0) + 1;
}

export function addTab(tabs: Tab[], cwd?: string): { tabs: Tab[]; activeId: number | null } {
  if (tabs.length >= MAX_TABS) return { tabs, activeId: null };
  const id = nextTabNumber(tabs);
  return { tabs: [...tabs, createTab(id, cwd)], activeId: id };
}

/** Closing the last tab reopens a fresh one so the workspace is never empty. */
export function closeTab(tabs: Tab[], id: number, cwd?: string): { tabs: Tab[]; activeId: number | null } {
  const index = tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return { tabs, activeId: null };
  const remaining = tabs.filter((tab) => tab.id !== id);
  if (remaining.length === 0) {
    const fresh = createTab(nextTabNumber(tabs), cwd);
    return { tabs: [fresh], activeId: fresh.id };
  }
  const neighbour = remaining[Math.min(index, remaining.length - 1)];
  return { tabs: remaining, activeId: neighbour.id };
}

/** Blank or over-long titles fall back to the default, trimmed to a usable width. */
export function sanitizeTitle(raw: string, fallback: string): string {
  const cleaned = raw.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
  return cleaned.length < MIN_TITLE ? fallback : cleaned;
}

export function renameTab(tabs: Tab[], id: number, raw: string): Tab[] {
  return tabs.map((tab) => (tab.id === id ? { ...tab, title: sanitizeTitle(raw, tab.title) } : tab));
}

export function bindSession(tabs: Tab[], id: number, sessionId: string | null): Tab[] {
  return tabs.map((tab) => (tab.id === id ? { ...tab, sessionId } : tab));
}

export type TabStatus = "connected" | "connecting" | "disconnected" | "error";

/** Collapse the controller's five states onto the four the tab strip shows. */
export function tabStatus(status: "idle" | "connecting" | "connected" | "closed" | "error"): TabStatus {
  if (status === "connected") return "connected";
  if (status === "connecting") return "connecting";
  if (status === "error") return "error";
  return "disconnected";
}

export function statusLabel(status: TabStatus): string {
  if (status === "connected") return "Connected";
  if (status === "connecting") return "Connecting";
  if (status === "error") return "Error";
  return "Disconnected";
}
