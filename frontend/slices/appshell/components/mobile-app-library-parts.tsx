"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AppDescriptor } from "../lib/types";
import { AppIcon } from "./app-icon";

// One iPhone folder-card: a 2×2 cell grid. ≤4 apps → big icons; >4 → 3 big + a
// 2×2 mini cluster for the rest. Big icon = launch; cluster/label = open folder.
export function FolderCard({
  name,
  apps,
  onOpen,
  onExpand,
}: {
  name: string;
  apps: AppDescriptor[];
  onOpen: (app: AppDescriptor) => void;
  onExpand: () => void;
}) {
  const overflow = apps.length > 4;
  const big = overflow ? apps.slice(0, 3) : apps.slice(0, 4);
  const rest = overflow ? apps.slice(3) : [];

  return (
    <Button type="button" variant="ghost" onClick={onExpand} className="h-auto p-0 hover:bg-transparent flex flex-col items-center gap-1.5" aria-label={`${name} folder`}>
      <div
        className="glass grid aspect-square w-full grid-cols-2 grid-rows-2 gap-2 rounded-[22px] border border-white/15 p-2.5"
        style={{ background: "var(--glass-panel)" }}
      >
        {big.map((a) => (
          <span
            key={a.id}
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(a);
            }}
            className="block size-full"
          >
            <AppIcon app={a} />
          </span>
        ))}
        {rest.length > 0 && (
          <span className="grid grid-cols-2 grid-rows-2 place-items-center gap-1">
            {rest.slice(0, 4).map((a) => (
              <span key={a.id} className="block size-full opacity-90">
                <AppIcon app={a} />
              </span>
            ))}
          </span>
        )}
        {!overflow &&
          Array.from({ length: 4 - big.length }).map((_, i) => <span key={`pad-${i}`} />)}
      </div>
      <span className={cn("max-w-full truncate text-[12px] font-normal leading-4 text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.5)]")}>
        {name}
      </span>
    </Button>
  );
}

// A–Z list shown while searching (iPhone App Library search view).
export function AlphaList({
  apps,
  q,
  onOpen,
}: {
  apps: AppDescriptor[];
  q: string;
  onOpen: (app: AppDescriptor) => void;
}) {
  if (apps.length === 0) return <p className="px-1 text-sm text-white/60">No apps match “{q}”.</p>;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]">
      {apps.map((a, i) => {
        // Header when this app's letter differs from the previous one — derived
        // from the index, no render-scope reassignment (react-hooks/immutability).
        const letter = a.title[0]?.toUpperCase() ?? "#";
        const prevLetter = i > 0 ? (apps[i - 1].title[0]?.toUpperCase() ?? "#") : null;
        const header = letter !== prevLetter ? letter : null;
        return (
          <div key={a.id}>
            {header && (
              <div className="px-1 pb-1 pt-2 text-[13px] font-semibold leading-[18px] tracking-[-0.08px] text-white/70 [text-shadow:0_1px_2px_rgba(0,0,0,0.5)]">
                {header}
              </div>
            )}
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpen(a)}
              className="flex h-auto min-h-11 w-full items-center gap-3 rounded-xl px-4 py-1.5 text-left hover:bg-white/10"
            >
              <span className="size-9 shrink-0">
                <AppIcon app={a} />
              </span>
              <span className="text-[17px] font-normal leading-[22px] tracking-[-0.43px] text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.5)]">{a.title}</span>
            </Button>
          </div>
        );
      })}
    </div>
  );
}
