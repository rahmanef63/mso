"use client";
/* Windows 11 taskbar — centered Start + search + per-window buttons, system
   tray clock on the right. Buttons drive the shared store (focus/minimize/
   restore), mirroring real taskbar click behavior.
   METRICS (learn.microsoft.com/windows/apps/design/iconography/app-icon-construction,
   100% scale): 48px bar (h-12), 40px buttons (size-10), 24px icons on that row
   (size-6). Every one was a size small — 36px buttons, 20px app icons, a 14px Start
   mark, a 16px Task View glyph — so the bar rendered ~90% beside a real Windows 11
   one. The search box is the exception: its magnifier went 14px → 16px (the system-
   glyph row), NOT 24px, because it is a LABELLED box and a 24px magnifier beside a
   12px label reads as a button whose caption fell off. */
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useEffect, useMemo, useState } from "react";
import { Search, LayoutGrid, ArrowUpRight, Minimize2, X, Settings, Lock } from "lucide-react";
import { useApps } from "../../../lib/registry";
import { useWindowOrder, useWindow, useWindowsMap, useFocused } from "../../../hooks/use-shell";
import type { AppDescriptor } from "../../../lib/types";
import { focusWindow, minimizeWindow, restoreWindow, closeWindow, toggleNotificationCenter, openWindow, toggleSpotlight } from "../../../lib/store";
import { lock } from "../../../lib/lock";
import { AppIcon } from "../../app-icon";
import { WindowPreview } from "../../window-preview";
import { ContextMenu, useContextMenu, type MenuItem } from "../context-menu";
import { ControlCenterDesktop } from "../../../features/control-center/components/control-center-desktop";
import { StartMenu } from "./start-menu";

export const TASKBAR_H = 48;

export function Taskbar({ onTaskView }: { onTaskView?: () => void }) {
  const [startOpen, setStartOpen] = useState(false);
  const order = useWindowOrder();
  const wins = useWindowsMap();
  const apps = useApps();
  // Pinned quick-launch (manifest `pinned` apps) sit before running windows;
  // a pinned+running app shows once, on its pin, so filter it out of `order`.
  const pinnedApps = useMemo(() => apps.filter((a) => a.pinned && !a.noDock), [apps]);
  const pinnedIds = useMemo(() => new Set(pinnedApps.map((a) => a.id)), [pinnedApps]);
  const runningApps = useMemo(() => new Set(Object.values(wins).map((w) => w.app)), [wins]);
  const tbMenu = useContextMenu();
  useEffect(() => {
    if (!startOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setStartOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [startOpen]);
  return (
    <>
      {startOpen && <StartMenu onClose={() => setStartOpen(false)} />}
      <div
        className="absolute inset-x-0 bottom-0 z-[60] flex h-12 items-center border-t border-border bg-[var(--mica-win,var(--card))] px-2 backdrop-blur-md font-[family-name:var(--shell-font)]"
        onContextMenu={(e) => { if (e.target === e.currentTarget) tbMenu.open(e); }}
      >
        <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1">
          <StartButton open={startOpen} onClick={() => setStartOpen((o) => !o)} onTaskView={onTaskView} />
          <Button type="button" variant="ghost"
            onClick={toggleSpotlight}
            className="h-auto p-0 font-normal hover:bg-transparent flex h-10 items-center gap-2 rounded-md border border-border bg-background/60 px-3 text-xs text-muted-foreground hover:bg-muted"
          >
            <Search className="size-4" /> Search
          </Button>
          {onTaskView && (
            <Button type="button" variant="ghost"
              onClick={onTaskView}
              title="Task View"
              aria-label="Task View"
              className="h-auto p-0 font-normal hover:bg-transparent grid size-10 place-items-center rounded-md hover:bg-muted"
            >
              <LayoutGrid className="size-6" />
            </Button>
          )}
          {pinnedApps.length > 0 && <span className="mx-1 h-6 w-px bg-border" />}
          {pinnedApps.map((app) => {
            const front = Object.values(wins).filter((w) => w.app === app.id).sort((a, b) => b.z - a.z)[0];
            return front ? <TaskButton key={app.id} id={front.id} compact /> : <PinnedApp key={app.id} app={app} running={runningApps.has(app.id)} />;
          })}
          {order.filter((id) => !pinnedIds.has(wins[id]?.app)).map((id) => (
            <TaskButton key={id} id={id} />
          ))}
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          <ControlCenterDesktop size={40} />
          <Clock />
        </div>
      </div>
      <ContextMenu
        pos={tbMenu.pos}
        onClose={tbMenu.close}
        items={[
          ...(onTaskView ? [{ label: "Task View", icon: LayoutGrid, onClick: onTaskView }] : []),
          { label: "Taskbar settings", icon: Settings, onClick: () => openWindow("os-settings", "Settings") },
        ]}
      />
    </>
  );
}

function StartButton({ open, onClick, onTaskView }: { open: boolean; onClick: () => void; onTaskView?: () => void }) {
  const menu = useContextMenu();
  const items: MenuItem[] = [
    { label: "Settings", icon: Settings, onClick: () => openWindow("os-settings", "Settings") },
    ...(onTaskView ? [{ label: "Task View", icon: LayoutGrid, onClick: onTaskView }] : []),
    { type: "sep" },
    { label: "Lock", icon: Lock, onClick: lock },
  ];
  return (
    <>
      <Button type="button" variant="ghost"
        onClick={onClick}
        onContextMenu={menu.open}
        aria-label="Start"
        className={cn(`h-auto p-0 font-normal hover:bg-transparent grid size-10 place-items-center rounded-md hover:bg-muted ${open ? "bg-muted" : ""}`)}
      >
        {/* 11px tiles + 2px gutter = a 24px mark. Tiles were 6px (size-1.5) → a 14px
            mark, so Start read as a speck between two 24px neighbours. */}
        <span className="grid grid-cols-2 gap-[2px]">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="size-[11px] rounded-[1px] bg-primary" />
          ))}
        </span>
      </Button>
      <ContextMenu pos={menu.pos} onClose={menu.close} items={items} />
    </>
  );
}

