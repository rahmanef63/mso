<script lang="ts">
  import { resolveDesktopScreenshotUrl, type DesktopContainerItem, type DesktopLifecycleAction } from "./runtime-apps-api.ts";

  let {
    container, canControl, busy, pendingAction, expanded, screen, tick,
    onAction, onCancel, onToggleExpand, onScreenChange, onPreviewError,
  }: {
    container: DesktopContainerItem;
    canControl: boolean;
    busy: boolean;
    pendingAction: "stop" | "restart" | null;
    expanded: boolean;
    screen: string;
    tick: number;
    onAction: (action: DesktopLifecycleAction) => void;
    onCancel: () => void;
    onToggleExpand: () => void;
    onScreenChange: (screen: string) => void;
    onPreviewError: (message: string) => void;
  } = $props();

  const SCREENS = [":99", ":1", ":2", ":3"] as const;
  let target = $derived(container.name || container.id);
  let running = $derived(container.state.toLowerCase() === "running");
  let stateTone = $derived.by(() => {
    const s = container.state.toLowerCase();
    if (s === "running") return "ok";
    if (s === "exited" || s === "dead") return "danger";
    if (s === "restarting" || s === "paused") return "warn";
    return "neutral";
  });
</script>

<article class="bd-card">
  <div class="bd-head">
    <div class="bd-info">
      <strong class="bd-name">{target}</strong>
      <span class="bd-meta"><code>{container.id}</code></span>
      <div class="bd-flex">
        <span class="pill" data-tone={stateTone}>{container.state || "unknown"}</span>
        {#if container.labels.bot}<span class="pill">bot {container.labels.bot}</span>{/if}
        {#if container.labels.user}<span class="pill">{container.labels.user}</span>{/if}
      </div>
      {#if container.status}<p class="bd-meta">{container.status}</p>{/if}
    </div>
    {#if running}
      <label class="bd-screen-pick">
        <span>Display</span>
        <select value={screen} onchange={(event) => onScreenChange(event.currentTarget.value)}>
          {#each SCREENS as value (value)}<option value={value}>{value}</option>{/each}
        </select>
      </label>
    {/if}
  </div>

  {#if running}
    <div class="bd-live" class:expanded>
      {#key `${container.id}-${screen}-${tick}`}
        <img class="bd-shot" src={resolveDesktopScreenshotUrl(target, undefined, screen)}
          alt={`Live screenshot of ${target} on display ${screen}`} loading="lazy"
          onerror={() => onPreviewError("Could not capture this display. The container may still be starting.")} />
      {/key}
      <button type="button" class="bd-small" aria-pressed={expanded} onclick={onToggleExpand}>
        {expanded ? "Shrink" : "Enlarge"}
      </button>
    </div>
  {:else}
    <p class="bd-offline">Container is {container.state || "not running"}. Start it to see a live screenshot.</p>
  {/if}

  <div class="bd-actions">
    <button type="button" class="bd-small" disabled={busy} onclick={() => onAction("logs")}>Logs</button>
    {#if canControl}
      {#if pendingAction}
        <button type="button" class="bd-small danger" disabled={busy} onclick={() => onAction(pendingAction)}>Confirm {pendingAction}</button>
        <button type="button" class="bd-small" disabled={busy} onclick={onCancel}>Cancel</button>
      {:else if running}
        <button type="button" class="bd-small" disabled={busy} onclick={() => onAction("restart")}>Restart</button>
        <button type="button" class="bd-small danger" disabled={busy} onclick={() => onAction("stop")}>Stop</button>
      {:else}
        <button type="button" class="bd-small primary" disabled={busy} onclick={() => onAction("start")}>Start</button>
      {/if}
    {/if}
  </div>
</article>

<style>
  .bd-flex { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .bd-card { display: grid; gap: 0.5rem; padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--surface); min-width: 0; }
  .bd-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
  .bd-info { display: grid; gap: 0.25rem; min-width: 0; flex: 1 1 12rem; }
  .bd-name { font-family: var(--font-mono); font-size: 0.8125rem; overflow-wrap: anywhere; }
  .bd-meta { margin: 0; font-size: 0.75rem; color: var(--muted); overflow-wrap: anywhere; }
  .bd-screen-pick { display: grid; gap: 0.125rem; font-size: 0.6875rem; color: var(--muted); }
  .bd-live { display: grid; gap: 0.375rem; }
  .bd-shot { width: 100%; max-height: 16rem; object-fit: contain; border-radius: 0.375rem; border: 1px solid var(--border); background: #0c0d10; }
  .bd-live.expanded .bd-shot { max-height: 34rem; }
  .bd-offline { margin: 0; padding: 1rem 0.5rem; text-align: center; font-size: 0.75rem; color: var(--muted); border: 1px dashed var(--border); border-radius: 0.375rem; }
  .bd-actions { display: flex; gap: 0.375rem; flex-wrap: wrap; }
  .bd-small { font-size: 0.75rem; padding: 0.1875rem 0.5rem; }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="danger"] { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
  @media (max-width: 400px) {
    .bd-actions button { flex: 1 1 calc(50% - 0.25rem); }
  }
</style>
