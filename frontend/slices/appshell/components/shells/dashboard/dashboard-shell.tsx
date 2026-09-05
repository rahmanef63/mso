"use client";
/* Dashboard shell — a single-pane cockpit surface (no floating windows):
   sidebar + breadcrumb + content. Lives in the appshell FRAMEWORK (converged to
   the rr shape) and stays brand-free: brand via useBrand(), host stats via the
   injected useSystemStats capability — no project @/lib coupling. It DRIVES the
   shared window store: launching calls openWindow, the pane shows the focused
   (or newest non-minimized) window via <WindowContent>, Home minimizes it — so
   UrlSync deep links work here and open windows (with their payloads) carry over
   intact when switching to the macOS/Windows/mobile shells. */
import { useMemo, useState } from "react";
import { useUrlHome } from "../../../hooks/use-url-home";
import { LayoutDashboard, Home, Search } from "lucide-react";
import { useBrand } from "../../../registry/brand";
import { useApps } from "../../../lib/registry";
import { useWindowOrder, useFocused, useWindow, useWindowsMap } from "../../../hooks/use-shell";
import { shellStore, openWindow, minimizeWindow, focusApp, closeWindow } from "../../../lib/store";
import { WindowContent } from "../../window-content";
import { ShellContextMenu, useShellContextMenu } from "../context-menu";
import { useInspectorInfo } from "../../../lib/inspector";
import { ResponsiveToolbar } from "../../../primitives/responsive-toolbar";
import { ControlCenterDesktop } from "../../../features/control-center/components/control-center-desktop";
import type { AppDescriptor } from "../../../lib/types";
import { DashboardHome, NavItem, SidebarLabel } from "./dashboard-parts";

