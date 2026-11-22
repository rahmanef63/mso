"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { snapWindow, snapRect, focusWindow } from "../lib/store";
import type { SnapZone, WinId } from "../lib/types";

// Windows 11 "Snap Layouts" flyout — the small grid that drops from the maximize
// caption button (win-caption.tsx owns the hover open + the mouse-leave close).
// Each LAYOUT below is a small diagram showing every zone it occupies AT ONCE
// (the real Win11 picker), not a single-zone list. Clicking a zone inside a
// diagram snaps THIS window via the existing snapWindow() store action; every
// rect is derived from snapRect() through zoneFraction(), so the flyout can never
// drift from the real tiling math (no duplicated geometry).

// Six layouts, each fully composed of REAL existing SnapZones (store-geometry.ts:
// left/right/l23/r13/l13/r23/tl/tr/bl/br) so every zone tiles end-to-end with no
// dead space: halves, a 70/30 split (+ mirror), quarters, and a big pane + two
// stacked (+ mirror). A standalone middle-third isn't in the zone repertoire, so
// an equal 3-column layout is intentionally omitted (would need new snap math).
const LAYOUTS: { id: string; label: string; zones: SnapZone[] }[] = [
  { id: "halves", label: "50 / 50", zones: ["left", "right"] },
  { id: "seventy-thirty", label: "70 / 30", zones: ["l23", "r13"] },
  { id: "thirty-seventy", label: "30 / 70", zones: ["l13", "r23"] },
  { id: "quarters", label: "Quarters", zones: ["tl", "tr", "bl", "br"] },
  { id: "big-left", label: "Big left + stacked right", zones: ["left", "tr", "br"] },
  { id: "big-right", label: "Big right + stacked left", zones: ["right", "tl", "bl"] },
];

// Zone rect as a fraction (%) of the full work area, for the mini-preview fill.
// snapRect("top") IS the full work area, so every diagram normalises against the
// SAME frame the real snap uses. snapRect is covered by store-geometry.test.ts,
// leaving this as pure division on already-tested geometry.
export function zoneFraction(zone: SnapZone) {
  const f = snapRect("top");
  const r = snapRect(zone);
  return {
    left: `${((r.x - f.x) / f.w) * 100}%`,
    top: `${((r.y - f.y) / f.h) * 100}%`,
    width: `${(r.w / f.w) * 100}%`,
    height: `${(r.h / f.h) * 100}%`,
  };
}

export function SnapLayoutsMenu({ id, onClose }: { id: WinId; onClose: () => void }) {
  // Esc closes — matches the menu-bar / Spotlight dismissal idiom.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = (zone: SnapZone) => {
    focusWindow(id);
    snapWindow(id, zone);
    onClose();
  };

  return (
    <div
      role="menu"
      aria-label="Snap layouts"
      // Swallow pointerdown on the whole flyout (padding + gutters, not just the
      // zone buttons) so a press in a dead-zone can't bubble to the titlebar's
      // drag handler and un-maximize / start-drag the window.
      onPointerDown={(e) => e.stopPropagation()}
      // top-full (no gap) keeps the button→flyout hover path unbroken so it
      // doesn't close mid-reach; z sits above the window content.
      className="absolute right-0 top-full z-[60] grid w-[206px] grid-cols-3 gap-2 rounded-md border border-border bg-popover p-2 shadow-lg"
    >
      {LAYOUTS.map(({ id: layoutId, label, zones }) => (
        <div
          key={layoutId}
          role="group"
          aria-label={label}
          title={label}
          className="relative h-10 w-[60px] overflow-hidden rounded-[4px] bg-muted/40"
        >
          {zones.map((zone) => (
            <Button
              key={zone}
              type="button"
              variant="ghost"
              aria-label={`${label}: ${zone}`}
              title={label}
              // Stop the press from bubbling to the title bar's drag handler.
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                pick(zone);
              }}
              style={zoneFraction(zone)}
              className="absolute h-auto min-h-0 w-auto min-w-0 rounded-[4px] bg-muted-foreground/40 p-0 hover:bg-primary"
            />
          ))}
        </div>
      ))}
    </div>
  );
}
