"use client";

import { Compass, LayoutGrid, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TouchList } from "@/features/appshell";
import { cn } from "@/lib/utils";
import { glyphIcon } from "../lib/glyph";
import { CATEGORIES, type StoreCategory } from "../lib/store-catalog";

// "Apps" / "Features" surface the OS's own built-ins + shell features as
// on/off toggles (system-catalog); the rest filter the curated install catalog.
export type StoreFilter = "Featured" | StoreCategory | "Apps" | "Features";

const FILTERS: StoreFilter[] = ["Featured", ...CATEGORIES];
const SYSTEM_FILTERS: StoreFilter[] = ["Apps", "Features"];

// Each category gets a representative glyph from the shared glyph map.
const FILTER_GLYPH: Record<StoreCategory | "Featured", string> = {
  Featured: "grid",
  Productivity: "folder",
  Media: "image",
  Dev: "code",
  System: "gauge",
};

const SYSTEM_ICON: Record<"Apps" | "Features", LucideIcon> = {
  Apps: LayoutGrid,
  Features: SlidersHorizontal,
};

// Discover rail — category filter mirroring the mock launcher `app-side`, plus a
// "System" group for toggling the built-in apps + shell features on/off. Rows sit
// in a TouchList so they grow to ≥44px hit targets on coarse pointers (tablets).
export function StoreSidebar({
  value,
  onChange,
}: {
  value: StoreFilter;
  onChange: (f: StoreFilter) => void;
}) {
  const item = (f: StoreFilter, Icon: LucideIcon) => (
    <Button
      key={f}
      type="button"
      variant="ghost"
      onClick={() => onChange(f)}
      className={cn(
        "flex h-auto w-full items-center justify-start gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors",
        value === f
          ? "bg-primary text-primary-foreground hover:bg-primary"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{f}</span>
    </Button>
  );

  return (
    <aside className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-border bg-secondary/30 p-2">
      <div className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        <Compass className="size-3.5" /> Discover
      </div>
      <TouchList className="gap-0.5">
        {FILTERS.map((f) =>
          item(f, f === "Featured" ? Compass : glyphIcon(FILTER_GLYPH[f as StoreCategory])),
        )}
      </TouchList>

      <div className="mt-2 flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        <LayoutGrid className="size-3.5" /> System
      </div>
      <TouchList className="gap-0.5">
        {SYSTEM_FILTERS.map((f) => item(f, SYSTEM_ICON[f as "Apps" | "Features"]))}
      </TouchList>
    </aside>
  );
}

// Compact replacement for the rail: a horizontally scrollable chip row shown
// when the pane is too narrow for the sidebar (the app decides via useContainer).
export function StoreFilterChips({
  value,
  onChange,
}: {
  value: StoreFilter;
  onChange: (f: StoreFilter) => void;
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
      {[...FILTERS, ...SYSTEM_FILTERS].map((f) => (
        <Button
          key={f}
          type="button"
          size="sm"
          variant={value === f ? "default" : "secondary"}
          onClick={() => onChange(f)}
          className="h-8 shrink-0 rounded-full px-3 text-xs [@media(pointer:coarse)]:min-h-[44px]"
        >
          {f}
        </Button>
      ))}
    </div>
  );
}
