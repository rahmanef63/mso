<script lang="ts">
  import {
    createShellAppsController,
    isPlainHttpUrl,
    isValidAppId,
    type ShellAppMode,
    type ShellAppsState,
  } from "./create-app-api.ts";

  let { role = null }: { role?: "viewer" | "operator" | "owner" | null } = $props();

  let view = $state<ShellAppsState>({ kind: "loading" });
  let appId = $state("");
  let title = $state("");
  let description = $state("");
  let url = $state("");
  let mode = $state<ShellAppMode>("embed");
  let formError = $state<string | null>(null);
  let confirmRemoveId = $state<string | null>(null);
  let controller: ReturnType<typeof createShellAppsController> | undefined;

  let isOwner = $derived(role === "owner");

  let stateTag = $derived.by(() => {
    if (!isOwner) return "owner-only";
    if (view.kind !== "ready") return view.kind;
    return view.snapshot.apps.length === 0 ? "empty" : "ready";
  });

  export function refresh() {
    if (isOwner) void controller?.refresh();
  }

  $effect(() => {
    if (!isOwner) {
      controller?.dispose();
      controller = undefined;
      return;
    }
    const next = createShellAppsController((s) => { view = s; });
    controller = next;
    void next.refresh();
    return () => {
      next.dispose();
      if (controller === next) controller = undefined;
    };
  });

  async function handleCreate(event: SubmitEvent) {
    event.preventDefault();
    const id = appId.trim().toLowerCase();
    const cleanTitle = title.trim();
    const cleanDesc = description.trim();
    const cleanUrl = url.trim();
    if (!isValidAppId(id)) {
      formError = "App ID must start with a lowercase letter or digit and use only a-z, 0-9, or hyphens (max 64 chars).";
      return;
    }
    if (!cleanTitle) {
      formError = "App title is required.";
      return;
    }
    if (!isPlainHttpUrl(cleanUrl)) {
      formError = "Enter a plain HTTP or HTTPS URL without credentials, query parameters, or fragments.";
      return;
    }
    formError = null;
    await controller?.create({ id, title: cleanTitle, description: cleanDesc, url: cleanUrl, mode });
    if (view.kind === "ready" && !view.error) {
      appId = "";
      title = "";
      description = "";
      url = "";
      mode = "embed";
    }
  }
</script>

<section aria-labelledby="create-app-title" aria-busy={isOwner && view.kind === "loading"} data-create-app-state={stateTag}>
  <header class="feature-header">
    <div class="ca-title-group">
      <h2 id="create-app-title">Create App</h2>
      {#if isOwner && view.kind === "ready"}
        <span class="pill">{view.snapshot.apps.length} registered</span>
      {/if}
    </div>
    {#if isOwner}
      <button type="button" disabled={view.kind === "loading" || (view.kind === "ready" && view.busy)} onclick={refresh}>
        {view.kind === "loading" ? "Loading..." : "Refresh"}
      </button>
    {/if}
  </header>

  {#if !isOwner}
    <p class="feedback pending" role="status">
      Owner role is required to register or remove shell apps. Sign in from an Owner device to manage external apps.
    </p>
  {:else if view.kind === "loading"}
    <p role="status">Loading registered shell apps...</p>
  {:else if view.kind === "error"}
    <p class="feedback error" role="alert">{view.message}</p>
  {:else}
    {#if view.notice}<p class="feedback ok" role="status">{view.notice}</p>{/if}
    {#if view.error}<p class="feedback error" role="alert">{view.error}</p>{/if}

    <div class="ca-group">
      <h3>Registered shell apps ({view.snapshot.apps.length})</h3>
      {#if view.snapshot.apps.length === 0}
        <p>No external shell apps registered yet.</p>
      {:else}
        <ul class="ca-list" aria-label="Registered shell apps">
          {#each view.snapshot.apps as app (app.id)}
            <li class="ca-row">
              <div class="ca-info">
                <div class="ca-heading">
                  <strong>{app.title}</strong>
                  <code>{app.id}</code>
                  <span class="pill" data-tone={app.renderer === "iframe" ? "ok" : "neutral"}>{app.renderer}</span>
                  {#if app.blocked}
                    <span class="pill" data-tone="danger">blocked</span>
                  {/if}
                </div>
                {#if app.description}<p class="ca-meta">{app.description}</p>{/if}
                <p class="ca-meta"><code>{app.url ?? app.origin}</code></p>
                {#if app.reason}<p class="ca-warn">{app.reason}</p>{/if}
              </div>
              {#if view.snapshot.configurable}
                <div class="actions">
                  {#if confirmRemoveId === app.id}
                    <button type="button" class="danger" disabled={view.busy} onclick={() => { confirmRemoveId = null; void controller?.remove(app.id); }}>
                      Confirm remove
                    </button>
                    <button type="button" disabled={view.busy} onclick={() => { confirmRemoveId = null; }}>Cancel</button>
                  {:else}
                    <button type="button" disabled={view.busy} onclick={() => { confirmRemoveId = app.id; }}>Remove</button>
                  {/if}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="ca-group">
      <h3>Register new shell app</h3>
      {#if !view.snapshot.configurable}
        <p class="feedback pending">This app registry is managed by deployment configuration and cannot be edited here.</p>
      {:else}
        <form class="ca-form" onsubmit={handleCreate}>
          <div class="ca-grid">
            <div class="field">
              <label for="ca-id">App ID</label>
              <input id="ca-id" type="text" bind:value={appId} placeholder="analytics-portal" required />
            </div>
            <div class="field">
              <label for="ca-title">Title</label>
              <input id="ca-title" type="text" bind:value={title} placeholder="Analytics Portal" required />
            </div>
          </div>
          <div class="field">
            <label for="ca-desc">Description</label>
            <input id="ca-desc" type="text" bind:value={description} placeholder="Short summary of what this app provides" />
          </div>
          <div class="ca-grid">
            <div class="field">
              <label for="ca-url">App URL</label>
              <input id="ca-url" type="url" bind:value={url} placeholder="https://app.example.com/" required />
            </div>
            <div class="field">
              <label for="ca-mode">Open mode</label>
              <select id="ca-mode" bind:value={mode}>
                <option value="embed">Embed (iframe when HTTPS)</option>
                <option value="tab">Separate tab (remote)</option>
              </select>
            </div>
          </div>
          {#if formError}<p class="feedback error" role="alert">{formError}</p>{/if}
          <div class="actions">
            <button type="submit" class="primary" disabled={view.busy}>
              {view.busy ? "Saving..." : "Create app"}
            </button>
          </div>
        </form>
      {/if}
    </div>
  {/if}
</section>

<style>
  .ca-title-group { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .ca-group { margin-top: 1.25rem; display: grid; gap: 0.625rem; }
  .ca-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.625rem; }
  .ca-row {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;
    padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--surface);
  }
  .ca-info { display: grid; gap: 0.25rem; min-width: 0; flex: 1 1 16rem; }
  .ca-heading { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .ca-heading code, .ca-meta code { font-size: 0.8125rem; color: var(--muted); overflow-wrap: anywhere; }
  .ca-meta { margin: 0; font-size: 0.8125rem; color: var(--muted); }
  .ca-warn { margin: 0; font-size: 0.8125rem; color: var(--warn); }
  .ca-form { display: grid; gap: 0.75rem; }
  .ca-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(14rem, 100%), 1fr)); gap: 0.75rem; }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="danger"] { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
</style>
