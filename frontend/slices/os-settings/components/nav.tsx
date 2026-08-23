"use client";

import { cn } from "@/lib/utils";
import { SECTIONS, type SectionId } from "../lib/sections";

export type { SectionId } from "../lib/sections";

export function SettingsTabs({ active, onSelect }: { active: SectionId; onSelect: (id: SectionId) => void }) {
  return (
    <nav role="tablist" aria-label="Settings" data-slot="settings-desktop-tabs" className="flex gap-1 overflow-x-auto p-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      {SECTIONS.map(({ id, label, icon: Icon, blurb }) => {
        const on = id === active;
        return (
          <button key={id} type="button" role="tab" aria-selected={on} title={blurb} onClick={() => onSelect(id)}
            className={cn("flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium leading-none transition-colors", on ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
          >
            <Icon className="size-4 shrink-0" />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function SettingsSidebar({ active, onSelect }: { active: SectionId; onSelect: (id: SectionId) => void }) {
  return (
    <nav role="tablist" aria-label="Settings sections" data-slot="settings-macos-sidebar" className="flex h-full flex-col gap-0.5 overflow-y-auto p-2">
      {SECTIONS.map(({ id, label, icon: Icon, color, blurb }) => {
        const on = id === active;
        return (
          <button key={id} type="button" role="tab" aria-selected={on} title={blurb} onClick={() => onSelect(id)}
            className={cn("flex min-h-9 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] font-medium leading-tight transition-colors", on ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent")}
          >
            <span className="grid size-[26px] shrink-0 place-items-center rounded-[7px] shadow-[0_1px_2px_rgba(0,0,0,0.25)]" style={{ background: color }}>
              <Icon className="size-[15px] text-white" />
            </span>
            <span className="min-w-0 flex-1 truncate">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
