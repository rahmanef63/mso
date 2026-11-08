<script lang="ts">
  import { onMount } from "svelte";
  import { createMonitor, type MonitorState } from "./monitor-controller";
  import { bytes, uptime } from "./format";

  let state = $state<MonitorState>({ kind: "loading" });
  let monitor: ReturnType<typeof createMonitor> | undefined;
  onMount(() => {
    monitor = createMonitor((next) => { state = next; });
    void monitor.refresh();
    return () => monitor?.dispose();
  });
</script>

<section aria-labelledby="monitor-title" aria-busy={state.kind === "loading"}>
  <header class="feature-header">
    <h2 id="monitor-title">System Monitor</h2>
    <button disabled={state.kind === "loading"} onclick={() => void monitor?.refresh()}>
      {state.kind === "loading" ? "Loading…" : "Refresh"}
    </button>
  </header>
  <div role="status" aria-live="polite">
    {#if state.kind === "loading"}
      <p>Checking the device session and reading host metrics…</p>
    {:else if state.kind === "signed-out"}
      <h3>Sign in to the existing cockpit</h3>
      <p>Use the existing MSO login on this hostname, then refresh. This entry does not create a second login.</p>
    {:else if state.kind === "error"}
      <h3>System metrics unavailable</h3>
      <p>{state.message}</p>
    {:else}
      <p class="device">Device: {state.session.deviceLabel ?? "Approved device"} · {state.session.role}</p>
      <dl>
        <div><dt>CPU</dt><dd>{state.stats.cpu.pct.toFixed(1)}% · {state.stats.cpu.cores} cores</dd></div>
        <div><dt>Memory</dt><dd>{bytes(state.stats.mem.used)} / {bytes(state.stats.mem.total)}</dd></div>
        <div><dt>Disk</dt><dd>{bytes(state.stats.disk.used)} / {bytes(state.stats.disk.total)}</dd></div>
        <div><dt>Uptime</dt><dd>{uptime(state.stats.uptime)}</dd></div>
      </dl>
      <p>Point-in-time host readings. No background polling.</p>
    {/if}
  </div>
</section>
