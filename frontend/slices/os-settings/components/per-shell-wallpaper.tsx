"use client";
/* Per-shell wallpaper picker (Settings → Per-shell wallpaper). Each registered
   shell (macOS/Windows/iOS/Android/Dashboard) gets a row to override its backdrop;
   "Default" clears the override so the shell falls back to its native wallpaper.
   Choices persist per-device (sv:wallpaper) and win over the global wallpaper for
   that shell. The shell list is read from the registry, so a new shell appears
   here with no edits. */
import { cn } from "@/lib/utils";
import {
  shellList,
  useShellWallpapers,
  setShellWallpaper,
  useWallpapers,
  type ShellId,
} from "@/features/appshell";
import { SettingsRow as Row } from "@/features/shell-settings";

// The static `.wp-*` preset keys with nicer labels than the raw key. Every
// shell's native default (ShellDescriptor.wallpaper) is one of these.
const PRESETS: { value: string; label: string }[] = [
  { value: "aurora", label: "Aurora" },
  { value: "graphite", label: "Graphite" },
  { value: "win11", label: "Windows 11" },
  { value: "material", label: "Material" },
  { value: "ios", label: "iOS" },
];
const LABELS: Record<string, string> = Object.fromEntries(PRESETS.map((p) => [p.value, p.label]));

export function PerShellWallpaper() {
  const overrides = useShellWallpapers();
  const live = useWallpapers();

  return (
    <div className="space-y-1">
      {shellList().map((shell) => {
        const current = overrides[shell.id] ?? "";
        const nativeKey = shell.wallpaper ?? "aurora";
        // Swatch shows the chosen preset, else the shell's native backdrop (a live
        // choice can't be previewed cheaply, so it shows the native swatch).
        const swatchKey = current && !current.startsWith("live:") ? current : nativeKey;
        return (
          <Row key={shell.id} label={shell.label}>
            <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
              <span className={cn("size-7 shrink-0 rounded-lg ring-1 ring-border", `wp-${swatchKey}`)} />
              <select
                value={current}
                onChange={(e) => setShellWallpaper(shell.id as ShellId, e.target.value || null)}
                aria-label={`Wallpaper for ${shell.label}`}
                className="h-8 min-w-40 max-w-full rounded-lg border border-border bg-card/60 px-2 text-xs [@media(pointer:coarse)]:min-h-[44px]"
              >
                <option value="">Default ({LABELS[nativeKey] ?? nativeKey})</option>
                <optgroup label="Presets">
                  {PRESETS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
                {live.length > 0 && (
                  <optgroup label="Live">
                    {live.map((d) => (
                      <option key={d.id} value={`live:${d.id}`}>
                        {d.label}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
          </Row>
        );
      })}
    </div>
  );
}
