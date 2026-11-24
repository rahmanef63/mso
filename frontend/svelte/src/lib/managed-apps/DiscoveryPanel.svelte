<script lang="ts">
  import type { AuxState } from "./appdeck-overview";
  import type { DiscoverySnapshot } from "./appdeck-schema";
  import { fmtStamp } from "./appdeck-view";

  let {
    discovery,
    tunnels,
    ondiscover,
    ontunnels,
  }: {
    discovery: AuxState<DiscoverySnapshot>;
    tunnels: AuxState<import("./appdeck-schema").TunnelSnapshot>;
    ondiscover: () => void;
    ontunnels: () => void;
  } = $props();

  let found = $derived(discovery.kind === "ready" ? discovery.data.apps : []);
</script>

<section class="discovery" aria-labelledby="discovery-heading">
  <div class="row">
    <h3 id="discovery-heading">Discover local hosts</h3>
    <div class="actions">
      <button disabled={discovery.kind === "loading"} onclick={ondiscover}>
        {discovery.kind === "loading" ? "Scanning..." : "Discover local hosts"}
      </button>
      <button class="ghost" disabled={tunnels.kind === "loading"} onclick={ontunnels}>Refresh tunnels</button>
    </div>
  </div>

  {#if discovery.kind === "idle"}
    <p class="hint">
      Scans this host for containers, user services and state directories that the deck does not already own.
      Owner access is required.
    </p>
  {:else if discovery.kind === "loading"}
    <p class="hint" role="status">Scanning Docker, user services and state directories...</p>
  {:else if discovery.kind === "error"}
    <p class="feedback error" role="alert">{discovery.message}</p>
  {:else}
    <p class="hint" role="status">
      {found.length} local {found.length === 1 ? "runtime" : "runtimes"} found.
      Docker {discovery.data.dockerAvailable ? "available" : "not available"}.
      <span class="muted">Scanned {fmtStamp(discovery.data.checkedAt)}</span>
    </p>
    {#if found.length > 0}
      <ul class="found">
        {#each found as item (item.id)}
          <li>
            <div class="found-head">
              <strong>{item.name}</strong>
              <span class="pill">{item.ownership}</span>
              <span class="pill" data-on={item.running ? "yes" : "no"}>{item.running ? "running" : "stopped"}</span>
            </div>
            <p class="found-desc">{item.description}</p>
            {#if item.detectedEndpoint}<p class="found-meta"><code>{item.detectedEndpoint}</code></p>{/if}
            {#if item.detectedPath}<p class="found-meta"><code>{item.detectedPath}</code></p>{/if}
            <p class="found-meta">{item.hint}</p>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}

  {#if tunnels.kind === "error"}
    <p class="feedback pending" role="status">{tunnels.message}</p>
  {:else if tunnels.kind === "ready" && tunnels.data.tunnels.length > 0}
    <ul class="tunnels" aria-label="SSH tunnels">
      {#each tunnels.data.tunnels as tunnel (tunnel.id)}
        <li>
          <span class="pill" data-on={tunnel.active ? "yes" : "no"}>{tunnel.active ? "active" : "stopped"}</span>
          <span>{tunnel.title || tunnel.appId}</span>
          <code>{tunnel.localUrl}</code>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .discovery { display: grid; gap: 0.5rem; min-width: 0; padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
  h3 { margin: 0; font-size: 16px; color: var(--text); }
  .actions { display: flex; gap: 0.375rem; flex-wrap: wrap; }
  button {
    min-height: 2rem; padding: 0 0.75rem; border: 1px solid var(--border); border-radius: 0.375rem;
    background: var(--panel-solid); color: var(--text); font-size: 0.8125rem; font-weight: 600; cursor: pointer;
  }
  button:disabled { opacity: 0.55; cursor: not-allowed; }
  button.ghost { background: transparent; }
  .hint { margin: 0; font-size: 0.875rem; color: var(--text); overflow-wrap: anywhere; }
  .muted { display: block; font-size: 0.75rem; color: var(--muted); }
  .found, .tunnels { list-style: none; display: grid; gap: 0.5rem; margin: 0.25rem 0 0; padding: 0; }
  .found li, .tunnels li {
    display: grid; gap: 0.125rem; min-width: 0; padding: 0.5rem;
    border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel);
  }
  .tunnels li { display: flex; align-items: center; gap: 0.375rem; flex-wrap: wrap; font-size: 0.8125rem; }
  .found-head { display: flex; align-items: center; gap: 0.375rem; flex-wrap: wrap; }
  .found-desc, .found-meta { margin: 0; font-size: 0.8125rem; color: var(--muted); overflow-wrap: anywhere; }
  .pill {
    padding: 0.0625rem 0.4375rem; border: 1px solid var(--border); border-radius: 999px;
    font-size: 0.6875rem; color: var(--muted);
  }
  .pill[data-on="yes"] { color: var(--ok); border-color: var(--ok); background: var(--ok-bg); }
  .pill[data-on="no"] { color: var(--muted); }
</style>