function DashboardShell() {
  const brand = useBrand();
  const allApps = useApps();
  const apps = allApps.filter((a) => !a.noDock);
  const [q, setQ] = useState("");
  const menu = useShellContextMenu("dashboard");
  const filtered = useMemo(
    () => apps.filter((a) => a.title.toLowerCase().includes(q.toLowerCase())),
    [apps, q],
  );

  // URL → view, same derivation as the mobile shell: a pathname naming an app
  // slug shows the app pane (UrlSync opens/focuses its window in the shared
  // store), anything else shows Home. User gestures override, keyed to the
  // pathname they were made at, so the derivation wins again when the URL
  // actually changes — no effect-driven setState.
  const { home, setHome } = useUrlHome(allApps);

  // The pane shows the FOCUSED window — fall back to the newest non-minimized
  // one (`order` is append-only and doesn't track focus).
  const order = useWindowOrder();
  const focused = useFocused();
  const topId =
    focused && !shellStore.getWindow(focused)?.minimized
      ? focused
      : ([...order].reverse().find((id) => !shellStore.getWindow(id)?.minimized) ?? null);
  const top = useWindow(topId ?? "__none__"); // reactive: re-renders on the active window's payload/title changes
  // Which apps have a window open. Built here with useMemo and NOT as a store
  // hook: getSnapshot must return a referentially stable value, so a hook handing
  // back a fresh Set would re-render forever. Same derivation the Windows taskbar
  // uses. Minimized counts as running, matching the macOS dock.
  const winMap = useWindowsMap();
  const runningApps = useMemo(
    () => new Set(order.map((id) => winMap[id]?.app).filter((app): app is string => Boolean(app))),
    [order, winMap],
  );
  const pane = !home && top ? top : null;
  // The focused app's live actions (Refresh, Clear, Render…) — the same inspector
  // bus the macOS menu + mobile ••• sheet use. Dashboard had no path to invoke them.
  const paneActions = useInspectorInfo(pane?.app)?.actions ?? [];

  // SSOT navigation: open / resume bring a window to the front; Home minimizes.
  // Focus-first, exactly like the dock: a sidebar entry for a RUNNING app is a
  // place to go back to, not a second instance to spawn. This mattered once the
  // Running list went away — before, clicking Files (the only `multi` app) opened
  // a fresh window every single time and the list was the only route back to an
  // existing one, so a dot saying "running" over a click that spawns would have
  // been a lie. A second Files window is still one gesture away: the dock's "New
  // Window" entry and the right-click "New Files window".
  const launch = (app: AppDescriptor) => {
    if (!focusApp(app.id)) openWindow(app.id, app.title, app.defaultSize, undefined, { multi: app.multi });
    setHome(false);
  };
  // The Dashboard's only per-window close affordance. Everything else that can
  // close ONE window (window chrome, tabs, Mission Control, dock Quit, taskbar) is
  // mounted by other shells; here only "close all" survived, so dropping the
  // Running list without this would have removed closing from the surface.
  const closeApp = (appId: string) => {
    for (const id of order.filter((winId) => winMap[winId]?.app === appId)) closeWindow(id);
  };
  const goHome = () => {
    if (topId) minimizeWindow(topId);
    setHome(true);
  };
  return (
    <div
      className="absolute inset-0 z-[10] flex bg-background/85 backdrop-blur-xl"
      // Right-click opens the dashboard menu everywhere on the chrome (sidebar,
      // header, empty Home) — only an OPEN app's pane content keeps its own
      // right-click. (Was <main>-only + `!pane`, so the sidebar never worked.)
      onContextMenu={(e) => {
        if (!(pane && (e.target as HTMLElement).closest("[data-dashboard-main]"))) menu.open(e);
      }}
    >
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card/50">
        <div className="flex h-14 shrink-0 items-center gap-2 px-3 text-sm font-semibold">
          <LayoutDashboard className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate">{brand.name}</span>
          <div><ControlCenterDesktop /></div>
        </div>

        <div className="flex flex-col gap-0.5 px-2">
          <NavItem active={!pane} onClick={goHome} icon={<Home className="size-4 shrink-0" />} label="Home" />
        </div>

        <SidebarLabel>Apps</SidebarLabel>
        <div className="px-2 pb-1.5">
          <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter apps"
              className="w-full bg-transparent text-sm outline-none"
            />
          </div>
        </div>
        <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto px-2 pb-3">
          {filtered.map((a) => (
            <NavItem
              key={a.id}
              active={pane?.app === a.id}
              running={runningApps.has(a.id)}
              onClick={() => launch(a)}
              onClose={() => closeApp(a.id)}
              // The app's own glyph, not its gradient tile. At a 20px row every layer
              // that earns the tile its keep — the 6% sheen, the 1px hairline, the
              // drop shadow, a glyph at 52% of the box — either disappears or turns to
              // smudge, and the colour discriminates nothing in a list where a whole
              // agent's features share one hue. A bare glyph is also what every other
              // sidebar here uses, including the Home row directly above.
              icon={<a.icon className="size-4 shrink-0" />}
              label={a.title}
            />
          ))}
          {filtered.length === 0 && (
            <div className="px-2.5 py-2 text-xs text-muted-foreground">No apps</div>
          )}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-5 text-sm">
          <button onClick={goHome} className="text-muted-foreground transition-colors hover:text-foreground">Home</button>
          {pane && (
            <>
              <span className="text-muted-foreground/50">/</span>
              <span className="font-medium">{pane.title}</span>
            </>
          )}
          {pane && paneActions.length > 0 && (
            <div className="ml-auto">
              <ResponsiveToolbar
                items={paneActions.map((a) => ({ id: a.id, label: a.label, onClick: () => void a.run() }))}
              />
            </div>
          )}
        </header>
        {/* container context is REQUIRED: app @container styles never match without it.
            Right-click the Home view opens the (registry-driven) dashboard menu;
            inside an open app the native right-click is left alone. */}
        <main
          data-dashboard-main
          className="min-h-0 flex-1 overflow-hidden [container-type:inline-size]"
        >
          {pane ? (
            <WindowContent key={pane.id} app={pane.app} payload={pane.payload} winId={pane.id} />
          ) : (
            <DashboardHome apps={apps} onOpenApp={launch} />
          )}
        </main>
      </div>
      <ShellContextMenu state={menu.state} onClose={menu.close} />
    </div>
  );
}

export { DashboardShell };
