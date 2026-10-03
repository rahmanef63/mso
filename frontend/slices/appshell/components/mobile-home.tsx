"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { AppDescriptor } from "../lib/types";
import { Slot } from "../registry/feature-registry";
import { MobileAppLibrary } from "./mobile-app-library";
import { AppActionSheet, AppsGrid, useHomePages } from "./mobile-home-parts";
import { ShellContextMenu, useShellContextMenu } from "./shells/context-menu";

// Paged iPhone home: [Today widgets] · [App grid ×N] · [App Library]. Page dots
// and the home indicator persist. The tab bar itself is shell chrome (a floating
// capsule on iPhone, a short top capsule on iPad); this surface only reserves
// its space. The app grid is N pages of 24 (iPhone's 6×4) — see mobile-home-parts.
export function MobileHome({
  apps,
  inactive = false,
  onLaunch,
  onSearch,
  onControlCenter,
  onNotifications,
  indicator,
  ipad = false,
  onContentScroll,
  libraryToken = 0,
  libraryTarget = "grid",
}: {
  apps: AppDescriptor[];
  inactive?: boolean; // an app layer covers the home — pull it from tab/AT order
  onLaunch: (app: AppDescriptor) => void;
  onSearch: () => void;
  onControlCenter: () => void;
  onNotifications?: () => void;
  indicator: React.ReactNode;
  /** iPad reserves a top band for the horizontal tab bar instead of a bottom dock. */
  ipad?: boolean;
  onContentScroll?: (scrolled: boolean) => void;
  libraryToken?: number;
  libraryTarget?: "library" | "grid";
}) {
  const pagerRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(1); // 0 widgets · 1…N apps · N+1 library
  const [ctxApp, setCtxApp] = useState<AppDescriptor | null>(null); // long-press sheet
  const menu = useShellContextMenu("ios", "mobile"); // home background long-press menu
  const gridPages = useHomePages(apps);
  const pageCount = gridPages.length + 2; // + Today + App Library

  // Open on the app grid (the middle page), like iPhone's default home.
  useLayoutEffect(() => {
    const el = pagerRef.current;
    if (el) el.scrollLeft = el.clientWidth;
  }, []);

  useLayoutEffect(() => {
    if (!libraryToken) return;
    const el = pagerRef.current;
    if (!el) return;
    const index = libraryTarget === "library" ? Math.max(0, pageCount - 1) : 1;
    el.scrollTo({ left: index * el.clientWidth, behavior: "smooth" });
  }, [libraryToken, libraryTarget, pageCount]);

  const onScroll = () => {
    const el = pagerRef.current;
    if (!el) return;
    const next = Math.round(el.scrollLeft / el.clientWidth);
    setPage(next);
    if (next !== 0) onContentScroll?.(false);
  };

  // Swipe DOWN from the top safe-area: LEFT half → Notification Center,
  // RIGHT half → Control Center (iPhone's split gesture).
  const onTopPointerDown = (e: React.PointerEvent) => {
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
        if (left && onNotifications) onNotifications();
        else onControlCenter();
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", cleanup);
  };

  // Home-background long-press / right-click → the registry menu for this
  // shell. Native long-press fires contextmenu on touch; app icons keep their
  // own long-press sheet (the closest() guard skips presses on controls).
  const onHomeContext = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button,a,input")) return;
    menu.open(e);
  };

  return (
    <div className="absolute inset-0 flex flex-col" inert={inactive} aria-hidden={inactive} onContextMenu={onHomeContext}>
      {/* Top safe-area spacer: reserves the notch / Dynamic-Island zone (a real
          phone's hardware lives here) and owns the swipe-down gesture →
          Notification Center (left half) / Control Center (right half).
          Deliberately empty — no status clock (not useful in a VPS cockpit).
          This 2.25rem is ON TOP of --sai-top, which globals.css floors at 2.75rem
          for data-shell="ios" — they ADD, so iOS starts the pager 80px down even in
          a browser reporting no inset. Read that before "reclaiming" space here:
          80px + 34px of dots + a 70px tab reserve + a 36px indicator = 220px, and
          what is left is what caps the home icon (60px at 844 tall, 45.5 at 667). */}
      <div
        className="shrink-0 [touch-action:none]"
        style={{ height: "calc(2.25rem + var(--sai-top))" }}
        onPointerDown={onTopPointerDown}
      />
      {ipad && <div data-slot="ipad-tab-reserve" className="h-6 shrink-0" />}

      <div
        ref={pagerRef}
        onScroll={onScroll}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <Page active={page === 0}>
          {/* Today keeps its OWN scroller — a widget stack is genuinely taller than
              the page. The app pages deliberately do not scroll (see AppsGrid). */}
          <div
            className="h-full overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            onScroll={(e) => onContentScroll?.(e.currentTarget.scrollTop > 4)}
          >
            <Slot region="today" />
          </div>
        </Page>
        {gridPages.map((tiles, i) => (
          <Page key={tiles[0]?.key ?? `home-${i}`} active={page === i + 1}>
            <AppsGrid tiles={tiles} onLaunch={onLaunch} onSearch={onSearch} onContext={setCtxApp} />
          </Page>
        ))}
        <Page active={page === pageCount - 1}>
          <MobileAppLibrary apps={apps} onOpen={onLaunch} />
        </Page>
      </div>

      <div className="flex justify-center gap-0.5 pb-1.5 pt-1">
        {Array.from({ length: pageCount }, (_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Go to page ${i + 1}`}
            aria-current={i === page}
            onClick={() => pagerRef.current?.scrollTo({ left: i * pagerRef.current.clientWidth, behavior: "smooth" })}
            // min-h/w-6 = the WCAG 2.5.8 24×24 floor. The DOT stays 7px — only the
            // hit area grows, so nothing moves visually. `p-1.5` alone gave 19×19,
            // which is under the floor on the one surface that is touch-only.
            className="grid min-h-6 min-w-6 place-items-center p-1.5"
          >
            <span className={cn("size-[7px] rounded-full transition-colors", i === page ? "bg-white/90" : "bg-white/40")} />
          </button>
        ))}
      </div>

      {!ipad && <div data-slot="ios-tab-reserve" className="h-[70px] shrink-0" />}

      {indicator}

      {ctxApp && (
        <AppActionSheet
          app={ctxApp}
          onOpen={() => { setCtxApp(null); onLaunch(ctxApp); }}
          onClose={() => setCtxApp(null)}
        />
      )}

      <ShellContextMenu state={menu.state} onClose={menu.close} />
    </div>
  );
}

// Off-canvas pages sit at ±100vw but would otherwise stay in tab/AT order —
// inert pulls them out; the swipe still works because the scroll gesture
// belongs to the pager container, not the (inert) page content.
function Page({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <section inert={!active} aria-hidden={!active} className="h-full w-full shrink-0 snap-center overflow-hidden">
      {children}
    </section>
  );
}
