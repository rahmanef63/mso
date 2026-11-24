<script lang="ts">
  import { onMount } from "svelte";
  import { createMonitor, type MonitorState } from "./monitor-controller";
  import { bytes, uptime } from "./format";
  import type { Session, SysStats } from "./host-api";
  import Sparkline from "./monitor/Sparkline.svelte";
  import { clampPct, pct, pushSample } from "./monitor/history";
  import LoginForm from "./LoginForm.svelte";

  let { onSessionChange }: { onSessionChange?: (session: Session | null) => void } = $props();

  type Ready = { session: Session; stats: SysStats };
  const INTERVALS = [
    { id: "paused", label: "Paused", ms: 0 },
    { id: "3s", label: "3s", ms: 3_000 },
    { id: "10s", label: "10s", ms: 10_000 },
  ] as const;

  let monitorState = $state<MonitorState>({ kind: "loading" });
  let snapshot = $state<Ready | null>(null);
  let cpuSeries = $state<number[]>([]);
  let memSeries = $state<number[]>([]);
  let interval = $state<(typeof INTERVALS)[number]["id"]>("10s");
  let lastUpdated = $state<number | null>(null);
  let monitor: ReturnType<typeof createMonitor> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  export function refresh() {
    void monitor?.refresh();
  }

  let intervalMs = $derived(INTERVALS.find((item) => item.id === interval)?.ms ?? 0);
  let view = $derived<"signed-out" | "loading" | "error" | "ready">(
    monitorState.kind === "signed-out" ? "signed-out"
      : snapshot ? "ready"
      : monitorState.kind === "error" ? "error"
      : "loading",
  );
  let memPct = $derived(snapshot ? pct(snapshot.stats.mem.used, snapshot.stats.mem.total) : 0);
  let diskPct = $derived(snapshot ? pct(snapshot.stats.disk.used, snapshot.stats.disk.total) : 0);
  let cpuPct = $derived(snapshot ? clampPct(snapshot.stats.cpu.pct) : 0);

  function clearTimer() {
    if (timer !== undefined) { clearInterval(timer); timer = undefined; }
  }

  function schedule() {
    clearTimer();
    if (intervalMs <= 0) return;
    timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void monitor?.refresh();
    }, intervalMs);
  }

  function onVisibility() {
    if (typeof document !== "undefined" && !document.hidden) void monitor?.refresh();
  }

  onMount(() => {
    monitor = createMonitor((next) => {
      monitorState = next;
      if (next.kind === "ready") {
        snapshot = { session: next.session, stats: next.stats };
        cpuSeries = pushSample(cpuSeries, next.stats.cpu.pct);
        memSeries = pushSample(memSeries, pct(next.stats.mem.used, next.stats.mem.total));
        lastUpdated = Date.now();
        onSessionChange?.(next.session);
      } else if (next.kind === "signed-out") {
        snapshot = null;
        onSessionChange?.(null);
      }
    });
    void monitor.refresh();
    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimer();
      monitor?.dispose();
    };
  });

  function chooseInterval(id: (typeof INTERVALS)[number]["id"]) {
    interval = id;
    schedule();
    if (intervalMs > 0) void monitor?.refresh();
  }
</script>

