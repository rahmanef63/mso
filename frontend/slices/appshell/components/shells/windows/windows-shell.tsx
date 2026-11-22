"use client";
/* Windows 11 desktop shell — same window store + apps + feature slots as macOS,
   only the chrome differs (centered taskbar + Start instead of menu bar + dock,
   caption-button windows instead of traffic lights). Drives the SHARED store;
   it never forks window state. Sets a bottom taskbar inset so snap/maximize tile
   above the taskbar (macOS dock inset is restored on unmount). */
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { LayoutGrid, Minimize2, Maximize2 } from "lucide-react";
import { useWindowOrder, useWindowsMap } from "../../../hooks/use-shell";
import { useOverviewKey } from "../../../hooks/use-overview-key";
import { Slot } from "../../../registry/feature-registry";
import { useShellAppearance } from "../../../registry/capabilities";
import { shellStore, stackByZ, minimizeAll, restoreWindow, applyChromeInsets } from "../../../lib/store";
import { Window } from "../../window";
import { AppSwitcher } from "../../app-switcher";
import { NotificationCenter } from "../../notification-center";
import { WindowOverview } from "../window-overview";
import { ForceQuitDialog } from "../../../features/force-quit/force-quit";
import { DesktopIcons, useDesktopMarquee } from "../../../features/desktop-icons";
import { ShellContextMenu, useShellContextMenu, type MenuItem } from "../context-menu";
import { Taskbar, TASKBAR_H } from "./taskbar";
import { SnapAssist } from "./snap-assist";
import { RunDialog } from "./run-dialog";
import { inEditable } from "../../../lib/use-focused-hotkey";

function WindowsShell() {
  const order = useWindowOrder();
  const winMap = useWindowsMap();
  const stacked = useMemo(() => stackByZ(order, winMap), [order, winMap]);
  const [taskView, setTaskView] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const menu = useShellContextMenu("windows");
  const marquee = useDesktopMarquee();
  const interactive = !!useShellAppearance().liveWallpaper?.interactive;
  useOverviewKey(() => setTaskView((v) => !v)); // F3 toggles Task View, parity with macOS Mission Control
  useEffect(() => {
    applyChromeInsets({ top: 0, bottom: TASKBAR_H });
    return () => applyChromeInsets({}); // restore macOS insets + re-tile snapped windows
  }, []);
  // Win+R (Ctrl+R fallback) opens the Run dialog; ignored while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // !shiftKey so Ctrl+Shift+R (hard reload) still works; only plain Win/Ctrl+R opens Run.
      if (!((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "r")) return;
      if (inEditable(e.target)) return;
      e.preventDefault();
      setRunOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const baseItems: MenuItem[] = [
    { label: "Task View", icon: LayoutGrid, onClick: () => setTaskView(true) },
    { type: "sep" },
    { label: "Show all windows", icon: Maximize2, disabled: order.length === 0, onClick: () => order.forEach((id) => shellStore.getWindow(id)?.minimized && restoreWindow(id)) },
    { label: "Minimize all", icon: Minimize2, disabled: order.length === 0, onClick: () => minimizeAll() },
  ];
  return (
    <>
      {/* The window layer also carries the desktop right-click (only when the
          click lands on the bare section, not a window OR a desktop widget). When
          an interactive live wallpaper is active it goes click-through so the
          wallpaper gets empty-desktop clicks; windows stay interactive. */}
      <section
        id="shell-main"
        role="main"
        tabIndex={-1}
        className={cn("absolute inset-0 z-[10]", interactive && "pointer-events-none [&>*]:pointer-events-auto")}
        // Any right-click not inside a window opens the desktop menu (icons/widgets
        // stopPropagation; windows carry [data-window]). Generalizes the old strict
        // target===currentTarget guard that missed background-descendant targets.
        onContextMenu={(e) => { if (!(e.target as HTMLElement).closest("[data-window]")) menu.open(e, baseItems); }}
        onPointerDown={marquee.onPointerDown}
      >
        {/* Icons + widgets sit inside the section (behind windows) so their own
            right-click / drag beats the desktop menu + marquee (bare surface only). */}
        <DesktopIcons />
        <Slot region="desktopWidgets" />
        {marquee.rect && (
          <div
            className="pointer-events-none absolute z-[6] rounded-sm border border-primary bg-primary/15"
            style={{ left: marquee.rect.x, top: marquee.rect.y, width: marquee.rect.w, height: marquee.rect.h }}
          />
        )}
        {stacked.map((id) => (
          <Window key={id} id={id} variant="windows" />
        ))}
      </section>
      <Slot region="rightPanel" />
      <NotificationCenter />
      <AppSwitcher />
      <SnapAssist />
      <Taskbar onTaskView={() => setTaskView((v) => !v)} />
      {taskView && <WindowOverview onClose={() => setTaskView(false)} label="Task View" />}
      {runOpen && <RunDialog onClose={() => setRunOpen(false)} />}
      <ForceQuitDialog />
      <ShellContextMenu state={menu.state} onClose={menu.close} />
    </>
  );
}

export { WindowsShell };
