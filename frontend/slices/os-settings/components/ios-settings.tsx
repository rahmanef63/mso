"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { filterSettingsSections, groupSettingsSections, settingsSection, type SectionId } from "../lib/sections";
import { SettingsSectionBody } from "./sections";

// iOS System Settings owns only its CONTENT renderer. The mobile shell owns the
// single navigation bar: < Home | Settings | AI at root, then the published
// parent/detail state on drill-down. This file supplies Search + grouped content.
export function IosSettings({
  active,
  onSelect,
}: {
  active: SectionId | null;
  onSelect: (id: SectionId) => void;
}) {
  return active ? (
    <IosSettingsDetail id={active} />
  ) : (
    <IosSettingsIndex onSelect={onSelect} />
  );
}

function IosSettingsIndex({ onSelect }: { onSelect: (id: SectionId) => void }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterSettingsSections(query), [query]);
  const groups = useMemo(() => groupSettingsSections(filtered), [filtered]);

  return (
    <div data-slot="ios-settings-root" className="h-full overflow-y-auto bg-[var(--grouped)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="mx-auto w-full max-w-2xl px-4 pb-[calc(var(--sai-bottom,0px)+1.5rem)] pt-6">
        <label className="flex h-[38px] items-center gap-2 rounded-[11px] bg-[var(--fill)] px-3 text-muted-foreground">
          <Search className="size-[19px] shrink-0" aria-hidden />
          <span className="sr-only">Search settings</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            autoComplete="off"
            className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 !text-[17px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none"
          />
        </label>

        <nav aria-label="Settings sections" className="mt-5 space-y-6">
          {groups.map((group) => (
            <div key={group[0]?.group} data-slot="settings-card" className="overflow-hidden rounded-[16px] bg-card">
              {group.map((section) => {
                const Icon = section.icon;
                return (
                  <button
                    key={section.id}
                    type="button"
                    data-slot="settings-index-row"
                    onClick={() => onSelect(section.id)}
                    className={cn(
                      "relative flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left transition-colors",
                      "after:absolute after:inset-x-0 after:bottom-0 after:left-[60px] after:h-px after:bg-[var(--sep)] last:after:hidden",
                      "active:bg-[var(--fill)]",
                    )}
                  >
                    <span
                      className="grid size-[31px] shrink-0 place-items-center rounded-[8px] shadow-[0_1px_2px_rgba(0,0,0,0.22)]"
                      style={{ background: section.color }}
                    >
                      <Icon className="size-[18px] text-white" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[17px] font-normal leading-tight text-foreground">{section.label}</span>
                    <ChevronRight className="size-[17px] shrink-0 text-muted-foreground/55" aria-hidden />
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {filtered.length === 0 && (
          <p className="py-16 text-center text-[15px] text-muted-foreground">No settings found.</p>
        )}
      </div>
    </div>
  );
}

function IosSettingsDetail({ id }: { id: SectionId }) {
  const meta = settingsSection(id);
  // Appearance/Theme are control-first. About already has the Manef Shell OS
  // identity block, so a second category hero would duplicate its header.
  const showHero = id !== "appearance" && id !== "theme" && id !== "about";
  const Icon = meta.icon;

  return (
    <div data-slot="ios-settings-detail" className="h-full overflow-y-auto bg-[var(--grouped)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="mx-auto w-full max-w-2xl space-y-6 px-4 pb-[calc(var(--sai-bottom,0px)+1.5rem)] pt-4">
        {showHero && (
          <section data-slot="ios-settings-hero" className="rounded-[18px] bg-card px-5 py-6 text-center">
            <span className="mx-auto grid size-[64px] place-items-center rounded-[16px] shadow-[0_2px_5px_rgba(0,0,0,0.22)]" style={{ background: meta.color }}>
              <Icon className="size-9 text-white" aria-hidden />
            </span>
            <h1 className="mt-3 text-[24px] font-bold leading-tight tracking-[-0.02em] text-foreground">{meta.label}</h1>
            <p className="mx-auto mt-2 max-w-[32rem] text-[16px] leading-[1.35] text-foreground/90">{meta.blurb}</p>
          </section>
        )}
        <SettingsSectionBody id={id} />
      </div>
    </div>
  );
}
