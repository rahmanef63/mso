"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// The ONE store-row primitive. StoreAppCard and SystemCard are thin wrappers:
// they supply the glyph, the meta badge row and the trailing action, while the
// row shell, the 12x12 gradient glyph tile, its overlay and the truncated
// title/description block live here so the two grids cannot drift apart.
//
// FeaturedCard reuses the glyph tile for its hero and keeps its own chrome:
// a hero is a different layout (bigger type, no badge row), so forcing it
// through the row would only add variant flags.
//
// Size/colour stay at the call site so the hero can use a 14x14 tile without
// the row's text colour; everything structural lives in TILE.

const TILE = "grid shrink-0 place-items-center";

// `relative` belongs to the tile only when an overlay needs a positioned
// parent, so a tile without one has exactly the class list it had before.
const OVERLAY = {
  // Store rows: full-tile gloss.
  gloss:
    "inset-0 rounded-[inherit] bg-[linear-gradient(180deg,rgba(255,255,255,0.30),rgba(255,255,255,0.06)_45%,rgba(0,0,0,0.06))]",
  // System rows: flat top sheen.
  sheen: "inset-x-0 top-0 h-1/2 rounded-t-xl bg-white/20",
} as const;

/** Gradient glyph tile (background + overlay). */
export function StoreGlyph({
  gradient,
  overlay = "gloss",
  className,
  children,
}: {
  /** CSS background for the tile; omit to inherit the parent surface. */
  gradient?: string;
  overlay?: keyof typeof OVERLAY | "none";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(TILE, overlay !== "none" && "relative", className)}
      style={gradient ? { background: gradient } : undefined}
    >
      {overlay !== "none" && (
        <span className={cn("pointer-events-none absolute", OVERLAY[overlay])} />
      )}
      {children}
    </div>
  );
}

/** One app row: shell, glyph tile, title + meta, description, trailing action. */
export function StoreTile({
  title,
  gradient,
  desc,
  glyph,
  meta,
  overlay,
  action,
  cardRef,
}: {
  title: string;
  gradient: string;
  desc: string;
  /** Tile content: an icon element or official artwork. */
  glyph: ReactNode;
  /** Badge row under the title (category/runtime or app/feature kind). */
  meta: ReactNode;
  overlay?: keyof typeof OVERLAY;
  /** Trailing control. Receives hover so an installed row can reveal Uninstall. */
  action: (hover: boolean) => ReactNode;
  /** Right-click zone ref, so a card can nest its own context menu. */
  cardRef?: ComponentProps<"div">["ref"];
}) {
  const [hover, setHover] = useState(false);

  return (
    <Card
      ref={cardRef}
      className="flex gap-3 p-3.5"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <StoreGlyph
        gradient={gradient}
        overlay={overlay}
        className="size-12 rounded-xl text-white shadow-sm"
      >
        {glyph}
      </StoreGlyph>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold leading-tight">
              {title}
            </div>
            {meta}
          </div>
          {action(hover)}
        </div>
        <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">
          {desc}
        </p>
      </div>
    </Card>
  );
}
