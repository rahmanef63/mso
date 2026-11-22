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

  let { role = null }: { role?: "viewer" | "operator" | "owner" | null } = $props();

  let view = $state<ExtensionsState>({ kind: "loading", tab: "features" });
  let filterQuery = $state("");
  let controller: ReturnType<typeof createExtensionsController> | undefined;

  let isOwner = $derived(role === "owner");

  let visibleFeatures = $derived.by<ModularFeatureSummary[]>(() => {
    if (view.kind !== "ready") return [];
    const q = filterQuery.trim().toLowerCase();
    if (!q) return view.features;
    return view.features.filter((f) =>
      `${f.id} ${f.title ?? ""} ${f.name ?? ""} ${f.version} ${f.description ?? ""}`.toLowerCase().includes(q));
  });

  let visibleSkills = $derived.by<SkillSummary[]>(() => {
    if (view.kind !== "ready") return [];
    const q = filterQuery.trim().toLowerCase();
    if (!q) return view.skills;
    return view.skills.filter((s) =>
      `${s.id} ${s.name} ${s.description} ${s.source} ${s.trust}`.toLowerCase().includes(q));
  });

  let visibleRecipes = $derived.by<SkillRecipeSummary[]>(() => {
    if (view.kind !== "ready") return [];
    const q = filterQuery.trim().toLowerCase();
    if (!q) return view.recipes;
    return view.recipes.filter((r) =>
      `${r.id} ${r.intent} ${r.summary ?? ""}`.toLowerCase().includes(q));
  });

  let stateTag = $derived.by(() => {
    if (view.tab === "skills" && !isOwner) return "owner-only";
    if (view.kind !== "ready") return view.kind;
    if (view.tab === "features") {
      if (view.features.length === 0) return "empty";
      return visibleFeatures.length === 0 ? "no-filter-matches" : "ready";
    }
    if (view.skills.length === 0 && view.recipes.length === 0) return "empty";
    return visibleSkills.length === 0 && visibleRecipes.length === 0 ? "no-filter-matches" : "ready";
  });

  function trustTone(trust: string): "ok" | "warn" | "danger" | "neutral" {
    const t = trust.toLowerCase();
    if (t === "trusted" || t === "official" || t === "verified" || t === "builtin") return "ok";
    if (t === "local" || t === "community" || t === "review") return "warn";
    if (t === "untrusted" || t === "blocked") return "danger";
    return "neutral";
  }

  function switchTab(nextTab: ExtensionsTab) {
    if (view.tab === nextTab && view.kind !== "error") return;
    if (nextTab === "skills" && !isOwner) {
      view = { kind: "ready", tab: "skills", features: [], skills: [], recipes: [] };
      return;
    }
    void controller?.setTab(nextTab);
  }

  export function refresh() {
    if (view.tab === "skills" && !isOwner) return;
    void controller?.refresh();
  }

  onMount(() => {
    controller = createExtensionsController((next) => { view = next; });
    void controller.refresh();
    return () => controller?.dispose();
  });
</script>

<section aria-labelledby="extensions-title" aria-busy={view.kind === "loading"} data-extensions-state={stateTag} data-extensions-tab={view.tab}>
  <header class="feature-header">
    <h2 id="extensions-title">Extensions</h2>
    <div class="actions">
      <div class="ext-tabs" role="tablist" aria-label="Extension categories">
        <button type="button" role="tab" aria-selected={view.tab === "features"} class:primary={view.tab === "features"} onclick={() => switchTab("features")}>
          Modular Features
        </button>
        <button type="button" role="tab" aria-selected={view.tab === "skills"} class:primary={view.tab === "skills"} onclick={() => switchTab("skills")}>
          Skills &amp; Recipes
        </button>
      </div>
      {#if view.tab === "features" || isOwner}
        <button type="button" disabled={view.kind === "loading"} onclick={refresh}>
          {view.kind === "loading" ? "Loading..." : "Refresh"}
        </button>
      {/if}
    </div>
  </header>

  {#if view.tab === "skills" && !isOwner}
    <p class="feedback pending" role="status">
      Owner role is required to inspect installed agent skills and verified recipes. Sign in from an Owner device to view skill trust metadata.
    </p>
  {:else}
    <div class="ext-filter-wrap">
      <label for="extensions-filter">Filter {view.tab === "features" ? "modular features" : "skills and recipes"}</label>
      <input
        id="extensions-filter"
        type="search"
        bind:value={filterQuery}
        placeholder={view.tab === "features" ? "Feature ID, title, version, or description" : "Skill name, trust level, source, or recipe intent"}
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
          <p>No modular features match "{filterQuery.trim()}".</p>
        {:else}
          <ul class="ext-list" aria-label="Modular features">
            {#each visibleFeatures as feat (feat.id)}
              <li class="ext-row">
                <div class="ext-info">
                  <div class="ext-heading">
                    <strong>{feat.title ?? feat.name ?? feat.id}</strong>
                    <code>{feat.id}</code>
                    <span class="pill" data-tone="ok">v{feat.version}</span>
                  </div>
                  {#if feat.description}<p class="ext-desc">{feat.description}</p>{/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      {:else if view.skills.length === 0 && view.recipes.length === 0}
        <p>No skills or recipes registered for this workspace.</p>
      {:else if visibleSkills.length === 0 && visibleRecipes.length === 0}
        <p>No skills or recipes match "{filterQuery.trim()}".</p>
      {:else}
        {#if visibleSkills.length > 0}
          <ul class="ext-list" aria-label="Agent skills">
            {#each visibleSkills as skill (skill.id)}
              <li class="ext-row">
                <div class="ext-info">
                  <div class="ext-heading">
                    <strong>{skill.name}</strong>
                    <code>{skill.id}</code>
                    <span class="pill" data-tone={trustTone(skill.trust)}>{skill.trust}</span>
                    <span class="pill">{skill.source}</span>
                  </div>
                  {#if skill.description}<p class="ext-desc">{skill.description}</p>{/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
        {#if visibleRecipes.length > 0}
          <ul class="ext-list" aria-label="Verified recipes">
            {#each visibleRecipes as recipe (recipe.id)}
              <li class="ext-row">
                <div class="ext-info">
                  <div class="ext-heading">
                    <strong>{recipe.intent}</strong>
                    <code>{recipe.id}</code>
                    <span class="pill" data-tone="ok">recipe</span>
                    {#if recipe.successes !== undefined}<span class="pill">{recipe.successes} {recipe.successes === 1 ? "run" : "runs"}</span>{/if}
                  </div>
                  {#if recipe.summary}<p class="ext-desc">{recipe.summary}</p>{/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>
  {/if}
</section>

<style>
  .ext-tabs { display: inline-flex; gap: 0.375rem; flex-wrap: wrap; }
  .ext-filter-wrap { display: grid; gap: 0.375rem; margin: 1rem 0; }
  .ext-filter-wrap label { font-size: 0.875rem; font-weight: 600; color: var(--text); }
  .ext-filter-wrap input { width: 100%; min-width: 0; min-height: var(--ui-control-height); }
  .ext-list { list-style: none; padding: 0; margin: 0.5rem 0 0; display: grid; gap: 0.625rem; max-height: 24rem; overflow-y: auto; }
  .ext-row { padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel); }
  .ext-info { display: grid; gap: 0.25rem; min-width: 0; }
  .ext-heading { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .ext-heading code { font-size: 0.8125rem; color: var(--muted); }
  .ext-desc { margin: 0; font-size: 0.875rem; color: var(--muted); }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
  .pill[data-tone="danger"] { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
</style>
