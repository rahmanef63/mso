"use client";
// audit-allow-hex: VS-Code-dark editor chrome palette is the slice's design, not themable tokens.

import { type MouseEvent } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { baseName } from "../lib/util";

export function TabStrip({
  tabs,
  active,
  dirtyOf,
  onSelect,
  onClose,
  onNew,
}: {
  tabs: string[];
  active: string | null;
  dirtyOf: (path: string) => boolean;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onNew: () => void;
}) {
  const closeTab = (path: string, e: MouseEvent) => {
    e.stopPropagation();
    onClose(path);
  };

  return (
    <div role="tablist" aria-label="Open files" className="flex min-h-9 items-stretch overflow-x-auto border-b border-[#2a2a30] bg-[#16161a] [@media(pointer:coarse)]:min-h-[44px]">
      {tabs.map((p) => {
        const on = p === active;
        const dirty = dirtyOf(p);
        return (
          <div
            key={p}
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onSelect(p)}
            onKeyDown={(e) => {
              const i = tabs.indexOf(p);
              const next = e.key === "ArrowRight" ? (i + 1) % tabs.length : e.key === "ArrowLeft" ? (i + tabs.length - 1) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
              if (next >= 0) { e.preventDefault(); onSelect(tabs[next]); e.currentTarget.parentElement?.querySelectorAll<HTMLElement>("[role=tab]")[next]?.focus(); }
            }}
            title={p}
            className={cn(
              "flex max-w-[200px] shrink-0 items-center gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary border-r border-[#2a2a30] px-3 text-xs",
              on
                ? "border-t-2 border-t-primary bg-[#1e1e22] text-[#e6e6e6]"
                : "border-t-2 border-t-transparent text-[#9aa0aa] hover:bg-[#1b1b20]",
            )}
          >
            <span className="truncate">{baseName(p)}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Close ${baseName(p)}`}
              onClick={(e) => closeTab(p, e)}
              // Coarse pointers: 36px hit area (glyph stays 12px); the min-h-9 tab
              // row grows ~3px to wrap it — taller touch tabs, no clipping.
              className="grid size-4 shrink-0 place-items-center rounded p-0 text-[#9aa0aa] hover:bg-[#2a2a30] hover:text-[#e6e6e6] [@media(pointer:coarse)]:size-[44px]"
            >
              {dirty ? (
                <span className="text-[13px] leading-none text-primary">●</span>
              ) : (
                <X className="size-3" />
              )}
            </Button>
          </div>
        );
      })}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        title="New file"
        aria-label="New file"
        onClick={onNew}
        className="grid h-auto w-8 shrink-0 place-items-center rounded-none p-0 text-[#9aa0aa] hover:bg-[#1b1b20] [@media(pointer:coarse)]:w-[44px]"
      >
        <Plus className="size-4" />
      </Button>
    </div>
  );
}
