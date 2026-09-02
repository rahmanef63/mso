"use client";

import { useEffect, useState } from "react";
import { Check, RotateCcw, SunMoon, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import {
  FONT_SCALE_OPTIONS,
  THEME_MODE_OPTIONS,
  groupPresets,
  loadPresetRegistry,
  presetSwatches,
  useAppearance,
  type PresetGroup,
  type PresetItem,
  type Theme,
} from "@/lib/appearance";
import {
  SettingsSection as Section,
  SettingsRow as Row,
  SettingsBlock,
} from "@/features/shell-settings";
import { cn } from "@/lib/utils";
import { useShellDesign } from "@/features/appshell";
import { ThemeModePicker } from "./theme-mode-picker";

function PresetChip({ preset, active, onSelect }: { preset: PresetItem; active: boolean; onSelect: () => void }) {
  const swatches = presetSwatches(preset);
  // The preset owns the typeface too — surface which face it ships.
  const fontName = preset.cssVars?.theme?.["font-sans"]?.split(",")[0]?.replace(/['"]/g, "").trim();
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "flex min-h-10 items-center gap-2 rounded-lg border border-border bg-card/60 px-2.5 py-1.5 text-left transition-colors hover:bg-accent",
        active && "border-ring ring-2 ring-ring/40",
      )}
    >
      <span className="flex shrink-0 overflow-hidden rounded-md border border-border">
        {swatches.map((c, i) => <span key={i} className="size-4" style={{ background: c }} />)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{preset.title}</span>
        {fontName && <span className="block truncate text-[10px] leading-tight text-muted-foreground">{fontName}</span>}
      </span>
      {active && <Check className="size-3.5 shrink-0 text-primary" />}
    </button>
  );
}

// Compact live preview of the current theme.
function ThemePreview() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-pop)]">
      <div className="flex items-center gap-1.5 border-b border-border bg-sidebar px-2.5 py-1.5">
        <span className="size-2 rounded-full bg-destructive" />
        <span className="size-2 rounded-full bg-warning" />
        <span className="size-2 rounded-full bg-success" />
        <span className="ml-auto text-[10px] text-muted-foreground">Live preview</span>
      </div>
      <div className="space-y-1.5 p-2.5">
        <div className="h-2 w-20 rounded-full bg-foreground/80" />
        <div className="h-1.5 w-28 rounded-full bg-muted-foreground/35" />
        <div className="grid grid-cols-3 gap-1.5 pt-0.5">
          <span className="h-6 rounded-md bg-primary" />
          <span className="h-6 rounded-md bg-secondary" />
          <span className="h-6 rounded-md bg-muted" />
        </div>
      </div>
    </div>
  );
}

export function ThemeSection() {
  const { tweaks, setTweaks } = useAppearance();
  const design = useShellDesign();
  const mobile = design.mobileNavigation !== "none";
  const [groups, setGroups] = useState<PresetGroup[] | null>(null);

  useEffect(() => {
    loadPresetRegistry()
      .then((reg) => setGroups(groupPresets(reg.items)))
      .catch(() => setGroups([]));
  }, []);

  return (
    <div className="space-y-4 sm:space-y-5">
      <Section icon={<SunMoon />} title="Display">
        <SettingsBlock>
          {mobile ? (
            <ThemeModePicker value={tweaks.theme} onChange={(theme) => setTweaks({ theme })} />
          ) : (
            <ThemePreview />
          )}
        </SettingsBlock>
        {!mobile && (
          <Row label="Appearance">
            <Segmented options={THEME_MODE_OPTIONS} value={tweaks.theme} onChange={(v) => setTweaks({ theme: v as Theme })} />
          </Row>
        )}
        <Row label="Text size">
          <Segmented options={FONT_SCALE_OPTIONS} value={String(tweaks.fontScale)} onChange={(v) => setTweaks({ fontScale: Number(v) })} />
        </Row>
        <Row label="High contrast">
          <Switch checked={tweaks.highContrast} onCheckedChange={(highContrast) => setTweaks({ highContrast })} />
        </Row>
      </Section>

      {/* bare: the preset picker is a grid of selectable swatch tiles, not a
          grouped list — no card wrapper (avoids card-in-card). */}
      <Section
        icon={<Type />}
        title="Theme presets"
        bare
        footnote="One preset = colors, radius and typeface (fonts auto-load)."
      >
        <div className="flex items-center justify-end pb-1.5">
          <Button type="button" variant="secondary" size="sm" disabled={!tweaks.preset} onClick={() => setTweaks({ preset: null })}>
            <RotateCcw /> Stock
          </Button>
        </div>
        {groups === null ? (
          <p className="px-1 text-xs text-muted-foreground">Loading presets…</p>
        ) : (
          <div className="space-y-3">
            {groups.map((group) => (
              <div key={group.id} className="space-y-1.5">
                <div className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{group.label}</div>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {group.items.map((p) => (
                    <PresetChip key={p.name} preset={p} active={tweaks.preset === p.name} onSelect={() => setTweaks({ preset: p.name })} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
