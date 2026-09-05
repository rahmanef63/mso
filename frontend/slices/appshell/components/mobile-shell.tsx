"use client";

import { useCallback, useMemo, useState } from "react";
import { useUrlHome } from "../hooks/use-url-home";
import { cn } from "@/lib/utils";
import { useApps } from "../lib/registry";
import { useWindowOrder, useFocused, useWindow } from "../hooks/use-shell";
import { shellStore, openWindow, focusApp, minimizeWindow, restoreWindow, toggleSpotlight, toggleInspector } from "../lib/store";
import { HomeIndicator } from "./home-indicator";
import { WindowContent } from "./window-content";
import { MobileSwitcher } from "./mobile-switcher";
import { MobileHome } from "./mobile-home";
import { MobileNotifications } from "./mobile-notifications";
import { Slot } from "../registry/feature-registry";
import { ShellUIProvider, type ShellUI } from "../registry/shell-ui";
import { useMobileNavigationInfo } from "../lib/mobile-navigation";
import { IosFeatureHeader } from "./shells/ios/ios-feature-header";

// Phones: no floating windows — a paged home + one fullscreen app at a time.
// Reuses the same store (open/minimize/focus) so state matches the desktop.
export function MobileShell() {
  const apps = useApps();
  const order = useWindowOrder();
  const focused = useFocused();
  const [switcher, setSwitcher] = useState(false);
  const [cc, setCc] = useState(false);
  const [nc, setNc] = useState(false); // notification center (pull down, left half)
  const [appScrolled, setAppScrolled] = useState(false); // iOS nav-bar frost-on-scroll
  const [closing, setClosing] = useState(false); // playing the dismiss-to-home slide

  // Dock = manifest-pinned apps (AppDescriptor.pinned — the generic shell never
  // hardcodes project app ids); falls back to the first 4 dockable apps.
  const dockApps = useMemo(() => {
    const pinned = apps.filter((a) => a.pinned);
    return (pinned.length ? pinned : apps.filter((a) => !a.noDock)).slice(0, 4);
  }, [apps]);

  // URL → surface: a pathname naming an app slug shows the app pane (UrlSync
  // opens/focuses its window in the shared store; we only flip off the grid),
  // anything else shows the grid — covers initial deep links AND back/forward.
  // User gestures (launch/Done) override, keyed to the pathname they were made
  // at, so the derivation wins again when the URL actually changes — no
  // effect-driven setState (react-hooks/set-state-in-effect). Gated like
  // UrlSync (manifest.routing): opted out, the URL never names an app, so the
  // grid-first default + gesture overrides behave exactly as before.
  const { home, setHome } = useUrlHome(apps);

  // The visible app is the FOCUSED window (front-most) — fall back to the newest
  // non-minimized one. `order` is append-only and doesn't track focus.
  const topId =
    focused && !shellStore.getWindow(focused)?.minimized
      ? focused
      : ([...order].reverse().find((id) => !shellStore.getWindow(id)?.minimized) ?? null);
  const top = useWindow(topId ?? "__none__"); // reactive: re-renders on the active window's own payload/title changes
  const showApp = !home && top;
  const activeApp = top ? apps.find((a) => a.id === top.app) : null;
  const mobileNav = useMobileNavigationInfo(activeApp?.id);

  // SSOT navigation: open / resume bring a window to the front; home minimises.
  // Resume-don't-duplicate (real-iOS): a home tap brings the existing window
  // forward; only a missing one spawns — multi apps get extra windows from
  // explicit affordances (dock hover "New Window" on desktop), not home taps.
  const launch = useCallback(
    (app: (typeof apps)[number]) => {
      if (!focusApp(app.id)) openWindow(app.id, app.title, app.defaultSize, undefined, { multi: app.multi });
      setSwitcher(false);
      setHome(false);
      setAppScrolled(false); // fresh app opens at the top → clear the nav-bar frost
    },
    [setHome],
  );
  const launchById = useCallback(
    (appId: string) => {
      const app = apps.find((a) => a.id === appId);
      if (app) launch(app);
    },
    [apps, launch],
  );
  const resume = (id: string) => {
    restoreWindow(id);
    setSwitcher(false);
    setHome(false);
    setAppScrolled(false);
  };
  const goHome = () => {
    setSwitcher(false);
    // Slide the app down to the home when it's actually
    // front-most and we're not coming from the switcher; the app layer's
    // onAnimationEnd finalises (minimise + show home). Otherwise go straight home.
    if (topId && !home && !switcher) {
      setClosing(true);
      return;
    }
    setHome(true);
  };
  // Called by the app layer once the dismiss transition finishes.
  const finishClose = () => {
    if (topId) minimizeWindow(topId);
    setClosing(false);
    setHome(true);
  };

  // Swipe down from the top notch zone WHILE an app is open → Control Center
  // (right half) / Notification Center (left half) — same split as the home, so
  // both are reachable in-app (real iOS), not only from the home screen.
  const onAppTopPointerDown = (e: React.PointerEvent) => {
    const sy = e.clientY;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const left = e.clientX - rect.left < rect.width / 2;
    let fired = false;
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", cleanup);
    };
    const move = (ev: PointerEvent) => {
      if (!fired && ev.clientY - sy > 40) {
        fired = true;
        cleanup();
        if (left) setNc(true);
        else setCc(true);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", cleanup);
  };

  const openSwitcher = () => setSwitcher(true);

  // Horizontal home-bar swipe → cycle the open (non-minimized) apps, iOS-style.
  const switchApp = (dir: -1 | 1) => {
    const live = order.filter((id) => !shellStore.getWindow(id)?.minimized);
    if (live.length < 2 || !topId) return;
    const next = live[(live.indexOf(topId) + dir + live.length) % live.length];
    restoreWindow(next);
    setHome(false);
    setAppScrolled(false);
  };

  const quickAppIds = useMemo(() => dockApps.map((a) => a.id), [dockApps]);
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
      {/* --sai-top (notch/Dynamic-Island floor) now comes from the shared
          [data-shell="ios"] rule in globals.css — one source of truth for both
          touch shells, inherited by every iOS surface (home, nav, spotlight). */}
      <div className="absolute inset-0 z-[10] flex flex-col">
      {/* Home is inert while an app covers it (a11y: its grid, pager pages and
          home-indicator otherwise stay in tab/AT order under the opaque app
          layer). It stays visually mounted behind the app transition. */}
      <MobileHome
        apps={apps}
        dockApps={dockApps}
        inactive={!!(showApp && activeApp)}
        onLaunch={launch}
        onSearch={toggleSpotlight}
        onControlCenter={() => setCc(true)}
        onNotifications={() => setNc(true)}
        indicator={<HomeIndicator onHome={goHome} onSwitcher={openSwitcher} onSwitchApp={switchApp} />}
      />

      {/* APP fullscreen */}
      {showApp && activeApp && (
        <div
          className={cn(
            "absolute inset-0 z-[10] flex flex-col [transform-origin:center_bottom]",
            closing && "pointer-events-none", // lock interaction during the dismiss transition
          )}
          style={{
            background: "var(--surface)",
            animation: `${closing ? "mobileAppClose" : "mobileAppOpen"} var(--shell-dur-slow) var(--shell-ease)`,
          }}
          // Finalise the dismiss only when the APP layer's OWN close animation
          // ends (guard against a child animation bubbling up).
          onAnimationEnd={(e) => {
            if (closing && e.target === e.currentTarget) finishClose();
          }}
        >
          {/* Top notch-zone swipe-catcher: pull down for NC (left) / CC (right)
              in-app. Covers only the empty safe-area strip above the nav row, so
              it never blocks the app icon / title / Done. */}
          <div
            className="absolute inset-x-0 top-0 z-[20] [touch-action:none]"
            style={{ height: "var(--sai-top)" }}
            onPointerDown={onAppTopPointerDown}
          />
          <IosFeatureHeader
            title={mobileNav?.title ?? activeApp.title}
            backLabel={mobileNav?.backLabel ?? "Home"}
            onBack={mobileNav?.onBack ?? goHome}
            onAI={toggleInspector}
            scrolled={appScrolled}
          />
          {/* The home-indicator overlays the content edge-to-edge (real-iOS), so
              --sai-bottom INSIDE the app pane must clear its 34px band — every app
              already pads with var(--sai-bottom), so setting the var here clears the
              pill centrally without double-padding anyone.
              max(), NOT env() + 34px. On a notched iPhone env(safe-area-inset-bottom)
              is ALREADY the 34px home-indicator zone, and our pill is drawn INSIDE
              that same physical band — adding them reserved 68px and pushed every
              app's bottom row visibly up the screen. On a device that reports 0 the
              floor still applies, so nothing regresses where the sum used to be right. */}
          <main
            onScrollCapture={(e) => setAppScrolled((e.target as HTMLElement).scrollTop > 4)}
            className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto [container-type:inline-size]"
            style={{ "--sai-bottom": "max(env(safe-area-inset-bottom, 0px), 34px)" } as React.CSSProperties}
          >
            <WindowContent app={top.app} payload={top.payload} />
          </main>
          <div className="absolute inset-x-0 bottom-0 z-[5]">
            <HomeIndicator light={false} onHome={goHome} onSwitcher={openSwitcher} onSwitchApp={switchApp} />
          </div>
        </div>
      )}

      {switcher && <MobileSwitcher onPick={resume} onHome={goHome} />}
      <MobileNotifications open={nc} onClose={() => setNc(false)} />
      <Slot region="controlCenter" />
      <Slot region="topPill" />
      </div>
    </ShellUIProvider>
  );
}
