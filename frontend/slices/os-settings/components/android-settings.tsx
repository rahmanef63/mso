"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { filterSettingsSections, groupSettingsSections, type SectionId } from "../lib/sections";

export function AndroidSettingsIndex({ onSelect }: { onSelect: (id: SectionId) => void }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterSettingsSections(query), [query]);
  const groups = useMemo(() => groupSettingsSections(filtered), [filtered]);

  return (
    <div data-slot="android-settings-root" className="h-full overflow-y-auto bg-background [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="mx-auto w-full max-w-2xl space-y-5 px-4 pb-[calc(var(--sai-bottom,0px)+1rem)] pt-4">
        <label className="flex min-h-14 items-center gap-3 rounded-full bg-secondary px-5 text-muted-foreground shadow-sm">
          <Search className="size-5 shrink-0" aria-hidden />
          <span className="sr-only">Search settings</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search settings"
            autoComplete="off"
            className="min-w-0 flex-1 border-0 bg-transparent p-0 !text-[16px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none"
          />
        </label>

        <nav aria-label="Settings sections" className="space-y-4">
          {groups.map((group) => (
            <div key={group[0]?.group} data-slot="settings-material-group" className="overflow-hidden rounded-[24px] bg-card shadow-sm">
              {group.map((section) => {
                const Icon = section.icon;
                return (
                  <button
                    key={section.id}
                    type="button"
                    data-slot="settings-material-row"
                    onClick={() => onSelect(section.id)}
                    className={cn(
                      "relative flex min-h-14 w-full items-center gap-4 px-4 py-2 text-left transition-colors active:bg-secondary",
                      "after:absolute after:bottom-0 after:left-[68px] after:right-4 after:h-px after:bg-border last:after:hidden",
                    )}
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-full text-white shadow-sm" style={{ background: section.color }}>
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[16px] font-medium text-foreground">{section.label}</span>
                      <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{section.blurb}</span>
                    </span>
                    <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {filtered.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">No settings found.</p> : null}
      </div>
    </div>
  );
}
