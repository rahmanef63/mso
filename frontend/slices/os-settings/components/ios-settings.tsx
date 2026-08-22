"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SECTIONS, type SectionId } from "./nav";
import { SettingsSectionBody } from "./sections";

// iOS System Settings owns its navigation chrome instead of inheriting the
// generic fullscreen-app header. This keeps the hierarchy native: large title +
// Search at the root, then a blue "Settings" back affordance on detail pages.
export function IosSettings({
  active,
  onSelect,
  onBack,
}: {
  active: SectionId | null;
  onSelect: (id: SectionId) => void;
  onBack: () => void;
}) {
  return active ? (
    <IosSettingsDetail id={active} onBack={onBack} />
  ) : (
    <IosSettingsIndex onSelect={onSelect} />
  );
}

function IosSettingsIndex({ onSelect }: { onSelect: (id: SectionId) => void }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? SECTIONS.filter((s) => `${s.label} ${s.blurb}`.toLowerCase().includes(q))
      : SECTIONS;
  }, [query]);
  const groups = filtered.reduce<(typeof SECTIONS)[number][][]>((acc, section) => {
    const last = acc[acc.length - 1];
    if (last && last[0]?.group === section.group) last.push(section);
    else acc.push([section]);
    return acc;
  }, []);

  return (
    <div data-slot="ios-settings-root" className="h-full overflow-y-auto bg-[var(--grouped)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="mx-auto w-full max-w-2xl px-4 pb-[calc(var(--sai-bottom,0px)+1.5rem)] pt-[calc(var(--sai-top,0px)+2.5rem)]">
        <h1 className="px-0.5 text-[34px] font-bold leading-[1.05] tracking-[-0.025em] text-foreground">Settings</h1>

        <label className="mt-5 flex h-[38px] items-center gap-2 rounded-[11px] bg-[var(--fill)] px-3 text-muted-foreground">
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

function IosSettingsDetail({ id, onBack }: { id: SectionId; onBack: () => void }) {
  const meta = SECTIONS.find((s) => s.id === id)!;
  // Appearance/Theme already begin with strong visual controls, matching Apple's
  // Display & Brightness pattern. The other categories use the General/Wi‑Fi
  // style identity card before their grouped controls.
  const showHero = id !== "appearance" && id !== "theme";
  const Icon = meta.icon;

  return (
    <div data-slot="ios-settings-detail" className="flex h-full min-h-0 flex-col bg-[var(--grouped)]">
      <header className="shrink-0 bg-[var(--grouped)] pt-[var(--sai-top,0px)]">
        <div className="flex h-[48px] min-w-0 items-center px-1.5">
          <Button
            type="button"
            variant="ghost"
            onClick={onBack}
            className="h-[44px] shrink-0 gap-0 px-1 text-[17px] font-normal text-info hover:bg-transparent hover:text-info"
          >
            <ChevronLeft className="size-[25px]" aria-hidden />
            Settings
          </Button>
          {!showHero && (
            <h1 className="ml-2 min-w-0 truncate text-[17px] font-semibold tracking-[-0.01em] text-foreground">{meta.label}</h1>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="mx-auto w-full max-w-2xl space-y-6 px-4 pb-[calc(var(--sai-bottom,0px)+1.5rem)] pt-4">
          {showHero && (
            <section data-slot="ios-settings-hero" className="rounded-[18px] bg-card px-5 py-6 text-center">
              <span
                className="mx-auto grid size-[64px] place-items-center rounded-[16px] shadow-[0_2px_5px_rgba(0,0,0,0.22)]"
                style={{ background: meta.color }}
              >
                <Icon className="size-9 text-white" aria-hidden />
              </span>
              <h1 className="mt-3 text-[24px] font-bold leading-tight tracking-[-0.02em] text-foreground">{meta.label}</h1>
              <p className="mx-auto mt-2 max-w-[32rem] text-[16px] leading-[1.35] text-foreground/90">{meta.blurb}</p>
            </section>
          )}

          <SettingsSectionBody id={id} />
        </div>
      </div>
    </div>
  );
}
