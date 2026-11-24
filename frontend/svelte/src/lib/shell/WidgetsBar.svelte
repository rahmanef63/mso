<script lang="ts">
  import { onMount } from "svelte";
  import { CHROME_PROFILES, type ChromeProfile } from "./chrome-profile.ts";

  let {
    openWindowCount,
    resolvedChrome,
    role,
    onOpenApp,
  }: {
    openWindowCount: number;
    resolvedChrome: ChromeProfile;
    role: string | null;
    onOpenApp: (app: string, title: string) => void;
  } = $props();

  let now = $state(new Date());

  let timeLabel = $derived(
    now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
  );
  let dateLabel = $derived(
    now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
  );
  let chromeLabel = $derived(
    CHROME_PROFILES.find((entry) => entry.id === resolvedChrome)?.label ?? resolvedChrome,
  );
  let windowLabel = $derived(
    openWindowCount === 1 ? "1 open window" : `${openWindowCount} open windows`,
  );

  onMount(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined;
    const msUntilNextMinute = Math.max(1_000, 60_000 - (Date.now() % 60_000));
    const timeoutId = setTimeout(() => {
      now = new Date();
      intervalId = setInterval(() => {
        now = new Date();
      }, 60_000);
    }, msUntilNextMinute);

    return () => {
      clearTimeout(timeoutId);
      if (intervalId !== undefined) clearInterval(intervalId);
    };
  });
</script>

<section
  class="widgets-bar"
  aria-label="Workspace widgets"
  data-chrome-badge={resolvedChrome}
>
  <div class="widget-group widget-status">
    <div class="widget-clock" aria-label="Local clock">
      <time class="clock-time" datetime={now.toISOString()}>{timeLabel}</time>
      <span class="clock-date">{dateLabel}</span>
    </div>

    <button
      type="button"
      class="widget-counter"
      aria-label={`Inspect ${windowLabel}`}
      onclick={() => onOpenApp("inspector", "Inspector")}
    >
      <span class="counter-value">{openWindowCount}</span>
      <span class="counter-label">{openWindowCount === 1 ? "Window" : "Windows"}</span>
    </button>

    <span class="widget-pill" aria-label={`Active shell chrome: ${chromeLabel}`}>
      {chromeLabel}
    </span>

    {#if role}
      <span class="widget-pill widget-role" aria-label={`Session role: ${role}`}>
        {role}
      </span>
    {/if}
  </div>

  <div class="widget-group widget-jumps" role="group" aria-label="Quick app jumps">
    <button type="button" onclick={() => onOpenApp("assistant", "Alfa Assistant")}>Alfa</button>
    <button type="button" onclick={() => onOpenApp("files", "Files")}>Files</button>
    <button type="button" onclick={() => onOpenApp("terminal", "Terminal")}>Terminal</button>
    <button type="button" onclick={() => onOpenApp("settings", "Settings")}>Settings</button>
  </div>
</section>

<style>
  .widgets-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
    padding: 0.5rem 0.875rem;
    background: color-mix(in srgb, var(--panel) 82%, transparent);
    border: 1px solid var(--glass-border);
    border-radius: 0.875rem;
    box-shadow: var(--shadow-pop);
    min-width: 0;
  }

  .widget-group {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    min-width: 0;
  }

  .widget-clock {
    display: inline-flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.3rem 0.625rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: color-mix(in srgb, var(--panel-solid) 70%, transparent);
    font-variant-numeric: tabular-nums;
  }

  .clock-time {
    font-size: 0.9375rem;
    font-weight: 700;
    color: var(--text);
  }

  .clock-date {
    font-size: 0.78rem;
    color: var(--muted);
  }

  .widget-counter {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    min-height: 2.1rem;
    padding: 0.25rem 0.625rem;
    font-variant-numeric: tabular-nums;
  }

  .counter-value {
    font-weight: 700;
    color: var(--accent);
  }

  .counter-label {
    font-size: 0.8125rem;
    color: var(--muted);
  }

  .widget-pill {
    display: inline-flex;
    align-items: center;
    padding: 0.2rem 0.55rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: color-mix(in srgb, var(--panel-solid) 64%, transparent);
    font-size: 0.75rem;
    color: var(--muted);
    white-space: nowrap;
  }

  .widget-role {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 600;
  }

  .widget-jumps button {
    min-height: 2.1rem;
    padding: 0.25rem 0.65rem;
    font-size: 0.8125rem;
  }
</style>
