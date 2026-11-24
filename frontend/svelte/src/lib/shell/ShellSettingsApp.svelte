<script lang="ts">
  import { onMount } from "svelte";
  import { createPrefsController, type PrefTweaks, type PrefsState, type ThemeMode } from "../settings/prefs-api.ts";
  import { CHROME_PROFILES, isChromeChoice, type ChromeChoice } from "./chrome-profile.ts";
  import { clampFontScale, DEFAULT_FONT_SCALE, MAX_FONT_SCALE, MIN_FONT_SCALE } from "./desktop-icons-data.ts";
  import {
    applyAppearanceToDom,
    buildShellTweaksPatch,
    DEFAULT_SHELL_PREFS,
    extractShellPrefsFromTweaks,
    isDesktopShell,
    isIosStyleVariant,
    isMobileShell,
    type DesktopShellId,
    type IosStyleVariant,
    type MobileShellId,
    type ShellPrefs,
  } from "./shell-prefs-store.ts";
  import { isWallpaperId, WALLPAPERS, type WallpaperId } from "./wallpaper-store.ts";

  let {
    role = null,
    chromeChoice = "auto",
    shellPrefs = { ...DEFAULT_SHELL_PREFS },
    wallpaper = "auto",
    onChromeChange,
    onShellPrefsChange,
    onThemeChange,
    onWallpaperChange,
  }: {
    role?: "viewer" | "operator" | "owner" | null;
    chromeChoice?: ChromeChoice;
    shellPrefs?: ShellPrefs;
    wallpaper?: WallpaperId;
    onChromeChange?: (c: ChromeChoice) => void;
    onShellPrefsChange?: (next: ShellPrefs) => void;
    onThemeChange?: (t: string) => void;
    onWallpaperChange?: (w: WallpaperId) => void;
  } = $props();

  let view = $state<PrefsState>({ kind: "loading" });
  let draftScale = $state<number | null>(null);
  let lastNotifiedTheme: string | null = null;
  let controller: ReturnType<typeof createPrefsController> | undefined;

  let isOwner = $derived(role === "owner");
  let tweaks = $derived<PrefTweaks>(view.kind === "ready" ? (view.prefs.tweaks ?? {}) : {});
  let themeMode = $derived<ThemeMode>(
    tweaks.theme === "light" || tweaks.theme === "dark" ? tweaks.theme : "system",
  );
  let selectedDesktop = $derived<DesktopShellId>(shellPrefs.desktop);
  let selectedMobile = $derived<MobileShellId>(shellPrefs.mobile);
  let selectedOverride = $derived<ChromeChoice>(shellPrefs.override ?? chromeChoice);
  let selectedIosStyle = $derived<IosStyleVariant>(shellPrefs.iosStyle);
  let activeWallpaper = $derived<WallpaperId>(
    isWallpaperId(tweaks.wallpaper) ? tweaks.wallpaper : wallpaper,
  );
  let savedScale = $derived<number>(
    clampFontScale(typeof tweaks.fontScale === "number" ? tweaks.fontScale : DEFAULT_FONT_SCALE),
  );
  let fontScale = $derived<number>(draftScale ?? savedScale);
  let reduceGlass = $derived<boolean>(Boolean(tweaks.reduceGlass));
  let highContrast = $derived<boolean>(Boolean(tweaks.highContrast));
  let reducedMotion = $derived<boolean>(Boolean(tweaks.reducedMotion));

  function notifyTheme(theme: ThemeMode) {
    if (lastNotifiedTheme !== theme) {
      lastNotifiedTheme = theme;
      onThemeChange?.(theme);
    }
  }

  export function refresh() {
    draftScale = null;
    void controller?.refresh();
  }

  async function savePatch(patch: PrefTweaks, after?: () => void) {
    if (!isOwner) return;
    if (await controller?.saveTweaks(patch)) after?.();
  }

  function updateShellPrefs(next: ShellPrefs) {
    onShellPrefsChange?.(next);
    if (next.override !== selectedOverride) onChromeChange?.(next.override);
    if (isOwner) {
      const patch = buildShellTweaksPatch(next, tweaks);
      void savePatch(patch);
    }
  }

  function handleDesktopSelect(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (!isDesktopShell(value)) return;
    updateShellPrefs({ ...shellPrefs, desktop: value });
  }

  function handleMobileSelect(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (!isMobileShell(value)) return;
    updateShellPrefs({ ...shellPrefs, mobile: value });
  }

  function handleOverrideSelect(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (!isChromeChoice(value)) return;
    updateShellPrefs({ ...shellPrefs, override: value });
  }

  function handleIosStyleSelect(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (!isIosStyleVariant(value)) return;
    updateShellPrefs({ ...shellPrefs, iosStyle: value });
  }

  function handleThemeSelect(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (value !== "system" && value !== "light" && value !== "dark") return;
    applyAppearanceToDom({ theme: value });
    notifyTheme(value);
    void savePatch({ theme: value });
  }

  function handleWallpaperSelect(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (!isWallpaperId(value)) return;
    onWallpaperChange?.(value);
    void savePatch({ wallpaper: value });
  }

  function handleScaleInput(event: Event) {
    if (!isOwner) return;
    const next = clampFontScale(Number((event.currentTarget as HTMLInputElement).value));
    draftScale = next;
    applyAppearanceToDom({ fontScale: next });
  }

  function handleScaleCommit(scale: number) {
    const clamped = clampFontScale(scale);
    draftScale = clamped;
    applyAppearanceToDom({ fontScale: clamped });
    void savePatch({ fontScale: clamped }, () => { draftScale = null; });
  }

  function handleA11yToggle(key: "reduceGlass" | "highContrast" | "reducedMotion", checked: boolean) {
    applyAppearanceToDom({ [key]: checked });
    void savePatch({ [key]: checked });
  }

  onMount(() => {
    controller = createPrefsController((next) => {
      if (next.kind === "ready") {
        draftScale = null;
        const t = next.prefs.tweaks;
        applyAppearanceToDom({
          fontScale: typeof t?.fontScale === "number" ? t.fontScale : DEFAULT_FONT_SCALE,
          reduceGlass: Boolean(t?.reduceGlass),
          highContrast: Boolean(t?.highContrast),
          reducedMotion: Boolean(t?.reducedMotion),
        });
        if (t?.theme) notifyTheme(t.theme);
        if (isWallpaperId(t?.wallpaper)) onWallpaperChange?.(t.wallpaper);
        const extracted = extractShellPrefsFromTweaks(t, shellPrefs);
        if (t?.shell || extracted.migratedFromLegacyPreset) {
          onShellPrefsChange?.(extracted.prefs);
        }
      }
      view = next;
    });
    void controller.refresh();
    return () => controller?.dispose();
  });
