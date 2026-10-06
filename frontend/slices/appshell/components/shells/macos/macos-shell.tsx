"use client";

import "./macos-shell.css";

// The macOS chrome — menu bar, desktop surface + window layer, dock, launcher,
// Mission Control. Split out of desktop.tsx so it can be React.lazy()'d in
// register-shells.tsx: it used to sit in the same module as Surface, which put
// every byte of it (and, through the same file, the whole iOS shell) in the
// first-load chunk of every visitor regardless of which shell they resolve to.

import { useMemo, useState } from "react";
import { Grid3x3, Minimize2, Maximize2, X } from "lucide-react";
import { useWindowOrder, useWindowsMap } from "../../../hooks/use-shell";
import { useOverviewKey } from "../../../hooks/use-overview-key";
import {
  stackByZ,
  shellStore,
  minimizeAll,
  restoreWindow,
  closeAll,
} from "../../../lib/store";
import { MenuBar } from "../../menu-bar";
import { Dock } from "../../dock";
import { AppLauncher } from "../../app-launcher";
import { HotCorners } from "../../hot-corners";
import { Window } from "../../window";
import { NotificationCenter } from "../../notification-center";
import { AppSwitcher } from "../../app-switcher";
import { WindowOverview } from "../window-overview";
import { ShellContextMenu, useShellContextMenu, type MenuItem } from "../context-menu";
import { Slot } from "../../../registry/feature-registry";
import { useShellAppearance } from "../../../registry/capabilities";
import { ForceQuitDialog } from "../../../features/force-quit/force-quit";
import { DesktopIcons, useDesktopMarquee } from "../../../features/desktop-icons";
import { TOPBAR } from "../../../lib/store-geometry";
import { cn } from "@/lib/utils";

export function DesktopChrome() {
  const order = useWindowOrder();
  const winMap = useWindowsMap();
  // Paint windows in z-order (focus recency) so the visible stack matches the
  // store's MRU — unfocused windows share one CSS z tier, so DOM order is the
  // tiebreak. winMap re-identifies on any window patch (incl. focus z bump).
  const stacked = useMemo(() => stackByZ(order, winMap), [order, winMap]);
  const [overview, setOverview] = useState(false);
  const menu = useShellContextMenu("macos");
  const marquee = useDesktopMarquee();
  // An interactive live wallpaper needs empty-desktop clicks to reach it: the
  // window layer goes transparent to hit-testing, its windows stay clickable.
  const interactive = !!useShellAppearance().liveWallpaper?.interactive;
  useOverviewKey(() => setOverview(true));
  // Built-in items — passed at open time so they read current state. Registry
  // items (consumer/app, dynamic per shell) merge after these.
  const baseItems: MenuItem[] = [
    { label: "Mission Control", icon: Grid3x3, onClick: () => setOverview(true) },
    { type: "sep" },
    { label: "Show all windows", icon: Maximize2, disabled: order.length === 0, onClick: () => order.forEach((id) => shellStore.getWindow(id)?.minimized && restoreWindow(id)) },
    { label: "Minimize all", icon: Minimize2, disabled: order.length === 0, onClick: () => minimizeAll() },
    { label: "Close all", icon: X, disabled: order.length === 0, onClick: () => closeAll() },
  ];
  return (
    <>
      <MenuBar />
      <section
        style={{ top: TOPBAR }}
        className={cn("absolute inset-x-0 bottom-0 z-[10]", interactive && "pointer-events-none [&>*]:pointer-events-auto")}
        // Open the desktop menu for any right-click NOT inside a window. Icons +
        // widgets stopPropagation their own menus (never reach here); windows are
        // excluded via [data-window]. The old `target===currentTarget` guard
        // silently missed clicks whose target was a background descendant.
        onContextMenu={(e) => { if (!(e.target as HTMLElement).closest("[data-window]")) menu.open(e, baseItems); }}
        onPointerDown={marquee.onPointerDown}
      >
        {/* Icons + widgets live INSIDE the section (behind windows: z-[4]/z-[5] <
            window z-10+) so their own right-click / drag beats the desktop menu +
            marquee, which only fire on the bare surface. */}
        <DesktopIcons />
        <Slot region="desktopWidgets" />
        {marquee.rect && (
          <div
            className="pointer-events-none absolute z-[6] rounded-sm border border-primary bg-primary/15"
            style={{ left: marquee.rect.x, top: marquee.rect.y, width: marquee.rect.w, height: marquee.rect.h }}
          />
        )}
        {stacked.map((id) => (
          <Window key={id} id={id} />
        ))}
      </section>
      <Slot region="rightPanel" />
      <NotificationCenter />
      <AppSwitcher />
      <AppLauncher />
      <Dock onMissionControl={() => setOverview(true)} />
      <HotCorners onMissionControl={() => setOverview(true)} />
      {overview && <WindowOverview onClose={() => setOverview(false)} label="Mission Control" />}
      <ForceQuitDialog />
      <ShellContextMenu state={menu.state} onClose={menu.close} />
    </>
  );
}
