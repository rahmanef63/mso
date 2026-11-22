<script lang="ts">
  import { onMount } from "svelte";
  import { createPrefsController, isSafeQuicklinkUrl, type PrefsState, type Quicklink, type ThemeMode } from "./prefs-api.ts";
  import AccountOnboardingCard from "../auth/AccountOnboardingCard.svelte";
  import SoftwareUpdateCard from "./SoftwareUpdateCard.svelte";
  import AuditLogCard from "./AuditLogCard.svelte";

  type SettingsTab = "prefs" | "account" | "updates" | "audit";

  let { role = null, deviceLabel = null, onThemeChange }: {
    role?: "viewer" | "operator" | "owner" | null;
    deviceLabel?: string | null;
    onThemeChange?: (theme: string) => void;
  } = $props();

  let tab = $state<SettingsTab>("prefs");
  let view = $state<PrefsState>({ kind: "loading" });
  let newTitle = $state("");
  let newUrl = $state("");
  let formError = $state<string | null>(null);
  let confirmRemoveId = $state<string | null>(null);
  let lastNotifiedTheme: string | null = null;
  let controller: ReturnType<typeof createPrefsController> | undefined;

  let isOwner = $derived(role === "owner");
  let themeMode = $derived<ThemeMode>(view.kind === "ready" && view.prefs.tweaks?.theme ? view.prefs.tweaks.theme : "system");
  let reducedMotion = $derived<boolean>(view.kind === "ready" ? Boolean(view.prefs.tweaks?.reducedMotion) : false);
  let quicklinks = $derived<Quicklink[]>(view.kind === "ready" ? (view.prefs.quicklinks ?? []) : []);

  function notifyTheme(theme: ThemeMode) {
    if (lastNotifiedTheme !== theme) { lastNotifiedTheme = theme; onThemeChange?.(theme); }
  }
  export function refresh() { confirmRemoveId = null; formError = null; void controller?.refresh(); }
  async function handleThemeChange(nextTheme: ThemeMode) {
    if (await controller?.saveTweaks({ theme: nextTheme })) notifyTheme(nextTheme);
  }
  async function handleAddQuicklink(event: SubmitEvent) {
    event.preventDefault(); formError = null;
    if (!isSafeQuicklinkUrl(newUrl)) { formError = "Enter a valid http:// or https:// URL."; return; }
    if (await controller?.addQuicklink(newTitle, newUrl)) { newTitle = ""; newUrl = ""; }
  }
  function confirmRemove(id: string) { confirmRemoveId = null; void controller?.removeQuicklink(id); }

  onMount(() => {
    controller = createPrefsController((next) => {
      if (next.kind !== "ready") confirmRemoveId = null;
      else if (next.prefs.tweaks?.theme) notifyTheme(next.prefs.tweaks.theme);
      view = next;
    });
    void controller.refresh();
    return () => controller?.dispose();
  });
</script>

