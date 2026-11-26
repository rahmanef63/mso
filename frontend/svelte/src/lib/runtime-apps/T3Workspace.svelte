<script lang="ts">
  import { onMount } from "svelte";
  import { ApiError } from "../host-api.ts";
  import { managedT3Dashboard, readManagedT3, T3_CONNECT_SANDBOX, T3_CONNECT_URL } from "./t3-workspace.ts";

  let showing = $state(false);
  let dashboard = $state<string | null>(null);
  let managedState = $state<"loading" | "ready" | "error" | "denied">("loading");
  let active: AbortController | undefined;

  async function refresh() {
    active?.abort();
    const operation = (active = new AbortController());
    managedState = "loading";
    dashboard = null;
    try {
      const app = await readManagedT3(operation.signal);
      if (operation.signal.aborted) return;
      dashboard = managedT3Dashboard(app, window.location.origin);
      managedState = "ready";
    } catch (error) {
      if (operation.signal.aborted) return;
      managedState = error instanceof ApiError && (error.status === 401 || error.status === 403) ? "denied" : "error";
    }
  }

  onMount(() => {
    void refresh();
    return () => active?.abort();
  });
</script>

<section aria-label="T3 Code workspace" data-t3-workspace>
  <div class="intro">
    <p>Use your existing T3 Connect account to select a paired environment. MSO does not sign you in or start another T3 server.</p>
    <div class="actions">
      <button type="button" aria-pressed={showing} onclick={() => { showing = !showing; }}>
        {showing ? "Close embedded workspace" : "Open T3 Connect inside MSO"}
      </button>
      <a href={T3_CONNECT_URL} target="_blank" rel="noopener noreferrer">Open T3 Connect in a new tab</a>
    </div>
    <p>If the frame stays blank or sign-in is blocked, use the new tab and connect from T3 directly.</p>
    <div class="managed">
      {#if dashboard}
        <a href={dashboard} target="_blank" rel="noopener noreferrer">Open managed T3 dashboard in a new tab</a>
      {:else if managedState === "loading"}
        <span role="status">Checking this host for an existing managed T3 dashboard...</span>
      {:else if managedState === "denied"}
        <span role="status">This device cannot read the managed T3 dashboard.</span>
      {:else if managedState === "error"}
        <span role="status">Could not check this host for a managed T3 dashboard.</span>
        <button type="button" onclick={refresh}>Retry host check</button>
      {:else}
        <span>No active HTTPS managed T3 dashboard reported on this host.</span>
      {/if}
    </div>
  </div>
  {#if showing}
    <iframe title="T3 Connect workspace" src={T3_CONNECT_URL} sandbox={T3_CONNECT_SANDBOX} referrerpolicy="no-referrer"></iframe>
  {/if}
</section>

<style>
  section {
    display: flex; flex-direction: column; min-inline-size: 0; min-block-size: 0;
    block-size: 100%; gap: var(--feature-gap, 0.75rem); color: var(--text);
  }
  .intro { display: grid; gap: var(--feature-gap, 0.75rem); padding: var(--feature-padding, 0.75rem); }
  p { margin: 0; color: var(--muted); overflow-wrap: anywhere; }
  .actions, .managed { display: flex; align-items: center; flex-wrap: wrap; gap: var(--feature-gap, 0.75rem); }
  button, a {
    display: inline-flex; align-items: center; min-height: var(--ui-control-height, 2.25rem);
    min-width: 0; overflow-wrap: anywhere;
  }
  button {
    border: 1px solid var(--border); color: var(--text); background: var(--panel-solid);
    border-radius: 0.375rem; padding-inline: var(--ui-control-padding, 0.625rem); cursor: pointer;
  }
  a { color: var(--accent); text-decoration: underline; }
  iframe { border: 0; display: block; flex: 1 0 17rem; inline-size: 100%; min-block-size: 17rem; }
  @media (pointer: coarse) { button, a { min-height: 44px; } }
</style>
