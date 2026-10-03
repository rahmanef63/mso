"use client";

import { useState, type ReactNode } from "react";
import { Diamond, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AppDescriptor } from "../../../lib/types";
import { AppIcon } from "../../app-icon";
import { IOS_TAB, splitTabBar, type TabRole } from "./tab-bar-metrics";

export type IosTab = {
  app: AppDescriptor;
  role?: TabRole;
  onSelect: () => void;
};

const GLASS = "glass pointer-events-auto border border-[var(--ios-tab-stroke,var(--glass-stroke))] bg-[var(--ios-tab-glass,var(--glass-bar))] text-[color:var(--ios-tab-ink,var(--text))] shadow-[0_10px_28px_rgba(0,0,0,0.16)]";

export function useTabMinimized(scrolled: boolean): { minimized: boolean; expand: () => void } {
  const [hold, setHold] = useState(false);
  const [seen, setSeen] = useState(scrolled);
  if (seen !== scrolled) {
    setSeen(scrolled);
    if (!scrolled) setHold(false);
  }
  return { minimized: scrolled && !hold, expand: () => setHold(true) };
}

function TabGlyph({ tab, prominent = false }: { tab: IosTab; prominent?: boolean }) {
  if (tab.role === "search" && !prominent) return <Search className="size-[18px]" strokeWidth={2.25} aria-hidden />;
  return (
    <span className="grid size-7 place-items-center" aria-hidden>
      <AppIcon app={tab.app} />
    </span>
  );
}

function SelectedPill({ slot }: { slot: "ios-tab-selected" | "ipad-tab-selected" }) {
  return <span data-slot={slot} className="absolute rounded-full" style={{ inset: slot === "ios-tab-selected" ? `0 -${IOS_TAB.selectedOutset}px` : 0 }} />;
}

function ExpandedTab({ tab, selected, overlap }: { tab: IosTab; selected: boolean; overlap: boolean }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      aria-label={tab.app.title}
      onClick={tab.onSelect}
      className="relative flex h-[46px] shrink-0 flex-col items-center justify-center px-2"
      style={{ marginInlineStart: overlap ? IOS_TAB.overlap : 0 }}
    >
      <span className="relative flex flex-col items-center">
        {selected && <SelectedPill slot="ios-tab-selected" />}
        <span className="relative z-[1]"><TabGlyph tab={tab} prominent /></span>
        <span
          data-slot="ios-tab-label"
          className="relative z-[1] max-w-[76px] truncate text-[10px] font-semibold leading-3"
          style={{ letterSpacing: selected ? "-0.1px" : "0px" }}
        >
          {tab.app.title}
        </span>
      </span>
    </button>
  );
}

function MiniCapsule({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" data-slot="ios-tab-minimized" aria-label={label} onClick={onClick} className={cn(GLASS, "grid size-10 place-items-center rounded-full")}>
      {children}
    </button>
  );
}

export function IosTabBar({
  tabs,
  selectedId,
  minimized,
  onExpand,
}: {
  tabs: IosTab[];
  selectedId: string | null;
  minimized: boolean;
  onExpand: () => void;
}) {
  const { main, trailing } = splitTabBar(tabs);
  if (tabs.length === 0) return null;
  const split = trailing !== null;
  return (
    <div
      data-slot="ios-tab-bar-row"
      data-minimized={minimized ? "true" : "false"}
      data-split={split ? "true" : "false"}
      className={cn(
        "pointer-events-none flex w-full items-center",
        minimized ? (split ? "justify-between px-8" : "justify-end px-8") : "justify-center px-[25px]",
        !minimized && split && "gap-4",
      )}
    >
      {minimized ? (
        <>
          <MiniCapsule label="Expand tabs" onClick={onExpand}><Diamond className="size-[18px]" strokeWidth={2.25} aria-hidden /></MiniCapsule>
          {trailing && (
            <MiniCapsule label={trailing.app.title} onClick={trailing.onSelect}><TabGlyph tab={trailing} /></MiniCapsule>
          )}
        </>
      ) : (
        <>
          <div data-slot="ios-tab-bar" role="tablist" aria-label="Tabs" className={cn(GLASS, "flex h-[54px] w-max max-w-full items-center rounded-full px-1")}>
            {main.map((tab, index) => (
              <ExpandedTab key={tab.app.id} tab={tab} selected={tab.app.id === selectedId} overlap={index > 0} />
            ))}
          </div>
          {trailing && (
            <button
              type="button"
              data-slot="ios-tab-trailing"
              data-role={trailing.role}
              aria-label={trailing.app.title}
              onClick={trailing.onSelect}
              className={cn(GLASS, "grid size-[54px] shrink-0 place-items-center rounded-full")}
            >
              <TabGlyph tab={trailing} />
            </button>
          )}
        </>
      )}
    </div>
  );
}
