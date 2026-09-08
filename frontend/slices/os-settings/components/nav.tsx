"use client";

import { useState } from "react";
import { Search, Monitor } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { filterSettingsSections, groupSettingsSections, SECTIONS, type SectionId } from "../lib/sections";

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

export function SettingsSidebar({ active, onSelect, windows = false }: { active: SectionId; onSelect: (id: SectionId) => void; windows?: boolean }) {
  const [query, setQuery] = useState("");
  const groups = groupSettingsSections(filterSettingsSections(query));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn("space-y-4 px-3 pb-3 pt-5", windows && "px-4")}>
        <Button variant="ghost" onClick={() => onSelect("about")} className="h-auto w-full justify-start gap-3 px-1 py-2 text-left">
          <span className={cn("grid size-11 shrink-0 place-items-center bg-secondary", windows ? "rounded-full" : "rounded-xl")}><Monitor className="size-6 text-muted-foreground" /></span>
          <span><span className="block text-sm font-semibold">MSO</span><span className="block text-xs font-normal text-muted-foreground">{windows ? "Settings" : "System Settings"}</span></span>
        </Button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
          <Input aria-label="Find a setting" placeholder={windows ? "Find a setting" : "Search"} value={query} onChange={(e) => setQuery(e.target.value)} className={cn("h-9 bg-background/70 pl-8 text-xs", windows ? "rounded-md border-b-2" : "rounded-lg")} />
        </div>
      </div>
      <nav aria-label="Settings sections" data-slot={windows ? "settings-windows-sidebar" : "settings-macos-sidebar"} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-2 pb-4">
        {groups.map((group) => <div key={group[0].group} className="space-y-0.5">
          <p className="px-2 pb-1 text-[11px] font-medium text-muted-foreground">{({ personalization: "Personalization", services: "Apps & connections", system: "System" })[group[0].group]}</p>
          {group.map(({ id, label, icon: Icon, color, blurb }) => {
            const on = id === active;
            return <Button key={id} variant="ghost" aria-current={on ? "page" : undefined} title={blurb} onClick={() => onSelect(id)}
              className={cn("relative h-auto min-h-9 w-full justify-start gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] font-normal", on ? windows ? "bg-accent text-accent-foreground hover:bg-accent" : "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground" : "text-foreground hover:bg-accent")}>
              {windows && on && <span className="absolute left-0 h-4 w-[3px] rounded-full bg-primary" />}
              <span className={cn("grid shrink-0 place-items-center", windows ? "size-7" : "size-[25px] rounded-md shadow-sm")} style={windows ? undefined : { background: color }}>
                <Icon className={cn("size-4", !windows && "text-white")} />
              </span>
              <span className="min-w-0 flex-1 truncate">{label}</span>
            </Button>;
          })}
        </div>)}
        {!groups.length && <p role="status" className="px-2 py-4 text-xs text-muted-foreground">No settings found.</p>}
      </nav>
    </div>
  );
}
