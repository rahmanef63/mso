"use client";

import { Monitor, MonitorSmartphone, Wallpaper as WallpaperIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import {
  DEVICE_OPTIONS,
  uploadWallpaper,
  useAppearance,
  wallpaperLabel,
  type Device,
  type Wallpaper,
} from "@/lib/appearance";
import { ImagePickerButton, imageStyle, type ImageValue } from "@/features/image-picker";
import { setShell, shellsForSurface, useShellPrefs, useActiveShell, useDockPrefs, setDockPrefs, type ShellId, type DockSize } from "@/features/appshell";
import { SettingsRow as Row, SettingsSection as Section, SettingsBlock } from "@/features/shell-settings";
import { LiveWallpaperRows } from "./live-wallpaper-rows";
import { PerShellWallpaper } from "./per-shell-wallpaper";

const DOCK_SIZE_OPTIONS: { value: DockSize; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];

function ChoiceCard({
  active,
  label,
  hint,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  hint?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-20 rounded-2xl border bg-card/60 p-2.5 text-left transition hover:bg-accent/70",
        active ? "border-ring ring-2 ring-ring/40" : "border-border",
      )}
    >
      {children}
      <span className="mt-2 block text-xs font-semibold leading-tight">{label}</span>
      {hint && <span className="mt-0.5 block text-[10px] leading-tight text-muted-foreground">{hint}</span>}
    </button>
  );
}

function WallpaperPreview({ wallpaper, custom }: { wallpaper: Wallpaper; custom: ImageValue | null }) {
  if (custom) {
    return <span className="block h-16 rounded-xl bg-cover bg-center ring-1 ring-border" style={imageStyle(custom)} />;
  }
  return <span className={cn("block h-16 rounded-xl ring-1 ring-border", `wp-${wallpaper}`)} />;
}

export function AppearanceSection() {
  const { tweaks, setTweaks, setWallpaperImage } = useAppearance();
  const prefs = useShellPrefs();
  const dock = useDockPrefs();
  const { surface: activeSurface } = useActiveShell();
  const customWallpaper = tweaks.wallpaperImage;
  const shellOpts = (surface: "desktop" | "mobile") => shellsForSurface(surface);

  return (
    <div className="space-y-5">
      <Section
        icon={<WallpaperIcon />}
        title="Wallpaper"
        footnote="Auto follows the active shell's backdrop; colors come from the theme preset. Pick a custom image to override."
      >
        <SettingsBlock>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <WallpaperPreview wallpaper={customWallpaper ? "auto" : tweaks.wallpaper} custom={customWallpaper} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                {customWallpaper ? String(customWallpaper.metadata?.title ?? customWallpaper.metadata?.filename ?? "Custom image") : wallpaperLabel(tweaks.wallpaper)}
              </p>
              {customWallpaper && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-1 h-7 px-2 text-xs text-info hover:text-info [@media(pointer:coarse)]:min-h-[44px]"
                  onClick={() => {
                    setWallpaperImage(null);
                    setTweaks({ wallpaper: "auto" });
                  }}
                >
                  Reset to Auto
                </Button>
              )}
            </div>
            <ImagePickerButton
              label={customWallpaper ? "Change image" : "Choose image"}
              title="Set wallpaper"
              onChange={(img) => setWallpaperImage(img)}
              onUpload={uploadWallpaper}
              defaultQuery="macos wallpaper"
              className="w-full sm:w-auto"
            />
          </div>
        </SettingsBlock>
        <LiveWallpaperRows />
      </Section>

      <Section
        icon={<MonitorSmartphone />}
        title="Per-shell wallpaper"
        footnote="Give each shell its own backdrop. “Default” uses the shell's native wallpaper; a choice here overrides the global wallpaper for that shell only."
      >
        <PerShellWallpaper />
      </Section>

      <Section icon={<Monitor />} title="Shell & display">
        <Row label="Desktop shell">
          <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:grid-cols-3">
            {shellOpts("desktop").map((shell) => {
              const Icon = shell.icon;
              return (
                <ChoiceCard key={shell.id} active={prefs.desktop === shell.id} label={shell.label} onClick={() => setShell("desktop", shell.id as ShellId)}>
                  <span className="grid h-10 place-items-center rounded-xl bg-secondary text-muted-foreground"><Icon className="size-4" /></span>
                </ChoiceCard>
              );
            })}
          </div>
        </Row>
        <Row label="Mobile shell">
          <div className="grid w-full grid-cols-2 gap-2 sm:w-auto">
            {shellOpts("mobile").map((shell) => {
              const Icon = shell.icon;
              return (
                <ChoiceCard key={shell.id} active={prefs.mobile === shell.id} label={shell.label} onClick={() => setShell("mobile", shell.id as ShellId)}>
                  <span className="grid h-10 place-items-center rounded-xl bg-secondary text-muted-foreground"><Icon className="size-4" /></span>
                </ChoiceCard>
              );
            })}
          </div>
        </Row>
        <Row label="Device preview">
          <Segmented
            options={DEVICE_OPTIONS}
            value={tweaks.device}
            onChange={(v) => setTweaks({ device: v as Device })}
          />
        </Row>
        <Row label="Reduce transparency">
          <Switch checked={tweaks.reduceGlass} onCheckedChange={(reduceGlass) => setTweaks({ reduceGlass })} />
        </Row>
        {/* Dock controls apply to the macOS dock (desktop surface only). */}
        {activeSurface === "desktop" && (
          <>
            <Row label="Dock size">
              <Segmented options={DOCK_SIZE_OPTIONS} value={dock.size} onChange={(v) => setDockPrefs({ size: v as DockSize })} />
            </Row>
            <Row label="Dock magnification">
              <Switch checked={dock.magnify} onCheckedChange={(magnify) => setDockPrefs({ magnify })} />
            </Row>
          </>
        )}
      </Section>
    </div>
  );
}
