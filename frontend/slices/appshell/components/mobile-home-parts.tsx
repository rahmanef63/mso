"use client";
/* iPhone-home sub-surfaces — ONE page of the app grid (upward-swipe search +
   long-press point). The quick-actions menu lives in shells/ios. Split from
   mobile-home.tsx (≤200-LOC modularity gate). */
import { useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { AppDescriptor } from "../lib/types";
import { useQuickLinks, type QuickLink } from "../registry/capabilities";
import { AppIcon } from "./app-icon";
import { QuicklinkIcon } from "./quicklink-icon";

// iPhone's home page is a FIXED 6 rows × 4 columns and never scrolls vertically —
// past 24 icons you swipe sideways. Ours was one 4-column `overflow-y-auto` grid
// that (measured on the demo) began scrolling at 21 icons on a 390×844 phone and
// at 17 on a 375×667 one — 375 already scrolled with the 18 apps shipping today,
// and quicklinks spend the same budget, so three bookmarks tipped 390 over too.
const ICONS_PER_PAGE = 24;

export type HomeTile =
  | { key: string; kind: "app"; app: AppDescriptor }
  | { key: string; kind: "link"; link: QuickLink };

// Apps, then quicklinks, chunked into pages of 24. It lives here rather than in
// MobileHome because quicklinks arrive through a capability hook, so this is the
// only place that sees BOTH lists. Always ≥1 page, or the pager collapses.
export function useHomePages(apps: AppDescriptor[]): HomeTile[][] {
  const { items } = useQuickLinks();
  return useMemo(() => {
    const tiles: HomeTile[] = [
      ...apps.map((app): HomeTile => ({ key: `app:${app.id}`, kind: "app", app })),
      ...items.map((link): HomeTile => ({ key: `link:${link.id}`, kind: "link", link })),
    ];
    const pages: HomeTile[][] = [];
    for (let i = 0; i < tiles.length; i += ICONS_PER_PAGE) pages.push(tiles.slice(i, i + ICONS_PER_PAGE));
    return pages.length > 0 ? pages : [[]];
  }, [apps, items]);
}

// One tile. The icon is `flex-1 max-h-[60px]` — sized by the ROW, not the column:
// sizing by width (`w-full max-w-[58px]`, what this was) overflows a 667px-tall
// phone, so six rows could never fit. 60px is iPhone's size and 390×844 measures
// exactly that, but a row only affords what our chrome leaves it — 375×667 measures
// 45.5px, 320×568 29px. See the top spacer in mobile-home.tsx for where it goes.
function Tile({
  label, icon, onClick, onPointerDown, onContextMenu,
}: {
  label: string; icon: React.ReactNode; onClick: () => void;
  onPointerDown?: (e: React.PointerEvent) => void; onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      onClick={onClick}
      className="h-auto min-h-0 p-0 hover:bg-transparent flex flex-col items-center gap-1"
    >
      {/* No max-w — width follows height via aspect-square. Clamping the width too
          made the tile 58.5×60, visibly non-square, on a 360px-wide phone. */}
      <span className="aspect-square min-h-0 max-h-[60px] flex-1">{icon}</span>
      {/* 11px/13px — iOS home labels are 11pt SF, one line, tight leading. Was 12px
          inheriting the Button's 1.43 (17.1px measured), wasting 4px per row — 24px
          over six rows, which is the margin six rows fit by. */}
      <span className="max-w-full shrink-0 truncate text-[11px] font-medium leading-[13px] text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.5)]">
        {label}
      </span>
    </Button>
  );
}

// One home page. A clear upward swipe (not a horizontal page flick) opens search;
// holding an icon ~450ms (or right-click) opens its quick-actions sheet.
export function AppsGrid({
  tiles, onLaunch, onSearch, onContext,
}: {
  tiles: HomeTile[]; onSearch: () => void;
  onLaunch: (app: AppDescriptor) => void;
  onContext: (app: AppDescriptor, point: { x: number; y: number }) => void;
}) {
  const { open: openLink } = useQuickLinks();
  // Long-press bookkeeping: a fired hold must swallow the click that follows.
  const holdTimer = useRef<number | null>(null);
  const held = useRef(false);

  const startHold = (app: AppDescriptor) => (e: React.PointerEvent) => {
    held.current = false;
    const sx = e.clientX, sy = e.clientY;
    const cancel = () => {
      if (holdTimer.current) { window.clearTimeout(holdTimer.current); holdTimer.current = null; }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - sx) > 12 || Math.abs(ev.clientY - sy) > 12) cancel();
    };
    const up = () => cancel();
    holdTimer.current = window.setTimeout(() => {
      held.current = true;
      cancel();
      onContext(app, { x: sx, y: sy });
    }, 450);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // A page no longer scrolls, so an upward drag is unambiguous — the old
  // `scrollTop <= 0` guard existed only to stop this from stealing the grid's
  // own vertical scroll, and there is no longer one to steal.
  const onPointerDown = (e: React.PointerEvent) => {
    const sy = e.clientY;
    const sx = e.clientX;
    let fired = false;
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", cleanup);
    };
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - sy;
      const dx = ev.clientX - sx;
      if (!fired && dy < -70 && Math.abs(dx) < 50) {
        fired = true;
        cleanup();
        onSearch();
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", cleanup);
  };

  return (
    // 6 rows × 4 cols must equal ICONS_PER_PAGE: change one without the others and
    // the surplus does not wrap to page 2, it vanishes behind this `overflow-hidden`
    // — which is equally what stops the page scrolling. touch-action stays AUTO so
    // the pager's horizontal swipe still reaches the scroller above. 26px gap + px-6
    // = a 66px column at 390, centring the 60px icon 27px from the edge, 32px apart.
    <div
      onPointerDown={onPointerDown}
      className="grid h-full grid-cols-4 grid-rows-6 gap-x-[26px] overflow-hidden px-6 pb-6 pt-[18px]"
    >
      {tiles.map((tile) => {
        if (tile.kind === "link") {
          const { link } = tile; // const so the narrowing survives into the closure
          return <Tile key={tile.key} label={link.title} icon={<QuicklinkIcon link={link} />} onClick={() => openLink(link)} />;
        }
        const { app } = tile;
        return (
          <Tile
            key={tile.key}
            label={app.title}
            icon={<AppIcon app={app} />}
            onPointerDown={startHold(app)}
            onContextMenu={(e) => { e.preventDefault(); onContext(app, { x: e.clientX, y: e.clientY }); }}
            onClick={() => { if (held.current) { held.current = false; return; } onLaunch(app); }}
          />
        );
      })}
    </div>
  );
}
