<script lang="ts">
  import { detectShellBridge, type ShellBridge } from "../shell-bridge.ts";
  import type { ChromeProfile } from "./chrome-profile.ts";
  import type { ShellLayoutState, WindowState } from "./window-store.ts";

  let {
    layout,
    resolvedChrome,
    viewportWidth,
    role,
  }: {
    layout: ShellLayoutState;
    resolvedChrome: ChromeProfile;
    viewportWidth: number;
    role: string | null;
  } = $props();

  let view = $state<{ bridge: ShellBridge; refreshCount: number }>({
    bridge: detectShellBridge(),
    refreshCount: 0,
  });

  let rows = $derived<WindowState[]>(
    layout.order
      .map((id) => layout.windows[id])
      .filter((win): win is WindowState => Boolean(win)),
  );
  let focusedWindow = $derived<WindowState | null>(
    layout.focused ? (layout.windows[layout.focused] ?? null) : null,
  );
  let runtimeLabel = $derived(
    view.bridge.surface === "tauri-desktop"
      ? "tauri-desktop"
      : view.bridge.surface === "rust-host"
        ? "rust-host"
        : "web",
  );

  function refreshBridge() {
    view.bridge = detectShellBridge();
    view.refreshCount += 1;
  }

  function windowFlags(win: WindowState): string {
    const flags: string[] = [];
    if (layout.focused === win.id) flags.push("Focused");
    if (win.minimized) flags.push("Minimized");
    if (win.maximized) flags.push("Maximized");
    return flags.length > 0 ? flags.join(", ") : "Open";
  }
</script>

<div class="inspector-panel">
  <header class="feature-header">
    <div>
      <h3>Shell inspector</h3>
      <p class="insp-sub">Live runtime bridge and workspace window state</p>
    </div>
    <button type="button" onclick={refreshBridge}>Refresh bridge</button>
  </header>

  <dl class="insp-metrics" aria-label="Runtime metrics">
    <div class="metric">
      <dt>Runtime mode</dt>
      <dd>{runtimeLabel}</dd>
    </div>
    <div class="metric">
      <dt>API origin</dt>
      <dd>{view.bridge.apiBaseOrigin ?? "Same origin"}</dd>
    </div>
    <div class="metric">
      <dt>Chrome profile</dt>
      <dd>{resolvedChrome}</dd>
    </div>
    <div class="metric">
      <dt>Viewport width</dt>
      <dd>{Number.isFinite(viewportWidth) ? `${Math.round(viewportWidth)} px` : "Unknown"}</dd>
    </div>
    <div class="metric">
      <dt>Session role</dt>
      <dd>{role ?? "Signed out"}</dd>
    </div>
    <div class="metric">
      <dt>Open windows</dt>
      <dd>{rows.length}</dd>
    </div>
    <div class="metric">
      <dt>Focused window</dt>
      <dd>{focusedWindow ? `${focusedWindow.id} (${focusedWindow.app})` : "None"}</dd>
    </div>
  </dl>

  <div class="insp-section">
    <h4>Window stack</h4>
    {#if rows.length === 0}
      <p class="insp-empty">No open windows in the current workspace layout.</p>
    {:else}
      <div class="table-wrap">
        <table class="insp-table">
          <thead>
            <tr>
              <th scope="col">ID</th>
              <th scope="col">App</th>
              <th scope="col">Title</th>
              <th scope="col">Z</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {#each rows as win (win.id)}
              <tr class:is-focused={layout.focused === win.id}>
                <td><code>{win.id}</code></td>
                <td>{win.app}</td>
                <td>{win.title}</td>
                <td class="num">{win.z}</td>
                <td>{windowFlags(win)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>

<style>
  .inspector-panel { display: grid; gap: 1rem; min-width: 0; }
  .insp-sub { margin: 0.125rem 0 0; font-size: 0.8125rem; color: var(--muted); }
  .insp-metrics {
    margin: 0;
    grid-template-columns: repeat(auto-fit, minmax(min(9.5rem, 100%), 1fr));
    gap: 0.625rem;
  }
  .insp-metrics .metric { padding: 0.625rem 0.75rem; background: var(--surface); }
  .insp-metrics dd { font-size: 0.9375rem; }
  .insp-section { display: grid; gap: 0.5rem; min-width: 0; }
  .insp-section h4 { margin: 0; font-size: 0.875rem; font-weight: 600; color: var(--text); }
  .insp-empty { margin: 0; font-size: 0.875rem; color: var(--muted); }
  .table-wrap {
    overflow-x: auto; border: 1px solid var(--border); border-radius: 0.5rem;
    background: var(--surface);
  }
  .insp-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
  .insp-table th, .insp-table td {
    padding: 0.5rem 0.625rem; text-align: left; border-bottom: 1px solid var(--border);
  }
  .insp-table th { font-weight: 600; color: var(--muted); background: var(--panel); }
  .insp-table tbody tr:last-child td { border-bottom: 0; }
  .insp-table tr.is-focused td { font-weight: 600; }
  .insp-table .num { font-variant-numeric: tabular-nums; }
  .insp-table code { font-size: 0.8125rem; }
</style>