<section aria-labelledby="settings-title" aria-busy={tab === "prefs" && view.kind === "loading"} data-settings-state={view.kind}>
  <header class="feature-header">
    <h2 id="settings-title">Settings</h2>
    {#if tab === "prefs"}
      <button type="button" disabled={view.kind === "loading"} onclick={refresh}>{view.kind === "loading" ? "Loading..." : "Refresh"}</button>
    {/if}
  </header>

  <div class="settings-tabs" role="tablist" aria-label="Settings sections">
    <button type="button" role="tab" aria-selected={tab === "prefs"} class:primary={tab === "prefs"} onclick={() => { tab = "prefs"; }}>Preferences</button>
    <button type="button" role="tab" aria-selected={tab === "account"} class:primary={tab === "account"} onclick={() => { tab = "account"; }}>Account</button>
    <button type="button" role="tab" aria-selected={tab === "updates"} class:primary={tab === "updates"} onclick={() => { tab = "updates"; }}>Updates</button>
    <button type="button" role="tab" aria-selected={tab === "audit"} class:primary={tab === "audit"} onclick={() => { tab = "audit"; }}>Audit Log</button>
  </div>

  {#if tab === "account"}
    <div class="settings-tab-body"><AccountOnboardingCard {role} {deviceLabel} /></div>
  {:else if tab === "updates"}
    <div class="settings-tab-body"><SoftwareUpdateCard {role} /></div>
  {:else if tab === "audit"}
    <div class="settings-tab-body"><AuditLogCard {role} /></div>
  {:else}
    {#if !isOwner}
      <p class="feedback pending">Read-only view. Owner role is required to update shared workspace preferences.</p>
    {/if}
    <div role="status" aria-live="polite">
      {#if view.kind === "loading"}
        <p>Loading workspace preferences...</p>
      {:else if view.kind === "error"}
        <p class="feedback error" role="alert">{view.message}</p>
      {:else}
        {#if view.notice}<p class="feedback ok">{view.notice}</p>{/if}
        {#if view.actionError}<p class="feedback error" role="alert">{view.actionError}</p>{/if}
        <div class="settings-block">
          <h3>Appearance</h3>
          <div class="settings-grid">
            <div class="field">
              <label for="settings-theme">Theme mode</label>
              <select id="settings-theme" value={themeMode} disabled={!isOwner || view.saving} onchange={(e) => void handleThemeChange((e.currentTarget as HTMLSelectElement).value as ThemeMode)}>
                <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
              </select>
            </div>
            <label class="toggle-row" for="settings-reduced-motion">
              <input id="settings-reduced-motion" type="checkbox" checked={reducedMotion} disabled={!isOwner || view.saving} onchange={(e) => void controller?.saveTweaks({ reducedMotion: (e.currentTarget as HTMLInputElement).checked })} />
              <span>Reduce motion</span>
            </label>
          </div>
        </div>
        <div class="settings-block">
          <h3>Quicklinks ({quicklinks.length})</h3>
          {#if quicklinks.length === 0}
            <p>No quicklinks saved yet.</p>
          {:else}
            <ul class="ql-list" aria-label="Saved quicklinks">
              {#each quicklinks as item (item.id)}
                <li class="ql-row">
                  <a class="ql-link" href={item.url} target="_blank" rel="noopener noreferrer"><strong>{item.title}</strong><span>{item.url}</span></a>
                  {#if isOwner}
                    <div class="ql-actions">
                      {#if confirmRemoveId === item.id}
                        <button type="button" class="danger" disabled={view.saving} onclick={() => confirmRemove(item.id)}>Confirm remove</button>
                        <button type="button" disabled={view.saving} onclick={() => { confirmRemoveId = null; }}>Cancel</button>
                      {:else}
                        <button type="button" disabled={view.saving} onclick={() => { confirmRemoveId = item.id; }}>Remove</button>
                      {/if}
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
          {#if isOwner}
            <form class="ql-form" onsubmit={(e) => void handleAddQuicklink(e)} novalidate>
              <div class="field"><label for="quicklink-title">Title</label><input id="quicklink-title" type="text" bind:value={newTitle} disabled={view.saving} placeholder="Docs" /></div>
              <div class="field"><label for="quicklink-url">URL</label><input id="quicklink-url" type="url" bind:value={newUrl} disabled={view.saving} placeholder="https://example.com" required /></div>
              {#if formError}<p class="feedback error" role="alert">{formError}</p>{/if}
              <div class="actions"><button type="submit" class="primary" disabled={view.saving}>{view.saving ? "Saving..." : "Add quicklink"}</button></div>
            </form>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  .settings-tabs { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.875rem; }
  .settings-tab-body { margin-top: 1rem; }
  .settings-block { margin-top: 1.25rem; display: grid; gap: 0.75rem; min-width: 0; }
  .settings-grid { display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fit, minmax(min(12rem, 100%), 1fr)); align-items: end; }
  .toggle-row { display: inline-flex; align-items: center; gap: 0.625rem; min-height: var(--ui-control-height); font-weight: 600; color: var(--text); cursor: pointer; }
  .toggle-row input { min-height: 1.25rem; width: 1.25rem; padding: 0; margin: 0; }
  .ql-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.625rem; }
  .ql-row { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap; padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel); }
  .ql-link { display: grid; gap: 0.125rem; min-width: 0; flex: 1 1 12rem; color: var(--text); text-decoration: none; }
  .ql-link:hover strong { color: var(--accent); text-decoration: underline; }
  .ql-link span { font-size: 0.875rem; color: var(--muted); overflow-wrap: anywhere; }
  .ql-actions { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .ql-form { display: grid; gap: 0.75rem; padding-top: 0.5rem; border-top: 1px solid var(--border); }
</style>
