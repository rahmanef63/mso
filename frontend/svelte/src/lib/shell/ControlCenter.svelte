<script lang="ts">
  import { tick } from "svelte";
  import AppleSegmented from "./AppleSegmented.svelte";
  import {
    CHROME_PROFILES,
    isChromeChoice,
    type ChromeChoice,
    type ChromeProfile,
  } from "./chrome-profile.ts";
  import { applyAppearanceToDom } from "./shell-prefs-store.ts";
  import { readStats } from "../host-api.ts";

  type ThemeChoice = "system" | "light" | "dark";
  type Tone = "info" | "ok" | "warn";

  let {
    open,
    theme,
    chromeChoice,
    resolvedChrome,
    role,
    openWindowCount,
    onThemeChange,
    onChromeChange,
    onLock,
    onOpenForceQuit,
    onClose,
    brightness = 85,
    volume = 70,
    nightShift = false,
    isDark,
    onBrightnessChange,
    onVolumeChange,
    onNightShiftChange,
  }: {
    open: boolean;
    theme: string;
    chromeChoice: ChromeChoice;
    resolvedChrome: ChromeProfile;
    role: string | null;
    openWindowCount: number;
    onThemeChange: (t: ThemeChoice) => void;
    onChromeChange: (c: ChromeChoice) => void;
    onLock: () => void;
    onOpenForceQuit: () => void;
    onClose: () => void;
    brightness?: number;
    volume?: number;
    nightShift?: boolean;
    /** WorkspaceRoot resolves this; falls back to the live media query when omitted. */
    isDark?: boolean;
    onBrightnessChange?: (v: number) => void;
    onVolumeChange?: (v: number) => void;
    onNightShiftChange?: (v: boolean) => void;
  } = $props();

  const THEME_OPTIONS = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "auto", label: "Auto" },
  ];

  let closeBtn = $state<HTMLButtonElement | null>(null);
  let localBrightness = $state(85);
  let localVolume = $state(70);
  let localNightShift = $state(false);
  let activeSlider = $state<"brightness" | "volume" | null>(null);
  let systemDark = $state(false);
  let toast = $state<{ id: number; title: string; detail?: string; tone: Tone } | null>(null);
  let toastSeq = 0;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  let normalizedTheme = $derived<ThemeChoice>(
    theme === "light" || theme === "dark" ? theme : "system",
  );
  let darkActive = $derived(isDark ?? (normalizedTheme === "dark" || (normalizedTheme === "system" && systemDark)));
  let isPhoneChrome = $derived(resolvedChrome === "ios" || resolvedChrome === "android");
  let themeSegment = $derived(normalizedTheme === "system" ? "auto" : normalizedTheme);
  let reduceGlassOn = $state(false);
  let highContrastOn = $state(false);
  let refreshBusy = $state(false);

  $effect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    systemDark = mq.matches;
    const onChange = (event: MediaQueryListEvent) => {
      systemDark = event.matches;
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  });

  $effect(() => {
    if (!open) return;
    const root = document.documentElement;
    reduceGlassOn = root.dataset.reduceGlass === "true";
    highContrastOn = root.dataset.highContrast === "true";
  });

  $effect(() => {
    localBrightness = Math.max(5, Math.min(100, Math.round(brightness)));
  });

  $effect(() => {
    localVolume = Math.max(0, Math.min(100, Math.round(volume)));
  });

  $effect(() => {
    localNightShift = Boolean(nightShift);
  });

  $effect(() => {
    if (!open) return;
    void tick().then(() => {
      closeBtn?.focus();
    });
  });

  $effect(() => {
    return () => {
      if (toastTimer !== null) clearTimeout(toastTimer);
    };
  });

  function notify(title: string, detail: string | undefined, tone: Tone) {
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastSeq += 1;
    toast = { id: toastSeq, title, ...(detail ? { detail } : {}), tone };
    toastTimer = setTimeout(() => {
      toast = null;
      toastTimer = null;
    }, 3600);
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  function handleChromeSelect(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (isChromeChoice(value)) {
      onChromeChange(value);
    }
  }

  function handleThemeSegment(next: string) {
    const mode: ThemeChoice = next === "light" || next === "dark" ? next : "system";
    onThemeChange(mode);
    notify(`Appearance set to ${mode === "system" ? "Auto" : mode}`, "Applies to every open window.", "info");
  }

  function toggleDark() {
    const next: ThemeChoice = darkActive ? "light" : "dark";
    onThemeChange(next);
    notify(`Appearance set to ${next}`, "Applies to every open window.", "info");
  }

  function toggleNightShift() {
    const next = !localNightShift;
    localNightShift = next;
    onNightShiftChange?.(next);
    notify(
      next ? "Night Shift on" : "Night Shift off",
      next ? "Warmer wallpaper filter applied." : "Wallpaper filter removed.",
      "info",
    );
  }

  function refreshHost() {
    if (refreshBusy) return;
    refreshBusy = true;
    const ctrl = new AbortController();
    readStats(ctrl.signal)
      .then((stats) => {
        const pct = Math.round(stats.cpu.pct);
        notify(
          "Host status refreshed",
          `${pct}% CPU across ${stats.cpu.cores} ${stats.cpu.cores === 1 ? "core" : "cores"}, uptime ${formatUptime(stats.uptime)}.`,
          "ok",
        );
      })
      .catch(() => {
        notify("Host status unavailable", "The host did not answer the stats request.", "warn");
      })
      .finally(() => {
        refreshBusy = false;
      });
  }

  function formatUptime(seconds: number): string {
    const total = Math.max(0, Math.round(seconds));
    const days = Math.floor(total / 86_400);
    const hours = Math.floor((total % 86_400) / 3_600);
    if (days > 0) return `${days}d ${hours}h`;
    const minutes = Math.floor((total % 3_600) / 60);
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  }

  function toggleReduceGlass() {
    const next = !reduceGlassOn;
    reduceGlassOn = next;
    applyAppearanceToDom({ reduceGlass: next });
    notify(next ? "Reduce Glass on" : "Reduce Glass off", next ? "Solid surfaces replace blur." : "Glass material restored.", "info");
  }

  function toggleHighContrast() {
    const next = !highContrastOn;
    highContrastOn = next;
    applyAppearanceToDom({ highContrast: next });
    notify(next ? "High Contrast on" : "High Contrast off", next ? "Stronger borders and text." : "Standard contrast restored.", "info");
  }

  async function copyWorkspaceUrl() {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      notify("Workspace link copied", url, "ok");
    } catch {
      notify("Could not copy the workspace link", "Copy it from the address bar instead.", "warn");
    }
  }

  function updateSliderFromPointer(
    kind: "brightness" | "volume",
    el: HTMLElement,
    clientY: number,
  ) {
    const rect = el.getBoundingClientRect();
    if (rect.height <= 0) return;
    const raw = Math.round(((rect.bottom - clientY) / rect.height) * 100);
    if (kind === "brightness") {
      const next = Math.max(5, Math.min(100, raw));
      localBrightness = next;
      onBrightnessChange?.(next);
    } else {
      const next = Math.max(0, Math.min(100, raw));
      localVolume = next;
      onVolumeChange?.(next);
    }
  }

  function handleSliderDown(kind: "brightness" | "volume", event: PointerEvent) {
    const el = event.currentTarget as HTMLElement;
    activeSlider = kind;
    if (typeof el.setPointerCapture === "function") {
      try {
        el.setPointerCapture(event.pointerId);
      } catch {
        /* pointer capture optional */
      }
    }
    updateSliderFromPointer(kind, el, event.clientY);
  }

  function handleSliderMove(kind: "brightness" | "volume", event: PointerEvent) {
    if (activeSlider !== kind) return;
    updateSliderFromPointer(kind, event.currentTarget as HTMLElement, event.clientY);
  }

  function handleSliderUp(event: PointerEvent) {
    if (activeSlider === null) return;
    const el = event.currentTarget as HTMLElement;
    if (typeof el.releasePointerCapture === "function") {
      try {
        el.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore if already released */
      }
    }
    activeSlider = null;
  }

  function handleSliderKeydown(kind: "brightness" | "volume", event: KeyboardEvent) {
    const step = event.shiftKey ? 10 : 5;
    let delta = 0;
    if (event.key === "ArrowUp" || event.key === "ArrowRight") delta = step;
    else if (event.key === "ArrowDown" || event.key === "ArrowLeft") delta = -step;
    else if (event.key === "Home") delta = -100;
    else if (event.key === "End") delta = 100;
    else return;

    event.preventDefault();
    if (kind === "brightness") {
      const next = Math.max(5, Math.min(100, localBrightness + delta));
      localBrightness = next;
      onBrightnessChange?.(next);
    } else {
      const next = Math.max(0, Math.min(100, localVolume + delta));
      localVolume = next;
      onVolumeChange?.(next);
    }
  }

  function triggerLock() {
    onClose();
    onLock();
  }

  function triggerForceQuit() {
    onClose();
    onOpenForceQuit();
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if open}
  <div class="cc-layer" class:cc-phone={isPhoneChrome}>
    <button
      type="button"
      class="cc-backdrop"
      aria-label="Close control center"
      tabindex="-1"
      onclick={onClose}
    ></button>

    <div
      class="cc-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="control-center-title"
    >
      <h2 id="control-center-title" class="sr-only">Control Center</h2>

      <div class="cc-top-grid">
        <div class="cc-card cc-conn-grid" aria-label="Connectivity">
          <button
            type="button"
            class="cc-circle cc-circle-lg"
            aria-label="Refresh host status"
            title="Refresh host status"
            onclick={refreshHost}
          >
            <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="8.4" />
              <path d="M3.6 12h16.8M12 3.6c2.6 2.6 2.6 14.2 0 16.8M12 3.6c-2.6 2.6-2.6 14.2 0 16.8" />
            </svg>
          </button>

          <button
            type="button"
            class="cc-circle cc-circle-lg"
            class:on-tint={reduceGlassOn}
            aria-label="Reduce Glass"
            aria-pressed={reduceGlassOn}
            title="Reduce Glass"
            onclick={toggleReduceGlass}
          >
            <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3.6" y="4.6" width="16.8" height="14.8" rx="3" />
              <path d="M3.6 9.4h16.8M8 4.6v14.8" />
            </svg>
          </button>

          <button
            type="button"
            class="cc-circle cc-circle-lg"
            class:on-tint={highContrastOn}
            aria-label="High Contrast"
            aria-pressed={highContrastOn}
            title="High Contrast"
            onclick={toggleHighContrast}
          >
            <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
              <circle cx="12" cy="12" r="8.4" />
              <path d="M12 3.6v16.8a8.4 8.4 0 0 0 0-16.8z" fill="currentColor" stroke="none" />
            </svg>
          </button>

          <button
            type="button"
            class="cc-circle cc-circle-lg"
            aria-label="Share"
            title="Copy workspace link"
            onclick={() => void copyWorkspaceUrl()}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 3v12M8.4 6.4L12 2.8l3.6 3.6M5.5 11.5V19a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-7.5" />
            </svg>
          </button>
        </div>

        <div class="cc-card cc-quick-grid" aria-label="Quick actions">
          <button
            type="button"
            class="cc-quick-item"
            aria-pressed={isDark}
            onclick={toggleDark}
          >
            <span class="cc-circle cc-circle-md" class:on-indigo={isDark} aria-hidden="true">
              <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor">
                <path d="M20.5 15.2A8.4 8.4 0 0 1 9.3 3.9a8.4 8.4 0 1 0 11.2 11.3z" />
              </svg>
            </span>
            <span class="cc-quick-label">Dark</span>
          </button>

          <button type="button" class="cc-quick-item" onclick={triggerLock}>
            <span class="cc-circle cc-circle-md" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                <rect x="5.5" y="10.5" width="13" height="9" rx="2.2" />
                <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
              </svg>
            </span>
            <span class="cc-quick-label">Lock</span>
          </button>

          <button type="button" class="cc-quick-item" onclick={triggerForceQuit}>
            <span class="cc-circle cc-circle-md" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 8h9M17 8h3M4 16h3M11 16h9" />
                <circle cx="15" cy="8" r="2.3" fill="currentColor" stroke="none" />
                <circle cx="9" cy="16" r="2.3" fill="currentColor" stroke="none" />
              </svg>
            </span>
            <span class="cc-quick-label">Force Quit</span>
          </button>

          <button
            type="button"
            bind:this={closeBtn}
            class="cc-quick-item"
            onclick={onClose}
          >
            <span class="cc-circle cc-circle-md" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </span>
            <span class="cc-quick-label">Close</span>
          </button>
        </div>
      </div>

      <div class="cc-sliders-grid">
        <div
          class="cc-vslider"
          role="slider"
          tabindex="0"
          aria-label="Brightness"
          aria-valuemin={5}
          aria-valuemax={100}
          aria-valuenow={localBrightness}
          onpointerdown={(e) => handleSliderDown("brightness", e)}
          onpointermove={(e) => handleSliderMove("brightness", e)}
          onpointerup={handleSliderUp}
          onpointercancel={handleSliderUp}
          onkeydown={(e) => handleSliderKeydown("brightness", e)}
        >
          <div class="cc-vslider-fill" style:height={`${localBrightness}%`}></div>
          <svg viewBox="0 0 24 24" width="22" height="22" class="cc-vslider-icon" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
          </svg>
        </div>

        <div
          class="cc-vslider"
          role="slider"
          tabindex="0"
          aria-label="Volume"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={localVolume}
          onpointerdown={(e) => handleSliderDown("volume", e)}
          onpointermove={(e) => handleSliderMove("volume", e)}
          onpointerup={handleSliderUp}
          onpointercancel={handleSliderUp}
          onkeydown={(e) => handleSliderKeydown("volume", e)}
        >
          <div class="cc-vslider-fill" style:height={`${localVolume}%`}></div>
          <svg viewBox="0 0 24 24" width="22" height="22" class="cc-vslider-icon" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 9.5v5h3l5 4V5.5l-5 4H4z" fill="currentColor" />
            <path d="M16 9.5a4 4 0 0 1 0 5M18.5 7.5a7 7 0 0 1 0 9" />
          </svg>
        </div>
      </div>

      <div class="cc-session-card">
        <div class="cc-session-row">
          <div class="cc-session-meta" aria-label="Workspace summary">
            <span class="cc-meta-chip">{role ?? "Signed out"}</span>
            <span class="cc-meta-chip">{openWindowCount} {openWindowCount === 1 ? "window" : "windows"}</span>
          </div>
          <button
            type="button"
            class="cc-night-pill"
            class:active={localNightShift}
            aria-pressed={localNightShift}
            onclick={toggleNightShift}
          >
            Night Shift
          </button>
        </div>

        <div class="cc-select-grid">
          <div class="cc-field cc-field-theme">
            <span class="cc-field-label">Theme</span>
            <AppleSegmented
              options={THEME_OPTIONS}
              value={themeSegment}
              ariaLabel="Theme mode"
              onChange={handleThemeSegment}
            />
          </div>

          <div class="cc-field">
            <label for="cc-chrome-select">Shell chrome</label>
            <select
              id="cc-chrome-select"
              aria-label="Shell chrome"
              title="Shell chrome"
              value={chromeChoice}
              onchange={handleChromeSelect}
            >
              <option value="auto">Auto ({resolvedChrome})</option>
              {#each CHROME_PROFILES as profile (profile.id)}
                <option value={profile.id}>{profile.label}</option>
              {/each}
            </select>
          </div>
        </div>
      </div>

      {#if toast}
        <div class="cc-toast" role="status" data-toast-tone={toast.tone}>
          <strong>{toast.title}</strong>
          {#if toast.detail}<span>{toast.detail}</span>{/if}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  @keyframes ccIn {
    from {
      opacity: 0;
      transform: scale(0.92);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  .cc-layer {
    position: fixed;
    inset: 0;
    z-index: 8400;
    pointer-events: auto;
  }

  .cc-backdrop {
    position: fixed;
    inset: 0;
    min-height: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    cursor: default;
  }

  .cc-layer.cc-phone .cc-backdrop {
    background: rgba(0, 0, 0, 0.22);
  }

  .cc-dialog {
    position: fixed;
    top: 30px;
    right: 12px;
    z-index: 2;
    width: 334px;
    max-width: calc(100vw - 16px);
    max-height: calc(100dvh - 44px);
    overflow-y: auto;
    padding: 14px;
    border-radius: 30px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    color: var(--label, #1c1c1e);
    background: var(--glass-bg, rgba(252, 252, 254, 0.62));
    border: 0.5px solid var(--glass-stroke, rgba(255, 255, 255, 0.7));
    box-shadow:
      inset 0 0.5px 0 var(--glass-hi, rgba(255, 255, 255, 0.95)),
      0 20px 55px var(--glass-shadow, rgba(0, 0, 0, 0.18));
    -webkit-backdrop-filter: blur(var(--blur, 26px)) saturate(180%);
    backdrop-filter: blur(var(--blur, 26px)) saturate(180%);
    animation: ccIn 0.28s cubic-bezier(0.32, 0.72, 0, 1);
    transform-origin: top right;
  }

  .cc-layer.cc-phone .cc-dialog {
    top: 10px;
    left: 8px;
    right: 8px;
    width: auto;
    transform-origin: top center;
  }

  @media (max-width: 40rem) {
    .cc-dialog {
      top: 10px;
      left: 8px;
      right: 8px;
      width: auto;
      transform-origin: top center;
    }
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .cc-dialog {
      color: var(--label, #ffffff);
      background: var(--glass-bg, rgba(44, 44, 50, 0.55));
      border-color: var(--glass-stroke, rgba(255, 255, 255, 0.14));
      box-shadow:
        inset 0 0.5px 0 var(--glass-hi, rgba(255, 255, 255, 0.2)),
        0 20px 55px var(--glass-shadow, rgba(0, 0, 0, 0.55));
    }
  }

  :global(:root[data-theme="dark"]) .cc-dialog {
    color: var(--label, #ffffff);
    background: var(--glass-bg, rgba(44, 44, 50, 0.55));
    border-color: var(--glass-stroke, rgba(255, 255, 255, 0.14));
    box-shadow:
      inset 0 0.5px 0 var(--glass-hi, rgba(255, 255, 255, 0.2)),
      0 20px 55px var(--glass-shadow, rgba(0, 0, 0, 0.55));
  }

  .cc-top-grid,
  .cc-sliders-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .cc-card {
    background: rgba(120, 120, 128, 0.16);
    border-radius: 22px;
  }

  .cc-conn-grid {
    padding: 15px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 15px 8px;
    place-items: center;
  }

  .cc-quick-grid {
    padding: 13px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px 8px;
    place-items: center;
  }

  .cc-circle {
    border-radius: 50%;
    border: 0;
    padding: 0;
    min-height: 0;
    background: rgba(120, 120, 128, 0.32);
    color: #ffffff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background-color var(--durF, 0.2s) ease, transform 120ms ease;
  }

  .cc-circle-lg {
    width: 44px;
    height: 44px;
  }

  .cc-circle-md {
    width: 40px;
    height: 40px;
  }

  .cc-circle.on-tint {
    background: var(--tint, var(--accent, #007aff));
  }

  .cc-circle.on-indigo {
    background: #5e5ce6;
  }

  .cc-circle:active {
    transform: scale(0.93);
  }

  .cc-quick-item {
    min-height: 0;
    padding: 0;
    border: 0;
    border-radius: 12px;
    background: transparent;
    color: inherit;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    cursor: pointer;
  }

  .cc-quick-item:hover .cc-circle:not(.on-indigo) {
    background: rgba(120, 120, 128, 0.5);
  }

  .cc-quick-label {
    font-size: 9px;
    font-weight: 600;
    line-height: 1.1;
    color: var(--label2, rgba(60, 60, 67, 0.6));
    white-space: nowrap;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .cc-quick-label {
      color: var(--label2, rgba(235, 235, 245, 0.6));
    }
  }

  :global(:root[data-theme="dark"]) .cc-quick-label {
    color: var(--label2, rgba(235, 235, 245, 0.6));
  }

  .cc-vslider {
    position: relative;
    height: 132px;
    border-radius: 22px;
    overflow: hidden;
    background: rgba(120, 120, 128, 0.22);
    cursor: pointer;
    touch-action: none;
    user-select: none;
  }

  .cc-vslider:focus-visible {
    outline: 2px solid var(--tint, var(--accent, #007aff));
    outline-offset: 2px;
  }

  .cc-vslider-fill {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    background: #ffffff;
    pointer-events: none;
  }

  .cc-vslider-icon {
    position: absolute;
    left: 50%;
    bottom: 13px;
    transform: translateX(-50%);
    color: rgba(0, 0, 0, 0.5);
    pointer-events: none;
  }

  .cc-session-card {
    background: rgba(120, 120, 128, 0.16);
    border-radius: 18px;
    padding: 11px 12px;
    display: grid;
    gap: 10px;
  }

  .cc-session-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .cc-session-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    min-width: 0;
  }

  .cc-meta-chip {
    font-size: 11px;
    font-weight: 600;
    line-height: 1.2;
    padding: 3px 8px;
    border-radius: 999px;
    background: var(--fill, rgba(118, 118, 128, 0.14));
    color: var(--label, #1c1c1e);
    text-transform: capitalize;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .cc-meta-chip {
      background: var(--fill, rgba(120, 120, 128, 0.24));
      color: var(--label, #ffffff);
    }
  }

  :global(:root[data-theme="dark"]) .cc-meta-chip {
    background: var(--fill, rgba(120, 120, 128, 0.24));
    color: var(--label, #ffffff);
  }

  .cc-night-pill {
    min-height: 24px;
    height: 24px;
    padding: 0 9px;
    border: 0;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    background: rgba(120, 120, 128, 0.3);
    color: var(--label, #1c1c1e);
    white-space: nowrap;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .cc-night-pill {
      color: var(--label, #ffffff);
    }
  }

  :global(:root[data-theme="dark"]) .cc-night-pill {
    color: var(--label, #ffffff);
  }

  .cc-night-pill.active {
    background: #ff9f0a;
    color: #ffffff;
  }

  .cc-select-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .cc-field {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .cc-field-theme {
    gap: 6px;
  }

  .cc-field-label {
    font-size: 10.5px;
    font-weight: 600;
    color: var(--label2, rgba(60, 60, 67, 0.6));
  }

  .cc-toast {
    position: absolute;
    left: 14px;
    right: 14px;
    bottom: 12px;
    display: grid;
    gap: 2px;
    padding: 9px 12px;
    border-radius: 14px;
    font-size: 12px;
    line-height: 1.3;
    color: var(--label, #1c1c1e);
    background: var(--glass-bg, rgba(252, 252, 254, 0.82));
    border: 0.5px solid var(--glass-stroke, rgba(255, 255, 255, 0.7));
    box-shadow: 0 10px 26px var(--glass-shadow, rgba(0, 0, 0, 0.18));
    -webkit-backdrop-filter: blur(20px) saturate(180%);
    backdrop-filter: blur(20px) saturate(180%);
    animation: ccIn 0.22s cubic-bezier(0.32, 0.72, 0, 1);
  }

  .cc-toast strong {
    font-size: 12.5px;
    font-weight: 600;
  }

  .cc-toast span {
    color: var(--label2, rgba(60, 60, 67, 0.72));
    overflow-wrap: anywhere;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .cc-toast {
      color: var(--label, #ffffff);
      background: var(--glass-bg, rgba(44, 44, 50, 0.82));
      border-color: var(--glass-stroke, rgba(255, 255, 255, 0.14));
      box-shadow: 0 10px 26px var(--glass-shadow, rgba(0, 0, 0, 0.55));
    }
    :global(:root:not([data-theme="light"])) .cc-toast span {
      color: var(--label2, rgba(235, 235, 245, 0.72));
    }
  }

  :global(:root[data-theme="dark"]) .cc-toast {
    color: var(--label, #ffffff);
    background: var(--glass-bg, rgba(44, 44, 50, 0.82));
    border-color: var(--glass-stroke, rgba(255, 255, 255, 0.14));
    box-shadow: 0 10px 26px var(--glass-shadow, rgba(0, 0, 0, 0.55));
  }

  :global(:root[data-theme="dark"]) .cc-toast span {
    color: var(--label2, rgba(235, 235, 245, 0.72));
  }

  .cc-field label {
    font-size: 10.5px;
    font-weight: 600;
    color: var(--label2, rgba(60, 60, 67, 0.6));
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .cc-field label {
      color: var(--label2, rgba(235, 235, 245, 0.6));
    }
  }

  :global(:root[data-theme="dark"]) .cc-field label {
    color: var(--label2, rgba(235, 235, 245, 0.6));
  }

  .cc-field select {
    min-height: 30px;
    height: 30px;
    padding: 0 8px;
    border-radius: 9px;
    border: 0.5px solid var(--sep, rgba(60, 60, 67, 0.16));
    background: var(--fill, rgba(118, 118, 128, 0.14));
    color: var(--label, #1c1c1e);
    font-size: 12px;
    font-weight: 500;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .cc-field select {
      border-color: var(--sep, rgba(255, 255, 255, 0.12));
      background: var(--fill, rgba(120, 120, 128, 0.24));
      color: var(--label, #ffffff);
    }
    :global(:root:not([data-theme="light"])) .cc-field select option {
      background: var(--elev, #2c2c2e);
      color: var(--label, #ffffff);
    }
  }

  :global(:root[data-theme="dark"]) .cc-field select {
    border-color: var(--sep, rgba(255, 255, 255, 0.12));
    background: var(--fill, rgba(120, 120, 128, 0.24));
    color: var(--label, #ffffff);
  }

  :global(:root[data-theme="dark"]) .cc-field select option {
    background: var(--elev, #2c2c2e);
    color: var(--label, #ffffff);
  }

  @media (prefers-reduced-motion: reduce) {
    .cc-dialog {
      animation: none;
    }
  }
</style>