{#if view === "signed-out"}
  <div class="lock-host" role="status" aria-live="polite" data-monitor-state="signed-out">
    <LoginForm onSignedIn={() => void monitor?.refresh()} />
  </div>
{:else}
  <section class="monitor-widget" aria-labelledby="monitor-title" aria-busy={view === "loading"} data-monitor-state={view}>
    <header class="feature-header">
      <div class="monitor-head-copy">
        <h2 id="monitor-title">System Monitor</h2>
        {#if snapshot}
          <span class="device-line">{snapshot.session.deviceLabel ?? "Approved device"} · {snapshot.session.role}</span>
        {/if}
      </div>
      <div class="head-actions">
        <div class="interval-group" role="group" aria-label="Auto refresh interval">
          {#each INTERVALS as option (option.id)}
            <button
              type="button"
              class="interval"
              aria-pressed={interval === option.id}
              onclick={() => chooseInterval(option.id)}
            >{option.label}</button>
          {/each}
        </div>
        <button disabled={view === "loading"} onclick={() => void monitor?.refresh()}>
          {view === "loading" ? "Loading..." : "Refresh"}
        </button>
      </div>
    </header>

    <div role="status" aria-live="polite">
      {#if !snapshot && view === "loading"}
        <p class="monitor-note">Checking device session and host metrics...</p>
      {:else if !snapshot}
        <h3>System metrics unavailable</h3>
        <p class="monitor-note">{monitorState.kind === "error" ? monitorState.message : "No telemetry sample yet."}</p>
      {:else}
        <div class="kpi-grid">
          <article class="kpi" data-tone="cpu">
            <div class="kpi-head">
              <span class="kpi-label">CPU</span>
              <span class="pill">{snapshot.stats.cpu.cores} cores</span>
            </div>
            <p class="kpi-value">{cpuPct.toFixed(1)}%</p>
            <div class="bar" role="progressbar" aria-label="CPU utilization" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(cpuPct)}>
              <span style:width="{cpuPct}%"></span>
            </div>
          </article>
          <article class="kpi" data-tone="mem">
            <div class="kpi-head">
              <span class="kpi-label">Memory</span>
              <span class="pill">{memPct.toFixed(0)}%</span>
            </div>
            <p class="kpi-value mem-pair">{bytes(snapshot.stats.mem.used)} / {bytes(snapshot.stats.mem.total)}</p>
            <div class="bar" role="progressbar" aria-label="Memory used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(memPct)}>
              <span style:width="{memPct}%"></span>
            </div>
          </article>
          <article class="kpi" data-tone="disk">
            <div class="kpi-head">
              <span class="kpi-label">Disk</span>
              <span class="pill">{diskPct.toFixed(0)}%</span>
            </div>
            <p class="kpi-value">{bytes(snapshot.stats.disk.used)} / {bytes(snapshot.stats.disk.total)}</p>
            <div class="bar" role="progressbar" aria-label="Disk used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(diskPct)}>
              <span style:width="{diskPct}%"></span>
            </div>
          </article>
          <article class="kpi" data-tone="uptime">
            <div class="kpi-head"><span class="kpi-label">Uptime</span></div>
            <p class="kpi-value">{uptime(snapshot.stats.uptime)}</p>
            <p class="kpi-sub">
              {lastUpdated ? `Sampled ${new Date(lastUpdated).toLocaleTimeString()}` : "Awaiting first sample"}
            </p>
          </article>
        </div>

        <div class="chart-grid">
          <Sparkline series={cpuSeries} label="CPU load" value={`${cpuPct.toFixed(1)}%`} tone="cpu" />
          <Sparkline series={memSeries} label="Memory load" value={`${memPct.toFixed(0)}%`} tone="mem" />
        </div>
      {/if}
    </div>
  </section>
{/if}

<style>
  .lock-host { width: 100%; display: flex; justify-content: center; }
  .monitor-widget { box-shadow: var(--shadow-pop); }
  .monitor-head-copy { display: flex; align-items: baseline; gap: 0.625rem; flex-wrap: wrap; min-width: 0; }
  .device-line { font-size: 0.8125rem; color: var(--muted); }
  .monitor-note { margin: 0.5rem 0 0; font-size: 0.875rem; }
  .head-actions { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .interval-group { display: inline-flex; border: 1px solid var(--border); border-radius: 999px; overflow: hidden; }
  .interval { border: 0; border-radius: 0; padding: 0.25rem 0.6rem; font-size: 0.8125rem; background: transparent; color: var(--muted); }
  .interval[aria-pressed="true"] { background: var(--accent); color: var(--accent-text); font-weight: 600; }
  .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(9rem, 100%), 1fr)); gap: 0.625rem; margin-top: 0.75rem; }
  .kpi {
    padding: 0.625rem 0.75rem; border: 1px solid var(--border); border-radius: 0.625rem;
    background: color-mix(in srgb, var(--panel-solid) 62%, transparent); min-width: 0;
  }
  .kpi-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
  .kpi-label { color: var(--muted); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
  .kpi-value { margin: 0.15rem 0 0.35rem; font-size: 0.9375rem; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; color: var(--text); }
  .kpi-sub { margin: 0.35rem 0 0; font-size: 0.75rem; color: var(--muted); }
  .pill {
    display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border);
    border-radius: 999px; font-size: 0.7rem; color: var(--muted); white-space: nowrap;
  }
  .bar { height: 0.375rem; border-radius: 999px; background: var(--border); overflow: hidden; }
  .bar > span { display: block; height: 100%; border-radius: inherit; background: var(--accent); transition: width 200ms ease; }
  [data-tone="mem"] .bar > span { background: var(--ok); }
  [data-tone="disk"] .bar > span { background: var(--warn); }
  .chart-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(12rem, 100%), 1fr)); gap: 0.75rem; margin-top: 0.75rem; }
  @media (prefers-reduced-motion: reduce) { .bar > span { transition: none; } }
</style>
