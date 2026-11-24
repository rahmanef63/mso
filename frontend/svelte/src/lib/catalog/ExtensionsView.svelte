<script lang="ts">
  import { onMount } from "svelte";
  import {
    createExtensionsController,
    type ExtensionsState,
    type ExtensionsTab,
    type ModularFeatureSummary,
    type SkillRecipeSummary,
    type SkillSummary,
  } from "./catalog-api.ts";
  import { featureHeading, trustTone } from "./catalog-model.ts";
  import FeatureCard from "./FeatureCard.svelte";
  import FeatureInspector from "./FeatureInspector.svelte";
  import SkillMarketPanel from "./SkillMarketPanel.svelte";

  let { role = null }: { role?: "viewer" | "operator" | "owner" | null } = $props();

  let view = $state<ExtensionsState>({ kind: "loading", tab: "features" });
  let filterQuery = $state("");
  let inspected = $state<ModularFeatureSummary | null>(null);
  let controller: ReturnType<typeof createExtensionsController> | undefined;

  let isOwner = $derived(role === "owner");

  const TABS: ReadonlyArray<{ id: ExtensionsTab; label: string }> = [
    { id: "features", label: "Modular Features" },
    { id: "skills", label: "Installed Skills & Recipes" },
    { id: "market", label: "Skill Market" },
  ];

  let ready = $derived(view.kind === "ready" ? view : null);

  let visibleFeatures = $derived.by<ModularFeatureSummary[]>(() => {
    if (!ready) return [];
    const q = filterQuery.trim().toLowerCase();
    if (!q) return ready.features;
    return ready.features.filter((f) =>
      `${f.id} ${featureHeading(f)} ${f.version} ${f.description ?? ""} ${f.minRole ?? ""}`.toLowerCase().includes(q));
  });

  let visibleSkills = $derived.by<SkillSummary[]>(() => {
    if (!ready) return [];
    const q = filterQuery.trim().toLowerCase();
    if (!q) return ready.skills;
    return ready.skills.filter((s) =>
      `${s.id} ${s.name} ${s.description} ${s.source} ${s.trust}`.toLowerCase().includes(q));
  });

  let visibleRecipes = $derived.by<SkillRecipeSummary[]>(() => {
    if (!ready) return [];
    const q = filterQuery.trim().toLowerCase();
    if (!q) return ready.recipes;
    return ready.recipes.filter((r) => `${r.id} ${r.intent} ${r.summary ?? ""}`.toLowerCase().includes(q));
  });

  let stateTag = $derived.by(() => {
    if (view.tab !== "features" && !isOwner) return "owner-only";
    if (view.kind !== "ready") return view.kind;
    if (view.tab === "market") return "ready";
    if (view.tab === "features") {
      if (view.features.length === 0) return "empty";
      return visibleFeatures.length === 0 ? "no-filter-matches" : "ready";
    }
    if (view.skills.length === 0 && view.recipes.length === 0) return "empty";
    return visibleSkills.length === 0 && visibleRecipes.length === 0 ? "no-filter-matches" : "ready";
  });

  function switchTab(nextTab: ExtensionsTab) {
    if (view.tab === nextTab && view.kind !== "error") return;
    if (nextTab !== "features" && !isOwner) {
      view = { kind: "ready", tab: nextTab, features: [], skills: [], recipes: [] };
      return;
    }
    filterQuery = "";
    void controller?.setTab(nextTab);
  }

  export function refresh() {
    if (view.tab !== "features" && !isOwner) return;
    if (view.tab === "market") return;
    void controller?.refresh();
  }

  onMount(() => {
    controller = createExtensionsController((next) => { view = next; });
    void controller.refresh();
    return () => controller?.dispose();
  });
</script>

<section
  aria-labelledby="extensions-title"
  aria-busy={view.kind === "loading"}
  data-extensions-state={stateTag}
  data-extensions-tab={view.tab}
