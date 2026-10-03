"use client";

import { PanelLeft, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { IosTab } from "./ios-tab-bar";

const GLASS = "glass pointer-events-auto border border-[var(--ios-tab-stroke,var(--glass-stroke))] bg-[var(--ios-tab-glass,var(--glass-bar))] text-[color:var(--ios-tab-ink,var(--text))] shadow-[0_8px_24px_rgba(0,0,0,0.16)]";

function Accessory({ label, onClick, slot, children }: { label: string; onClick: () => void; slot: string; children: React.ReactNode }) {
  return (
    <button type="button" data-slot={slot} aria-label={label} onClick={onClick} className="grid h-9 w-[54px] shrink-0 place-items-center rounded-full">
      {children}
    </button>
  );
}

/** iPadOS 27 tab bar: one short horizontal capsule. Sidebar, text tabs, search.
 *  It is not a vertical strip and it does not stretch to the screen width. */
export function IpadTabBar({
  tabs,
  selectedId,
  onSearch,
  onSidebar,
}: {
  tabs: IosTab[];
  selectedId: string | null;
  onSearch: () => void;
  onSidebar: () => void;
}) {
  return (
    <div data-slot="ipad-tab-bar" role="navigation" aria-label="Tabs" className={cn(GLASS, "inline-flex h-11 w-max max-w-full flex-row items-center rounded-full p-1")}>
      <Accessory label="Sidebar" slot="ipad-tab-sidebar" onClick={onSidebar}>
        <PanelLeft className="size-[18px]" strokeWidth={2.25} aria-hidden />
      </Accessory>
      <div role="tablist" className="flex min-w-0 flex-row items-center">
        {tabs.map((tab) => {
          const selected = tab.app.id === selectedId;
          return (
            <button
              key={tab.app.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={tab.onSelect}
              className={cn(
                "relative h-9 min-w-[74px] shrink-0 rounded-full px-[18px] text-[15px] leading-5 tracking-[-0.23px]",
                selected ? "font-bold" : "font-medium",
              )}
            >
              {selected && <span data-slot="ipad-tab-selected" className="absolute inset-0 rounded-full" />}
              <span className="relative truncate">{tab.app.title}</span>
            </button>
          );
        })}
      </div>
      <Accessory label="Search" slot="ipad-tab-search" onClick={onSearch}>
        <Search className="size-[18px]" strokeWidth={2.25} aria-hidden />
      </Accessory>
    </div>
  );
}
