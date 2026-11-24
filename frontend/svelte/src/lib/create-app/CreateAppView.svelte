<script lang="ts">
  import {
    createShellAppsController, isPlainHttpUrl, isValidAppId, type ShellAppsState,
  } from "./create-app-api.ts";
  import { TILE_CATEGORIES, slugifyAppId, validateDraft, type LaunchMode } from "./create-app-draft.ts";
  import AppDraftForm from "./AppDraftForm.svelte";
  import ShellAppRegistry from "./ShellAppRegistry.svelte";

  let { role = null }: { role?: "viewer" | "operator" | "owner" | null } = $props();

  let view = $state<ShellAppsState>({ kind: "loading" });
  let appId = $state("");
  let title = $state("");
  let description = $state("");
  let url = $state("");
  let mode = $state<LaunchMode>("embed");
  let categoryId = $state<string>(TILE_CATEGORIES[0]!.id);
  let touched = $state(false);
  let formError = $state<string | null>(null);
  let confirmRemoveId = $state<string | null>(null);
  let controller: ReturnType<typeof createShellAppsController> | undefined;

  let isOwner = $derived(role === "owner");
  let slug = $derived(slugifyAppId(appId || title));
  let issues = $derived(validateDraft({ id: slug, title, description, url, mode }));
  let canSubmit = $derived(issues.length === 0);
  let stateTag = $derived.by(() => {
    if (!isOwner) return "owner-only";
    if (view.kind !== "ready") return view.kind;
    return view.snapshot.apps.length === 0 ? "empty" : "ready";
  });

  export function refresh() {
    if (isOwner) void controller?.refresh();
  }

  $effect(() => {
    if (!isOwner) return;
    const next = createShellAppsController((state) => { view = state; });
    controller = next;
    void next.refresh();
    return () => {
      next.dispose();
      if (controller === next) controller = undefined;
    };
  });

  function resetDraft() {
    appId = "";
    title = "";
    description = "";
    url = "";
    mode = "embed";
    categoryId = TILE_CATEGORIES[0]!.id;
    touched = false;
    formError = null;
  }

  async function handleCreate(event: SubmitEvent) {
    event.preventDefault();
    touched = true;
    formError = null;
    const found = validateDraft({ id: slug, title, description, url, mode });
    if (found.length > 0 || !isValidAppId(slug) || !isPlainHttpUrl(url.trim())) {
      formError = found[0]?.message ?? "Check the app ID and URL before saving.";
      return;
    }
    const before = view.kind === "ready" ? view.snapshot.revision : "";
    await controller?.create({ id: slug, title: title.trim(), description: description.trim(), url: url.trim(), mode });
    const after = view.kind === "ready" ? view.snapshot.revision : "";
    if (after !== before) resetDraft();
  }
</script>

<section aria-labelledby="create-app-title" aria-busy={isOwner && view.kind === "loading"} data-create-app-state={stateTag}>
  <header class="feature-header ca-bar">
    <div class="ca-flex">
      <h2 id="create-app-title">Create App</h2>
      {#if isOwner && view.kind === "ready"}<span class="pill">{view.snapshot.apps.length} registered</span>{/if}
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
  {:else}
    <div class="ca-layout">
      <form onsubmit={handleCreate} novalidate class="ca-form">
        <AppDraftForm
          {appId} {title} {description} {url} {mode} {categoryId} {issues} {touched}
          onCategorySelect={(id) => { categoryId = id; }}
          onModeSelect={(next) => { mode = next; }}
          onChange={(field, value) => {
            if (field === "id") appId = value;
            if (field === "title") title = value;
            if (field === "description") description = value;
            if (field === "url") url = value;
          }}
        />

        {#if formError}<p class="feedback error" role="alert">{formError}</p>{/if}
        {#if view.kind === "ready" && view.error}<p class="feedback error" role="alert">{view.error}</p>{/if}

        <div class="ca-actions">
          <button type="submit" class="primary" disabled={view.kind === "ready" && view.busy}>
            {view.kind === "ready" && view.busy ? "Saving..." : "Create app"}
          </button>
          {#if !canSubmit}<span class="ca-hint">{issues.length} field{issues.length === 1 ? "" : "s"} need attention</span>{/if}
        </div>
      </form>

      {#if view.kind === "loading"}
        <p class="ca-hint" role="status">Loading registered shell apps...</p>
      {:else if view.kind === "error"}
        <p class="feedback error" role="alert">{view.message}</p>
      {:else}
        <ShellAppRegistry
          snapshot={view.snapshot}
          busy={view.busy}
          {confirmRemoveId}
          notice={view.notice}
          error={view.error}
          onRequestRemove={(id) => { confirmRemoveId = id; }}
          onCancelRemove={() => { confirmRemoveId = null; }}
          onRemove={(id) => { confirmRemoveId = null; void controller?.remove(id); }}
        />
      {/if}
    </div>
  {/if}
</section>

<style>
  .ca-bar { flex-wrap: wrap; gap: 0.5rem; }
  .ca-flex { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; min-width: 0; }
  .ca-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 1rem; margin-top: 1rem; min-width: 0; }
  .ca-form { display: grid; gap: 0.75rem; align-content: start; min-width: 0; }
  .ca-hint { font-size: 0.75rem; color: var(--muted); overflow-wrap: anywhere; }
  .ca-actions { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
  @media (max-width: 760px) {
    .ca-layout { grid-template-columns: minmax(0, 1fr); }
  }
</style>
