// Pure view logic for the AppDeck overview and detail drawer. No fetch, no
// runes: everything here is a function of already-loaded state, so the tab
// counts, filters and two-step confirmations can be unit tested without a DOM.

export type OverviewTab = "all" | "running" | "installed" | "available";

export const OVERVIEW_TABS: readonly { id: OverviewTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "installed", label: "Installed" },
  { id: "available", label: "Available" },
];

export type Tone = "ok" | "danger" | "warn" | "neutral";

type AppLike = {
  id: string;
  name: string;
  description: string;
  installed: boolean;
  state: string;
  healthy: boolean | null;
  version: string | null;
  installationType: string;
  diagnostic: string | null;
};

export function appTone(app: Pick<AppLike, "state" | "healthy">): Tone {
  if (app.state === "running" && app.healthy !== false) return "ok";
  if (app.state === "unhealthy" || app.state === "error" || app.healthy === false) return "danger";
  if (app.state === "starting") return "warn";
  return "neutral";
}

export function isRunning(app: Pick<AppLike, "installed" | "state">): boolean {
  return app.installed && (app.state === "running" || app.state === "starting");
}

export function matchesTab(app: Pick<AppLike, "installed" | "state">, tab: OverviewTab): boolean {
  if (tab === "all") return true;
  if (tab === "running") return isRunning(app);
  if (tab === "installed") return app.installed;
  return !app.installed;
}

export function filterApps<T extends AppLike>(apps: readonly T[], tab: OverviewTab, query: string): T[] {
  const needle = query.trim().toLowerCase();
  return apps.filter((app) => {
    if (!matchesTab(app, tab)) return false;
    if (!needle) return true;
    return `${app.name} ${app.id} ${app.state} ${app.installationType} ${app.version ?? ""} ${app.description}`
      .toLowerCase()
      .includes(needle);
  });
}

export function tabCounts(apps: readonly Pick<AppLike, "installed" | "state">[]): Record<OverviewTab, number> {
  return {
    all: apps.length,
    running: apps.filter((app) => isRunning(app)).length,
    installed: apps.filter((app) => app.installed).length,
    available: apps.filter((app) => !app.installed).length,
  };
}

export type TunnelsSummary = { total: number; active: number };

export function tunnelsSummary(tunnels: readonly { active: boolean }[]): TunnelsSummary {
  return { total: tunnels.length, active: tunnels.filter((t) => t.active).length };
}

export function tunnelsLabel(summary: TunnelsSummary, sshAvailable: boolean): string {
  if (!sshAvailable) return "SSH tunnels unavailable on this host";
  if (summary.total === 0) return "No SSH tunnels configured";
  return `${summary.active} of ${summary.total} SSH tunnels active`;
}

/** Destructive lifecycle actions need a second click, and the intent must not
 *  survive a different app being selected. Keyed by `${appId}:${action}` so a
 *  stale confirmation can never fire against another app. */
export type PendingConfirm = { key: string; action: string; label: string };

export function confirmKey(appId: string, action: string): string {
  return `${appId}:${action}`;
}

export const DESTRUCTIVE_ACTIONS: Record<string, string> = {
  stop: "Confirm stop",
  uninstall: "Confirm uninstall",
};

export function isDestructive(action: string): boolean {
  return Object.prototype.hasOwnProperty.call(DESTRUCTIVE_ACTIONS, action);
}

/** The lifecycle buttons a card or drawer offers, derived from the host's own
 *  `supportedActions` rather than guessed from state: the manager is the side
 *  that knows which verbs the running backend implements. */
export function lifecycleActions(app: Pick<AppLike, "installed" | "state">, supported: readonly string[]): {
  start: boolean; stop: boolean; restart: boolean; backup: boolean;
} {
  const can = (action: string) => supported.includes(action);
  return {
    start: app.installed && !isRunning(app),
    stop: isRunning(app),
    restart: app.installed,
    backup: app.installed && can("backup"),
  };
}

/** Job log tails are capped for the pane; the route already caps at 100 lines,
 *  this keeps a pathological stdout from owning the scroll container. */
export const LOG_LINE_CAP = 200;

export function joinLogEntries(entries: readonly string[]): string {
  return entries.slice(-LOG_LINE_CAP).join("\n");
}

export function lastLine(text: string): string {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.at(-1)?.trim() ?? "";
}

export function fmtBytes(bytes: number | null): string {
  if (bytes === null) return "size unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function fmtStamp(value: string | null): string {
  if (!value) return "unknown";
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? value : at.toLocaleString();
}

export function jobTone(status: string): Tone {
  if (status === "succeeded") return "ok";
  if (status === "failed") return "danger";
  if (status === "running" || status === "queued") return "warn";
  return "neutral";
}

export const ACTIVE_JOB_STATUSES = new Set(["queued", "running"]);

export function hasActiveJob(jobs: readonly { status: string }[]): boolean {
  return jobs.some((job) => ACTIVE_JOB_STATUSES.has(job.status));
}
