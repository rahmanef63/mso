<script lang="ts">
  import { onMount } from "svelte";
  import { createDocsController, type DocsState } from "./docs-api.ts";
  import { STATIC_SECTIONS, countEntries, filterGroups, type DocsGroup, type DocsSectionId } from "./docs-sections.ts";
  import DocsContent from "./DocsContent.svelte";

  let activeSection = $state<DocsSectionId>("changelog");
  let view = $state<DocsState>({ kind: "loading" });
  let query = $state("");
  let navOpen = $state(false);
  let controller: ReturnType<typeof createDocsController> | undefined;

  let changelogGroups = $derived.by<DocsGroup[]>(() => {
    if (view.kind !== "ready" || !view.generated) return [];
    return view.sections.map((section): DocsGroup => ({
      title: section.heading,
      entries: section.items.map((item) => ({ title: item, body: "" })),
    }));
  });
  let activeGroups = $derived<DocsGroup[]>(
    activeSection === "changelog"
      ? changelogGroups
      : (STATIC_SECTIONS.find((section) => section.id === activeSection)?.groups ?? []));
  let filtered = $derived(filterGroups(activeGroups, query));
  let totalEntries = $derived(countEntries(activeGroups));

  let emptyMessage = $derived.by(() => {
    if (query.trim()) return `No entries match "${query.trim()}" in this section.`;
    if (activeSection === "changelog" && view.kind === "loading") return "Loading changelog...";
    if (activeSection === "changelog" && view.kind === "error") return "";
    if (activeSection === "changelog" && view.kind === "ready" && !view.generated) {
      return "No generated changelog in this checkout yet. Run node scripts/gen-changelog.mjs to populate release notes.";
    }
    return "This section has no entries yet.";
  });

  function select(id: DocsSectionId) {
    activeSection = id;
    query = "";
    navOpen = false;
  }

  export function refresh() {
    if (activeSection === "changelog") void controller?.refresh();
  }

  onMount(() => {
    controller = createDocsController((next) => { view = next; });
    void controller.refresh();
    return () => controller?.dispose();
  });
</script>

<section
  class="docs"
  aria-labelledby="docs-title"
  aria-busy={activeSection === "changelog" && view.kind === "loading"}
  data-docs-section={activeSection}
  data-docs-state={view.kind}
>
  <header class="docs-bar">
    <div class="docs-id">
      <h2 id="docs-title">Docs</h2>
      {#if totalEntries > 0}<span class="pill">{totalEntries} entries</span>{/if}
      <button type="button" class="docs-nav-toggle" aria-expanded={navOpen} aria-controls="docs-nav"
        onclick={() => { navOpen = !navOpen; }}>Sections</button>
    </div>
    <div class="docs-tools">
      <label class="sr-only" for="docs-search">Search documentation</label>
      <input id="docs-search" type="search" bind:value={query} placeholder="Search this section" />
      {#if activeSection === "changelog"}
        <button type="button" disabled={view.kind === "loading"} onclick={refresh}>
          {view.kind === "loading" ? "Loading..." : "Refresh"}
        </button>
      {/if}
    </div>
  </header>

  <div class="docs-layout" class:nav-open={navOpen}>
    <nav id="docs-nav" class="docs-nav" aria-label="Documentation sections">
      <button type="button" class:active={activeSection === "changelog"}
        aria-current={activeSection === "changelog" ? "page" : undefined}
        onclick={() => select("changelog")}>
        <span class="nav-label">What's New</span>
        <span class="nav-summary">Generated release notes</span>
      </button>
      {#each STATIC_SECTIONS as section (section.id)}
        <button type="button" class:active={activeSection === section.id}
          aria-current={activeSection === section.id ? "page" : undefined}
          onclick={() => select(section.id)}>
          <span class="nav-label">{section.label}</span>
          <span class="nav-summary">{section.summary}</span>
        </button>
      {/each}
      <p class="nav-foot">Rendered as structured text. No raw markup is injected.</p>
    </nav>

    <div class="docs-body" role="region" aria-live="polite">
      {#if activeSection === "changelog" && view.kind === "error"}
        <p class="feedback error" role="alert">{view.message}</p>
      {/if}
      <DocsContent groups={filtered} {query} {emptyMessage} onChange={(value) => { query = value; }} />
    </div>
  </div>
</section>

<style>
  .docs { display: grid; gap: 0.75rem; min-width: 0; }
  .docs-bar { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
  .docs-id, .docs-tools { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; min-width: 0; }
  .docs-bar h2 { margin: 0; font-size: 1rem; }
  .docs-tools input { min-height: 2rem; width: 13rem; max-width: 100%; }
  .docs-nav-toggle { display: none; font-size: 0.75rem; padding: 0.1875rem 0.5rem; }
  .docs-layout { display: grid; grid-template-columns: minmax(11rem, 15rem) minmax(0, 1fr); gap: 0.875rem; min-width: 0; }
  .docs-nav {
    display: grid; gap: 0.25rem; align-content: start; padding: 0.625rem;
    border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel);
  }
  .docs-nav button { display: grid; gap: 0.125rem; text-align: left; font-size: 0.8125rem; padding: 0.375rem 0.5rem; background: transparent; border-color: transparent; }
  .docs-nav button.active { border-color: var(--accent); background: var(--surface); color: var(--accent); }
  .nav-label { font-weight: 600; }
  .nav-summary { font-size: 0.6875rem; color: var(--muted); }
  .nav-foot { margin: 0.375rem 0 0; font-size: 0.6875rem; color: var(--muted); }
  .docs-body { display: grid; gap: 0.75rem; align-content: start; min-width: 0; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
  @media (max-width: 620px) {
    .docs-layout { grid-template-columns: minmax(0, 1fr); }
    .docs-nav-toggle { display: inline-flex; }
    .docs-nav { display: none; }
    .docs-layout.nav-open .docs-nav { display: grid; }
    .docs-tools input { width: 100%; }
  }
</style>