>
  <header class="feature-header ext-header">
    <h2 id="extensions-title">Extensions</h2>
    <div class="actions">
      {#if view.tab !== "market"}
        <button type="button" disabled={view.kind === "loading"} onclick={refresh}>
          {view.kind === "loading" ? "Loading..." : "Refresh"}
        </button>
      {/if}
    </div>
  </header>

  <div class="ext-tabs" role="tablist" aria-label="Extension categories">
    {#each TABS as tab (tab.id)}
      <button
        type="button"
        role="tab"
        id={`ext-tab-${tab.id}`}
        aria-selected={view.tab === tab.id}
        aria-controls="ext-panel"
        tabindex={view.tab === tab.id ? 0 : -1}
        class:primary={view.tab === tab.id}
        onclick={() => switchTab(tab.id)}
      >{tab.label}</button>
    {/each}
  </div>

  <div id="ext-panel" role="tabpanel" aria-labelledby={`ext-tab-${view.tab}`}>
    {#if view.tab === "market"}
      <SkillMarketPanel {isOwner} />
    {:else if view.tab !== "features" && !isOwner}
      <p class="feedback pending" role="status">
        Owner role is required to inspect installed agent skills and verified recipes. Sign in from an Owner device to view skill trust metadata.
      </p>
    {:else}
      <div class="field ext-filter-wrap">
        <label for="extensions-filter">
          Filter {view.tab === "features" ? "modular features" : "skills and recipes"}
        </label>
        <input
          id="extensions-filter"
          type="search"
          bind:value={filterQuery}
          placeholder={view.tab === "features" ? "Feature ID, title, version, minimum role" : "Skill name, trust level, source, or recipe intent"}
        />
      </div>

      <div role="status" aria-live="polite">
        {#if view.kind === "loading"}
          <p>Loading {view.tab === "features" ? "modular features" : "skills and recipes"}...</p>
        {:else if view.kind === "error"}
          <p class="feedback error" role="alert">{view.message}</p>
        {:else if view.tab === "features"}
          {#if view.features.length === 0}
            <p>No modular feature packages installed under ~/.mso/features.</p>
          {:else if visibleFeatures.length === 0}
            <p>No modular features match this search.</p>
          {:else}
            <ul class="ext-grid" aria-label="Modular features">
              {#each visibleFeatures as feat (feat.id)}
                <FeatureCard feature={feat} onInspect={(next) => { inspected = next; }} />
              {/each}
            </ul>
          {/if}
        {:else if view.skills.length === 0 && view.recipes.length === 0}
          <p>No skills or recipes registered for this workspace.</p>
        {:else if visibleSkills.length === 0 && visibleRecipes.length === 0}
          <p>No skills or recipes match this search.</p>
        {:else}
          {#if visibleSkills.length > 0}
            <ul class="ext-grid" aria-label="Agent skills">
              {#each visibleSkills as skill (skill.id)}
                <li class="ext-card">
                  <div class="ext-heading">
                    <strong>{skill.name}</strong>
                    <span class="pill" data-tone={trustTone(skill.trust)}>{skill.trust}</span>
                  </div>
                  <code class="ext-id">{skill.id}</code>
                  {#if skill.description}<p class="ext-desc">{skill.description}</p>{/if}
                  <span class="ext-source">{skill.source}</span>
                </li>
              {/each}
            </ul>
          {/if}
          {#if visibleRecipes.length > 0}
            <h3 class="ext-subhead">Verified recipes</h3>
            <ul class="ext-grid" aria-label="Verified recipes">
              {#each visibleRecipes as recipe (recipe.id)}
                <li class="ext-card">
                  <div class="ext-heading">
                    <strong>{recipe.intent}</strong>
                    <span class="pill" data-tone="ok">recipe</span>
                  </div>
                  <code class="ext-id">{recipe.id}</code>
                  {#if recipe.summary}<p class="ext-desc">{recipe.summary}</p>{/if}
                  {#if recipe.successes !== undefined}
                    <span class="ext-source">{recipe.successes} {recipe.successes === 1 ? "run" : "runs"}</span>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        {/if}
      </div>
    {/if}
  </div>

  <FeatureInspector feature={inspected} onClose={() => { inspected = null; }} />
</section>

<style>
  .ext-header { margin-bottom: 0.75rem; }
  .ext-tabs { display: flex; gap: 0.375rem; flex-wrap: wrap; margin-bottom: 0.875rem; }
  .ext-tabs button { min-height: var(--ui-control-height); font-size: 0.8125rem; }
  .ext-filter-wrap { margin-bottom: 0.75rem; }
  .ext-filter-wrap input { width: 100%; min-width: 0; }
  label { font-size: 0.8125rem; font-weight: 600; color: var(--text); }
  .ext-grid { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.75rem; grid-template-columns: 1fr; }
  .ext-card {
    display: grid;
    gap: 0.375rem;
    padding: 0.875rem;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    background: var(--panel-solid);
    min-width: 0;
  }
  .ext-heading { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; min-width: 0; }
  .ext-id { font-size: 0.75rem; color: var(--muted); overflow-wrap: anywhere; }
  .ext-desc { margin: 0; font-size: 0.8125rem; color: var(--muted); }
  .ext-source { font-size: 0.75rem; color: var(--muted); overflow-wrap: anywhere; }
  .ext-subhead { margin: 1rem 0 0.5rem; }
  .pill {
    display: inline-block;
    padding: 0.125rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: 0.75rem;
    color: var(--muted);
  }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
  .pill[data-tone="danger"] { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
  @media (min-width: 720px) {
    .ext-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
</style>
