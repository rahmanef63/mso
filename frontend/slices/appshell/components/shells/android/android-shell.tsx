"use client";
/* Android (Material-You) mobile shell — same store + apps as every other shell,
   one fullscreen app at a time (mirrors MobileShell). Chrome: pull-DOWN on the home
   surface → the REAL Control Center feature (controlCenter slot; the old fake Shade
   is gone), big clock + date on the wallpaper, search pill → Spotlight, an App Drawer
   opened by TAPPING the bottom "All apps" target — it is drawn as a grabber, but no
   swipe-up gesture is wired here, and this line claiming one is what sent a later
   motion comment on to justify an animation direction by a gesture that does not
   exist — gesture nav (back / home / recents), and a Recents card deck. Transparent
   root: the shared <Wallpaper> shows through, like every other shell. Bottom inset
   system: the root sets `--android-nav` (NavBar row height); every surface that must
   clear the bottom chrome pads with `calc(var(--android-nav) + var(--sai-bottom))`. */
import { Button } from "@/components/ui/button";
import { useCallback, useMemo, useRef, useState, type CSSProperties } from "react";
import { useUrlHome } from "../../../hooks/use-url-home";
import { Search, MoreHorizontal, Sparkles } from "lucide-react";
import { useApps } from "../../../lib/registry";
import { usePullDown } from "../../../hooks/use-pull-down";
import { useWindowOrder, useFocused, useWindow } from "../../../hooks/use-shell";
import { shellStore, openWindow, focusApp, minimizeWindow, restoreWindow, toggleSpotlight, toggleInspector } from "../../../lib/store";
import { WindowContent } from "../../window-content";
import { Slot } from "../../../registry/feature-registry";
import { useShellConfig } from "../../../registry/shell-config";
import { ShellUIProvider, type ShellUI } from "../../../registry/shell-ui";
import { Clock } from "../../clock";
import { AppCell, AppDrawer, NavBar, Recents } from "./android-parts";
import { M3_PRESS } from "./android-motion";
import { ShellContextMenu, useShellContextMenu } from "../context-menu";
import type { AppDescriptor } from "../../../lib/types";
import { useInspectorInfo } from "../../../lib/inspector";
import { AppActionsSheet } from "../../app-actions-sheet";
import { AndroidNotifications } from "./android-notifications";

