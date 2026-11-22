<script lang="ts">
  import { onMount } from "svelte";
  import { createPrefsController, type PrefTweaks, type PrefsState, type ThemeMode } from "../settings/prefs-api.ts";
  import { CHROME_PROFILES, isChromeChoice, isChromeProfile, type ChromeChoice } from "./chrome-profile.ts";
  import { clampFontScale, DEFAULT_FONT_SCALE, MAX_FONT_SCALE, MIN_FONT_SCALE } from "./desktop-icons-data.ts";

  let {
    role = null,
    chromeChoice = "auto",
    onChromeChange,
    onThemeChange,
  }: {
    role?: "viewer" | "operator" | "owner" | null;
    chromeChoice?: ChromeChoice;
    onChromeChange?: (c: ChromeChoice) => void;
    onThemeChange?: (t: string) => void;
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
  let selectedChrome = $derived<ChromeChoice>(
    view.kind === "ready"
      ? isChromeProfile(tweaks.preset) ? tweaks.preset : tweaks.preset === null ? "auto" : chromeChoice
      : chromeChoice,
  );
  let savedScale = $derived<number>(
    clampFontScale(typeof tweaks.fontScale === "number" ? tweaks.fontScale : DEFAULT_FONT_SCALE),
  );
  let fontScale = $derived<number>(draftScale ?? savedScale);
  let reduceGlass = $derived<boolean>(Boolean(tweaks.reduceGlass));
  let highContrast = $derived<boolean>(Boolean(tweaks.highContrast));
  let reducedMotion = $derived<boolean>(Boolean(tweaks.reducedMotion));

  function applyFontScaleDom(scale: number) {
    if (typeof document === "undefined") return;
    document.documentElement.style.fontSize = `${Math.round(clampFontScale(scale) * 100)}%`;
  }

  function applyTweaksDom(next: PrefTweaks | undefined) {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    applyFontScaleDom(typeof next?.fontScale === "number" ? next.fontScale : DEFAULT_FONT_SCALE);
    if (next?.reduceGlass) root.dataset.reduceGlass = "true";
    else delete root.dataset.reduceGlass;
    if (next?.highContrast) root.dataset.highContrast = "true";
    else delete root.dataset.highContrast;
    if (next?.reducedMotion) root.dataset.reducedMotion = "true";
    else delete root.dataset.reducedMotion;
  }

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

  function handleChromeSelect(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (!isChromeChoice(value)) return;
    void savePatch({ preset: value === "auto" ? null : value }, () => onChromeChange?.(value));
  }

  function handleThemeSelect(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (value !== "system" && value !== "light" && value !== "dark") return;
    void savePatch({ theme: value }, () => notifyTheme(value));
  }

  function handleScaleInput(event: Event) {
    if (!isOwner) return;
    const next = clampFontScale(Number((event.currentTarget as HTMLInputElement).value));
    draftScale = next;
    applyFontScaleDom(next);
  }

  function handleScaleCommit(scale: number) {
    const clamped = clampFontScale(scale);
    draftScale = clamped;
    applyFontScaleDom(clamped);
    void savePatch({ fontScale: clamped }, () => { draftScale = null; });
  }

  onMount(() => {
    controller = createPrefsController((next) => {
      if (next.kind === "ready") {
        draftScale = null;
        applyTweaksDom(next.prefs.tweaks);
        if (next.prefs.tweaks?.theme) notifyTheme(next.prefs.tweaks.theme);
        if (isChromeProfile(next.prefs.tweaks?.preset)) onChromeChange?.(next.prefs.tweaks.preset);
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
    <p class="feedback pending">Read-only view. Owner role is required to update shared shell preferences.</p>
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
          <label for="ss-chrome">OS chrome profile</label>
          <select id="ss-chrome" value={selectedChrome} disabled={!isOwner || view.saving} onchange={handleChromeSelect}>
            <option value="auto">Auto (match viewport)</option>
            {#each CHROME_PROFILES as profile (profile.id)}
              <option value={profile.id}>{profile.label}</option>
            {/each}
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
          <input id="ss-reduce-glass" type="checkbox" checked={reduceGlass} disabled={!isOwner || view.saving} onchange={(e) => void savePatch({ reduceGlass: (e.currentTarget as HTMLInputElement).checked })} />
          <span>Reduce glass transparency</span>
        </label>
        <label class="ss-toggle" for="ss-high-contrast">
          <input id="ss-high-contrast" type="checkbox" checked={highContrast} disabled={!isOwner || view.saving} onchange={(e) => void savePatch({ highContrast: (e.currentTarget as HTMLInputElement).checked })} />
          <span>High contrast borders and text</span>
        </label>
        <label class="ss-toggle" for="ss-reduced-motion">
          <input id="ss-reduced-motion" type="checkbox" checked={reducedMotion} disabled={!isOwner || view.saving} onchange={(e) => void savePatch({ reducedMotion: (e.currentTarget as HTMLInputElement).checked })} />
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