// Pinned quick-launch icon — click opens the app (or focuses the singleton via
// openWindow's reuse); a running app shows the accent underline like a taskbar tab.
function PinnedApp({ app, running }: { app: AppDescriptor; running: boolean }) {
  return (
    <Button type="button" variant="ghost"
      onClick={() => openWindow(app.id, app.title, app.defaultSize, undefined, { multi: app.multi })}
      title={app.title}
      aria-label={app.title}
      className={cn(`h-auto p-0 font-normal hover:bg-transparent relative grid size-10 place-items-center rounded-md hover:bg-muted ${running ? "bg-muted" : ""}`)}
    >
      <span className="size-6">
        <AppIcon app={app} />
      </span>
      <span
        className={cn(`absolute bottom-[1px] left-1/2 h-[2px] -translate-x-1/2 rounded-full bg-primary transition-all ${running ? "w-2 opacity-70" : "w-0 opacity-0"}`)}
      />
    </Button>
  );
}

function TaskButton({ id, compact = false }: { id: string; compact?: boolean }) {
  const win = useWindow(id);
  const focused = useFocused() === id;
  const apps = useApps();
  const menu = useContextMenu();
  if (!win) return null;
  const app = apps.find((a) => a.id === win.app);
  const active = focused && !win.minimized;
  const onClick = () => {
    if (win.minimized) restoreWindow(id);
    else if (focused) minimizeWindow(id);
    else focusWindow(id);
  };
  return (
    <>
      <div className="group/task relative">
        <Button type="button" variant="ghost"
          onClick={onClick}
          onContextMenu={menu.open}
          title={app?.title ?? win.title}
          aria-label={app?.title ?? win.title}
          className={cn(`h-auto p-0 font-normal hover:bg-transparent relative flex h-10 items-center gap-2 rounded-md px-2 hover:bg-muted ${active ? "bg-muted" : ""}`)}
        >
          {app && (
            <span className="size-6">
              <AppIcon app={app} />
            </span>
          )}
          {!compact && <span className="max-w-[120px] truncate text-xs">{win.title}</span>}
          <span
            className={cn(`absolute bottom-[1px] left-1/2 h-[2px] -translate-x-1/2 rounded-full bg-primary transition-all ${active ? "w-5" : "w-2 opacity-60"}`)}
          />
        </Button>
        {/* Win11-style hover flyout: a static <WindowPreview> floats above the
            taskbar button (open delay matches the OS' ~250 ms hover dwell via
            transition-delay). Uses the SAME primitive as the iOS switcher and
            Mission Control — Phase C consolidation. */}
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-[70] w-44 -translate-x-1/2 opacity-0 transition-opacity duration-150 delay-200 group-hover/task:opacity-100"
        >
          <WindowPreview winId={id} aspect="16/10" variant="minimal" />
        </div>
      </div>
      <ContextMenu
        pos={menu.pos}
        onClose={menu.close}
        items={[
          ...(app?.multi ? [{ label: "New window", onClick: () => openWindow(app.id, app.title, app.defaultSize, undefined, { multi: true }) }] : []),
          { label: win.minimized ? "Restore" : "Focus", icon: ArrowUpRight, onClick: () => (win.minimized ? restoreWindow(id) : focusWindow(id)) },
          { label: "Minimize", icon: Minimize2, disabled: win.minimized, onClick: () => minimizeWindow(id) },
          { type: "sep" },
          { label: "Close", icon: X, onClick: () => closeWindow(id) },
        ]}
      />
    </>
  );
}

// Clock doubles as the Notification Center toggle, like the real Win11 tray.
// h-10 like every other button in this bar: the tray sits on the same 40px row as
// Start and the task buttons, and at h-9 its hover pill was 4px shorter than its
// neighbours' — visible on hover as a step in the row. (ControlCenterDesktop, the
// other tray button, is still a 28px box and lives in another slice.)
function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  return (
    <Button type="button" variant="ghost"
      onClick={toggleNotificationCenter}
      aria-label="Notifications"
      className="h-auto p-0 font-normal hover:bg-transparent flex h-10 min-w-10 flex-col items-end justify-center gap-0 rounded-md px-2 text-[11px] leading-tight text-muted-foreground hover:bg-muted"
    >
      <span>{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      <span>{now.toLocaleDateString([], { day: "2-digit", month: "2-digit", year: "numeric" })}</span>
    </Button>
  );
}