function AndroidShell() {
  const apps = useApps();
  const order = useWindowOrder();
  const focused = useFocused();
  const [drawer, setDrawer] = useState(false);
  const [cc, setCc] = useState(false); // control center (pull down on home)
  const [notif, setNotif] = useState(false); // notification shade (pull down, left half)
  const [recents, setRecents] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false); // in-app "•••" action drawer
  const gridRef = useRef<HTMLDivElement>(null);

  // URL → surface (same derivation as the iOS shell): a pathname naming an app slug
  // shows the app pane (UrlSync opens/focuses its window); user gestures override,
  // keyed to the pathname made at — deep links AND back/forward, no effect setState.
  const { home, setHome } = useUrlHome(apps);

  const dockable = useMemo(() => apps.filter((a) => !a.noDock), [apps]);
  const pinned = useMemo(() => dockable.filter((a) => a.pinned), [dockable]);
  const topId =
    focused && !shellStore.getWindow(focused)?.minimized
      ? focused
      : ([...order].reverse().find((id) => !shellStore.getWindow(id)?.minimized) ?? null);
  const top = useWindow(topId ?? "__none__"); // reactive: re-renders on the active window's own payload/title changes
  const showApp = !home && !!top;
  const activeApp = top ? apps.find((a) => a.id === top.app) : null;
  // Running app's live inspector actions → the M3 top-app-bar "•••" drawer (same
  // bus as iOS + the desktop menu-bar). Empty ⇒ no overflow button renders.
  const appActions = useInspectorInfo(activeApp?.id)?.actions ?? [];

  const launch = useCallback(
    (app: AppDescriptor) => {
      // Resume-don't-duplicate (real-Android): a home/drawer tap brings the
      // existing window forward; only a missing one spawns.
      if (!focusApp(app.id)) openWindow(app.id, app.title, app.defaultSize, undefined, { multi: app.multi });
      setDrawer(false);
      setRecents(false);
      setHome(false);
    },
    [setHome],
  );
  const launchById = useCallback(
    (id: string) => {
      const app = apps.find((a) => a.id === id);
      if (app) launch(app);
    },
    [apps, launch],
  );
  const goHome = () => {
    if (topId) minimizeWindow(topId);
    setHome(true);
    setDrawer(false);
    setRecents(false);
  };
  const resume = (id: string) => {
    restoreWindow(id);
    setRecents(false);
    setHome(false);
  };
  // Pull-DOWN on home: LEFT half → notifications, RIGHT half → Control Center
  // (mirrors the iOS split). The grid keeps scrolling — the pull only arms at top.
  const pullDown = usePullDown((sx) => (sx < window.innerWidth / 2 ? setNotif(true) : setCc(true)), gridRef);
  // Home-background long-press / right-click → this shell's registry menu
  // (native long-press fires contextmenu; controls are skipped).
  const menu = useShellContextMenu("android", "mobile");
  const onHomeContext = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button,a,input")) return;
    menu.open(e);
  };

  const quickAppIds = useMemo(
    () => (pinned.length ? pinned : dockable.slice(0, 4)).map((a) => a.id),
    [pinned, dockable],
  );
  const shellUI = useMemo<ShellUI>(
    () => ({
      controlCenterOpen: cc,
      setControlCenterOpen: setCc,
      openApp: launch,
      openAppById: launchById,
      quickAppIds,
    }),
    [cc, launch, launchById, quickAppIds],
  );

  return (
    <ShellUIProvider value={shellUI}>
      <div
        className="absolute inset-0 z-[10] flex flex-col overflow-hidden text-foreground"
        style={{ "--android-nav": "48px" } as CSSProperties}
      >
        {/* HOME (always mounted; app overlays it — inert while covered so its
            grid + NavBar drop out of tab/AT order under the z-20 app layer).
            Pull down → Control Center; clock+date live on the wallpaper. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-1" inert={showApp} aria-hidden={showApp} onPointerDown={pullDown} onContextMenu={onHomeContext} style={{ paddingTop: "var(--sai-top, 0px)" }}>
          {/* Same reason as the app labels: the clock sits on the wallpaper, so it
              needs its own light-on-dark treatment rather than the theme foreground. */}
          {/* `[&_div]:text-white/80` targets Clock mode="date", which hard-codes
              text-muted-foreground — correct on a card, invisible on a wallpaper. The
              descendant selector is (0,1,1) so it beats that class deterministically,
              without !important and without changing Clock's shared API for one caller. */}
          <div className="mt-6 shrink-0 text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.5)] [&_div]:text-white/80">
            <Clock mode="big" />
            <Clock mode="date" />
          </div>
          <button
            type="button"
            onClick={toggleSpotlight}
            className={`mt-4 flex h-11 shrink-0 items-center gap-3 rounded-full border border-border bg-card/80 px-4 text-left shadow-sm backdrop-blur active:scale-[0.97] ${M3_PRESS}`}
          >
            <Search className="size-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Search</span>
          </button>
          {/* Home widgets — shared Today surface, height-capped so it never crowds the grid. */}
          <div className="mt-4 max-h-[36vh] shrink-0 overflow-y-auto [scrollbar-width:none]">
            <Slot region="today" />
          </div>
          {/* EVERY dockable app gets a home icon — the old slice(0, 12) cap hid most of
              an agent workspace (20-24 Hermes/OpenClaw features). The grid is already
              `min-h-0 overflow-y-auto`, so it just scrolls a longer list; usePullDown
              still arms only at scrollTop 0, so the shade gesture is unchanged. */}
          {/* White + shadow HERE rather than inside AppCell: the same cell is reused by
              the App Drawer, which is a light sheet where white text would vanish. This
              grid is the only surface that sits directly on the wallpaper. Matches the
              treatment the iOS home and app library already use. */}
          <div ref={gridRef} className="mt-5 grid min-h-0 grid-cols-4 content-start gap-x-3 gap-y-5 overflow-y-auto text-white [scrollbar-width:none] [text-shadow:0_1px_3px_rgba(0,0,0,0.5)] [&::-webkit-scrollbar]:hidden">
            {dockable.map((a) => (
              <AppCell key={a.id} app={a} onClick={() => launch(a)} />
            ))}
          </div>
          {/* 0.97, not the 0.90 the icon-only buttons get: this target carries an
              11px text label, and scaling type resamples it — blurry for the length
              of the press on a low-DPI panel. Same reason AppCell scales its icon
              and leaves its label alone, and the same 0.97 the search pill uses. */}
          <Button type="button" variant="ghost"
            onClick={() => setDrawer(true)}
            className={`h-auto p-0 font-normal hover:bg-transparent mx-auto mb-1 mt-auto flex flex-col items-center gap-0.5 text-[11px] text-muted-foreground active:scale-[0.97] ${M3_PRESS}`}
          >
            <span className="h-1 w-9 rounded-full bg-foreground/30" />
            All apps
          </Button>
        </div>

        <NavBar inactive={showApp} onBack={goHome} onHome={goHome} onRecents={() => setRecents(true)} />

        {/* Fullscreen app. Open = M3 SPATIAL SLOW (k=200, ζ=0.8, ~511ms). The speed
            tier is chosen by the SIZE of the thing that moves, not by how far it
            moves: this is the largest surface in the shell, so "slow" is right even
            though mobileAppOpen only travels 10px. Most of the perceived movement is over
            by ~40% of that; the tail is the settle, which is exactly the part a
            cubic-bezier cannot express. Transform-only on purpose — no opacity,
            because pairing an effects fade with a spatial slide inside ONE animation
            would force a single easing on both families. */}
        {showApp && activeApp && top && (
          <div className="absolute inset-0 z-[20] flex flex-col bg-background [animation:mobileAppOpen_var(--m3-dur-spatial-slow)_var(--m3-spatial)] [transform-origin:center_bottom]">
            {/* M3 top app bar: flat surface (bg-card, hairline divider), Title Large
                regular weight — not a colored brand header. System Back stays in
                the navigation row below, so this bar does not duplicate it. The per-app color still reads on the icon + recents. */}
            <header
              className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-3 text-foreground"
              style={{ height: "calc(3rem + var(--sai-top, 0px))", paddingTop: "var(--sai-top, 0px)" }}
            >
              {/* Top-bar icon buttons get the same spatial-FAST press as the nav row:
                  small elements, so "fast" (k=800, ζ=0.6, ~322ms, 9.3% overshoot).
                  The overshoot is what makes a press feel like a physical button
                  releasing rather than a scale tween returning. */}
              {/* The system navigation bar below already owns Android Back. A second
                  shell-level Back here performed the exact same goHome action and
                  doubled the affordance in every app. Internal app navigation (for
                  example Settings detail → Settings list) renders its own Back. */}
              <span className="flex-1 truncate pl-1 text-[19px] font-normal">{activeApp.title}</span>
              {appActions.length > 0 && (
                <>
                <Button type="button" variant="ghost" aria-label="Ask Alfa" onClick={toggleInspector} className={`h-auto p-0 font-normal hover:bg-transparent grid size-12 place-items-center active:scale-90 ${M3_PRESS}`}><Sparkles className="size-5" /></Button>
                <Button type="button" variant="ghost" aria-label="Actions" onClick={() => setActionsOpen(true)} className={`-mr-2 h-auto p-0 font-normal hover:bg-transparent grid size-12 place-items-center active:scale-90 ${M3_PRESS}`}><MoreHorizontal className="size-5" /></Button>
              </>
              )}
            </header>
            <main className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto [container-type:inline-size]">
              <WindowContent app={top.app} payload={top.payload} />
            </main>
            <NavBar onBack={goHome} onHome={goHome} onRecents={() => setRecents(true)} />
          </div>
        )}

        {drawer && <AppDrawer apps={dockable} onLaunch={launch} onClose={() => setDrawer(false)} />}
        {recents && <Recents order={order} apps={apps} onResume={resume} onHome={goHome} />}
        {activeApp && (
          <AppActionsSheet app={activeApp} actions={appActions} open={actionsOpen} onOpenChange={setActionsOpen} />
        )}
        {/* live-activity chip (parity with iOS Dynamic Island) — renders only
            while an app reports an activity (render/copy…); reads the same store. */}
        <Slot region="topPill" />
        <Slot region="controlCenter" />
        <AndroidNotifications open={notif} onClose={() => setNotif(false)} />
        <ShellContextMenu state={menu.state} onClose={menu.close} />
      </div>
    </ShellUIProvider>
  );
}

export { AndroidShell };
