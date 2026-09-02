"use client";

import { useCallback, useSyncExternalStore } from "react";
import { effectiveServerTarget, selectServerTarget, useAppearance } from "@/lib/appearance";
import { useOsApi } from "@/features/appshell";
import { IS_DEMO } from "@/lib/demo";
import { faviconUrl, openQuicklink, useQuicklinks } from "@/lib/quicklinks";
import { openWindow, type ShellCapabilities, type SystemStats } from "@/features/appshell";

// Polls `poll` every `ms`, but only fires while the tab is visible (a hidden
// cockpit shouldn't keep hammering its own VPS), and refreshes immediately when
// the tab is shown again. Returns the cleanup. The interval ticks regardless but
// no-ops cheaply when hidden — no network calls in the background.
function startVisiblePoll(poll: () => void, ms: number): () => void {
  const tick = () => {
    if (typeof document === "undefined" || !document.hidden) poll();
  };
  tick();
  const t = setInterval(tick, ms);
  const onVis = () => {
    if (!document.hidden) poll();
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);
  return () => {
    clearInterval(t);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis);
  };
}

// ── Shared Today-telemetry poller ──────────────────────────────────────────
// One poll for ALL Today widgets (was one 3s poll PER widget → N pollers
// hammering the VPS behind an open app). Ref-counted: starts on the first
// subscriber, stops on the last; restarts if the injected api changes.
let statsState: SystemStats | null = null;
const statsSubs = new Set<() => void>();
const statsHist: { cpu: number[]; net: number[] } = { cpu: [], net: [] };
let statsStop: (() => void) | null = null;
let statsApi: ReturnType<typeof useOsApi> | null = null;

function startSharedStats(api: ReturnType<typeof useOsApi>) {
  if (statsStop && statsApi === api) return;
  if (statsStop) statsStop(); // api changed → restart with the new adapter
  statsApi = api;
  // Disk usage does not move in 3 seconds, and fs.usage() shells out to the host —
  // so it refreshes every 10th tick (~30s) and is cached in between. sys.stats()
  // still runs every tick; that's what the sparklines consume.
  let usageCache: Awaited<ReturnType<typeof api.fs.usage>> | null = null;
  let tickN = 0;
  const poll = async () => {
    try {
      const needUsage = usageCache === null || tickN % 10 === 0;
      tickN += 1;
      const [sys, usage] = await Promise.all([
        api.sys.stats(),
        needUsage ? api.fs.usage() : Promise.resolve(usageCache!),
      ]);
      usageCache = usage;
      const cpuPct = Math.round(sys.cpu.pct);
      statsHist.cpu = [...statsHist.cpu.slice(-23), cpuPct];
      if (sys.net) statsHist.net = [...statsHist.net.slice(-23), sys.net.rx + sys.net.tx];
      statsState = {
        cpu: { pct: cpuPct, cores: sys.cpu.cores },
        mem: { used: sys.mem.used, total: sys.mem.total },
        disk: { used: usage.used, total: usage.total },
        net: sys.net,
        uptime: sys.uptime,
        cpuHistory: statsHist.cpu,
        netHistory: statsHist.net,
      };
      statsSubs.forEach((l) => l());
    } catch {
      /* leave last value */
    }
  };
  statsStop = startVisiblePoll(poll, 3000);
}

// The ONE subscription to the shared poller. Both the menu-bar CPU chip and the Today
// widgets read from it. The chip used to run a second, private 4s poller against the
// same sys.stats endpoint — and since the widget stack defaults ON, a default desktop
// ran both (~55 req/min against one endpoint, each re-reading auth-devices.json).
function useSharedStats(): SystemStats | null {
  const api = useOsApi();
  const subscribe = useCallback(
    (l: () => void) => {
      statsSubs.add(l);
      startSharedStats(api);
      return () => {
        statsSubs.delete(l);
        if (statsSubs.size === 0 && statsStop) {
          statsStop();
          statsStop = null;
          statsApi = null;
        }
      };
    },
    [api],
  );
  return useSyncExternalStore(subscribe, () => statsState, () => null);
}

// Adapts mso's appearance store + host API + AI stream to the generic AppShell
// capability contract, so `appshell` AND its feature slices carry NO dependency on
// @/lib/*. These run inside os-root's AppearanceProvider + OsApiProvider (AppShell
// is nested below them).
export const topsideCapabilities: ShellCapabilities = {
  useAppearance: () => {
    const { tweaks, setTweaks } = useAppearance();
    return {
      theme: tweaks.theme,
      setTheme: (t) => setTweaks({ theme: t }),
      device: tweaks.device,
      wallpaper: tweaks.wallpaper,
      wallpaperStyle: tweaks.wallpaperStyle,
      // Live wallpaper (TSX id or sandboxed HTML) — structurally identical to
      // the shell's LiveWallpaperValue, passes straight through.
      liveWallpaper: tweaks.liveWallpaper,
    };
  },
  useCpuPercent: () => useSharedStats()?.cpu.pct ?? null,
  // Spotlight folder search → ready-to-run hits that open Files at the path.
  // MUST be a stable callback — Spotlight keys its debounce effect on this fn's
  // identity, so a fresh closure each render would spin an endless search loop.
  useSearch: () => {
    const api = useOsApi();
    return useCallback(
      async (query: string) =>
        (await api.fs.search(query)).map((h) => ({
          id: `dir:${h.path}`,
          label: h.name,
          hint: "Folder",
          // Files is multi-instance — each folder hit opens its own window.
          run: () => openWindow("files-manager", h.name, undefined, { path: h.path }, { multi: true }),
        })),
      [api],
    );
  },
  // Today-widget telemetry — sys.stats + fs.usage. All widgets share ONE poll
  // (the module-level shared poller above) instead of each spinning its own.
  useSystemStats: () => useSharedStats(),
  // Scoped Alfa chat — the wire stream passes straight through.
  // Control-center server-mode tile (mock|live; locked + relabelled in demo).
  useServerToggle: () => {
    const { tweaks, setTweaks } = useAppearance();
    const active = effectiveServerTarget(tweaks.server, IS_DEMO);
    const live = active?.kind === "local";
    return {
      live,
      label: IS_DEMO ? "Mock · demo" : active?.kind === "ssh" ? active.label : live ? "Live" : "Mock",
      locked: IS_DEMO,
      toggle: () =>
        setTweaks({
          server: selectServerTarget(tweaks.server, live ? "mock" : "vps"),
        }),
    };
  },
  // Website shortcuts (Settings → Quicklink) for the dock / Launchpad / mobile
  // grid / Today widget. Open pops a new native tab (the user's chosen mode).
  useQuickLinks: () => {
    const { items } = useQuicklinks();
    return { items, open: openQuicklink, faviconUrl };
  },
};