</script>

<section aria-labelledby="shell-settings-title" aria-busy={view.kind === "loading"} data-shell-settings={view.kind}>
  <header class="feature-header">
    <h2 id="shell-settings-title">Shell Settings</h2>
    <button type="button" disabled={view.kind === "loading"} onclick={refresh}>
      {view.kind === "loading" ? "Loading..." : "Refresh"}
    </button>
  </header>

  {#if !isOwner}
    <p class="feedback pending">Local shell choice saves on this device. Owner role is required to sync shared workspace preferences.</p>
  {/if}

  <div role="status" aria-live="polite">
    {#if view.kind === "loading"}
      <p>Loading shell preferences...</p>
    {:else if view.kind === "error"}
      <p class="feedback error" role="alert">{view.message}</p>
    {:else}
      {#if view.notice}<p class="feedback ok">{view.notice}</p>{/if}
      {#if view.actionError}<p class="feedback error" role="alert">{view.actionError}</p>{/if}

      <div class="ss-grid">
        <div class="field">
          <label for="ss-desktop-shell">Desktop shell (over 640px)</label>
          <select id="ss-desktop-shell" value={selectedDesktop} disabled={view.saving} onchange={handleDesktopSelect}>
            <option value="macos">macOS</option>
            <option value="windows">Windows</option>
            <option value="dashboard">Dashboard</option>
          </select>
        </div>
        <div class="field">
          <label for="ss-mobile-shell">Mobile shell (up to 640px)</label>
          <select id="ss-mobile-shell" value={selectedMobile} disabled={view.saving} onchange={handleMobileSelect}>
            <option value="ios">iOS</option>
            <option value="android">Android</option>
          </select>
        </div>
        <div class="field">
          <label for="ss-chrome">Active shell override</label>
          <select id="ss-chrome" value={selectedOverride} disabled={view.saving} onchange={handleOverrideSelect}>
            <option value="auto">Auto (use desktop / mobile choice)</option>
            {#each CHROME_PROFILES as profile (profile.id)}
              <option value={profile.id}>Pin {profile.label}</option>
            {/each}
          </select>
        </div>
        <div class="field">
          <label for="ss-ios-style">iOS presentation</label>
          <select id="ss-ios-style" value={selectedIosStyle} disabled={view.saving} onchange={handleIosStyleSelect}>
            <option value="classic">iOS Classic</option>
            <option value="modern">iOS Modern (glass controls)</option>
          </select>
        </div>
        <div class="field">
          <label for="ss-theme">Theme</label>
          <select id="ss-theme" value={themeMode} disabled={!isOwner || view.saving} onchange={handleThemeSelect}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
        <div class="field">
          <label for="ss-wallpaper">Wallpaper</label>
          <select id="ss-wallpaper" value={activeWallpaper} disabled={!isOwner || view.saving} onchange={handleWallpaperSelect}>
            {#each WALLPAPERS as wp (wp.id)}
              <option value={wp.id}>{wp.label}</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="ss-scale">
        <div class="ss-scale-head">
          <label for="ss-font-scale">Font scale ({Math.round(fontScale * 100)}%)</label>
          <button type="button" disabled={!isOwner || view.saving || fontScale === DEFAULT_FONT_SCALE} onclick={() => handleScaleCommit(DEFAULT_FONT_SCALE)}>
            Reset 100%
          </button>
        </div>
        <input id="ss-font-scale" type="range" min={MIN_FONT_SCALE} max={MAX_FONT_SCALE} step="0.05" value={fontScale} disabled={!isOwner || view.saving} oninput={handleScaleInput} onchange={(e) => handleScaleCommit(Number((e.currentTarget as HTMLInputElement).value))} />
      </div>

      <fieldset class="ss-toggles">
        <legend>Display and accessibility</legend>
        <label class="ss-toggle" for="ss-reduce-glass">
          <input id="ss-reduce-glass" type="checkbox" checked={reduceGlass} disabled={!isOwner || view.saving} onchange={(e) => handleA11yToggle("reduceGlass", (e.currentTarget as HTMLInputElement).checked)} />
          <span>Reduce glass transparency</span>
        </label>
        <label class="ss-toggle" for="ss-high-contrast">
          <input id="ss-high-contrast" type="checkbox" checked={highContrast} disabled={!isOwner || view.saving} onchange={(e) => handleA11yToggle("highContrast", (e.currentTarget as HTMLInputElement).checked)} />
          <span>High contrast borders and text</span>
        </label>
        <label class="ss-toggle" for="ss-reduced-motion">
          <input id="ss-reduced-motion" type="checkbox" checked={reducedMotion} disabled={!isOwner || view.saving} onchange={(e) => handleA11yToggle("reducedMotion", (e.currentTarget as HTMLInputElement).checked)} />
          <span>Reduce motion</span>
        </label>
      </fieldset>
    {/if}
  </div>
</section>

<style>
  .ss-grid { margin-top: 1rem; display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fit, minmax(min(12rem, 100%), 1fr)); }
  .ss-scale { margin-top: 1rem; display: grid; gap: 0.5rem; }
  .ss-scale-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
  .ss-scale-head label { font-size: 0.875rem; font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; }
  .ss-scale input[type="range"] { width: 100%; padding: 0; border: 0; background: transparent; accent-color: var(--accent); }
  .ss-toggles { margin: 1rem 0 0; padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; display: grid; gap: 0.5rem; }
  .ss-toggles legend { padding: 0 0.25rem; font-size: 0.875rem; font-weight: 600; color: var(--text); }
  .ss-toggle { display: inline-flex; align-items: center; gap: 0.625rem; min-height: var(--ui-control-height); font-weight: 600; color: var(--text); cursor: pointer; }
  .ss-toggle input { min-height: 1.25rem; width: 1.25rem; padding: 0; margin: 0; }
</style>
