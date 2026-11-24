<script lang="ts">
  import { onMount } from "svelte";
  import { createMonitor, type MonitorState } from "./monitor-controller";
  import { bytes, uptime } from "./format";
  import type { Session } from "./host-api";
  import LoginForm from "./LoginForm.svelte";

  let { onSessionChange }: { onSessionChange?: (session: Session | null) => void } = $props();

  let state = $state<MonitorState>({ kind: "loading" });
  let monitor: ReturnType<typeof createMonitor> | undefined;

  export function refresh() {
    void monitor?.refresh();
  }

  onMount(() => {
    monitor = createMonitor((next) => {
      state = next;
      if (next.kind === "ready") onSessionChange?.(next.session);
      else if (next.kind === "signed-out") onSessionChange?.(null);
    });
    void monitor.refresh();
    return () => monitor?.dispose();
  });
</script>

{#if state.kind === "signed-out"}
  <div class="lock-host" role="status" aria-live="polite" data-monitor-state="signed-out">
    <LoginForm onSignedIn={() => void monitor?.refresh()} />
  </div>
{:else}
  <section class="monitor-widget" aria-labelledby="monitor-title" aria-busy={state.kind === "loading"} data-monitor-state={state.kind}>
    <header class="feature-header">
      <div class="monitor-head-copy">
        <h2 id="monitor-title">System Monitor</h2>
        {#if state.kind === "ready"}
          <span class="device-line">{state.session.deviceLabel ?? "Approved device"} · {state.session.role}</span>
        {/if}
      </div>
      <button disabled={state.kind === "loading"} onclick={() => void monitor?.refresh()}>
        {state.kind === "loading" ? "Loading..." : "Refresh"}
      </button>
    </header>
    <div role="status" aria-live="polite">
      {#if state.kind === "loading"}
        <p class="monitor-note">Checking device session and host metrics...</p>
      {:else if state.kind === "error"}
        <h3>System metrics unavailable</h3>
        <p class="monitor-note">{state.message}</p>
      {:else}
        <dl>
          <div><dt>CPU</dt><dd>{state.stats.cpu.pct.toFixed(1)}% · {state.stats.cpu.cores} cores</dd></div>
          <div><dt>Memory</dt><dd>{bytes(state.stats.mem.used)} / {bytes(state.stats.mem.total)}</dd></div>
          <div><dt>Disk</dt><dd>{bytes(state.stats.disk.used)} / {bytes(state.stats.disk.total)}</dd></div>
          <div><dt>Uptime</dt><dd>{uptime(state.stats.uptime)}</dd></div>
        </dl>
      {/if}
    </div>
  </section>
{/if}

<style>
  .lock-host {
    width: 100%;
    display: flex;
    justify-content: center;
  }

  .monitor-widget {
    box-shadow: var(--shadow-pop);
  }

  .monitor-head-copy {
    display: flex;
    align-items: baseline;
    gap: 0.625rem;
    flex-wrap: wrap;
    min-width: 0;
  }

  .device-line {
    font-size: 0.8125rem;
    color: var(--muted);
  }

  .monitor-note {
    margin: 0.5rem 0 0;
    font-size: 0.875rem;
  }
</style>
