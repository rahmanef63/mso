<script lang="ts">
  import { onMount } from "svelte";
  import {
    createDocsController,
    type ChangelogSection,
    type DocsState,
  } from "./docs-api.ts";

  type DocsTab = "whats-new" | "quick-ref";

  const QUICK_REFERENCE = [
    {
      title: "Keyboard shortcuts",
      items: [
        "Ctrl+S or Cmd+S saves the active buffer in the Code Editor.",
        "Enter submits path lookups and workspace forms.",
        "Tab and Shift+Tab navigate interactive controls in focus order.",
      ],
    },
    {
      title: "Device roles and authorization",
      items: [
        "MSO enforces Viewer, Operator, and Owner roles on the server.",
        "Hiding or disabling controls in the UI is convenience only, not an authorization boundary.",
        "Privileged settings and device approvals require an authenticated Owner session.",
      ],
    },
    {
      title: "Host and filesystem boundaries",
      items: [
        "Filesystem requests use authenticated /api/v1/fs/* endpoints with no-store responses.",
        "Private credentials and runtime state under ~/.mso are blocked by host-file guards.",
        "Local desktop and web clients stay same-origin unless explicitly configured by the shell bridge.",
      ],
    },
    {
      title: "Changelog source",
      items: [
        "What's New reads GET /api/changelog from the running deployment's generated changelog.",
        "Run node scripts/gen-changelog.mjs or ship a release if a fresh checkout has no generated file yet.",
      ],
    },
  ] as const;

  let activeTab = $state<DocsTab>("whats-new");
  let view = $state<DocsState>({ kind: "loading" });
  let filterQuery = $state("");
  let controller: ReturnType<typeof createDocsController> | undefined;

  let filteredSections = $derived.by<ChangelogSection[]>(() => {
    if (view.kind !== "ready") return [];
    const query = filterQuery.trim().toLowerCase();
    if (!query) return view.sections;
    return view.sections.flatMap((section): ChangelogSection[] => {
      if (section.heading.toLowerCase().includes(query)) return [section];
      const matches = section.items.filter((item) => item.toLowerCase().includes(query));
      return matches.length > 0 ? [{ heading: section.heading, items: matches }] : [];
    });
  });

  export function refresh() {
    void controller?.refresh();
  }

  onMount(() => {
    controller = createDocsController((next) => { view = next; });
    void controller.refresh();
    return () => controller?.dispose();
  });
</script>

<section
  aria-labelledby="docs-title"
  aria-busy={activeTab === "whats-new" && view.kind === "loading"}
  data-docs-tab={activeTab}
  data-docs-state={view.kind}
>
  <header class="feature-header">
    <h2 id="docs-title">Docs &amp; Changelog</h2>
    {#if activeTab === "whats-new"}
      <button type="button" disabled={view.kind === "loading"} onclick={refresh}>
        {view.kind === "loading" ? "Loading..." : "Refresh"}
      </button>
    {/if}
  </header>

  <div class="docs-tabs" role="tablist" aria-label="Documentation sections">
    <button
      id="tab-whats-new"
      type="button"
      role="tab"
      aria-selected={activeTab === "whats-new"}
      aria-controls="panel-whats-new"
      class:primary={activeTab === "whats-new"}
      onclick={() => { activeTab = "whats-new"; }}
    >
      What's New
    </button>
    <button
      id="tab-quick-ref"
      type="button"
      role="tab"
      aria-selected={activeTab === "quick-ref"}
      aria-controls="panel-quick-ref"
      class:primary={activeTab === "quick-ref"}
      onclick={() => { activeTab = "quick-ref"; }}
    >
      Quick Reference
    </button>
  </div>

  {#if activeTab === "whats-new"}
    <div id="panel-whats-new" role="tabpanel" aria-labelledby="tab-whats-new" class="docs-panel">
      <div class="field docs-filter">
        <label for="docs-changelog-filter">Filter release notes</label>
        <input
          id="docs-changelog-filter"
          type="search"
          bind:value={filterQuery}
          placeholder="Search date, scope, or change"
        />
      </div>

      <div role="status" aria-live="polite">
        {#if view.kind === "loading"}
          <p>Loading changelog...</p>
        {:else if view.kind === "error"}
          <p class="feedback error" role="alert">{view.message}</p>
        {:else if !view.generated}
          <p class="feedback pending">
            No generated changelog is available in this checkout yet. Run
            <code>node scripts/gen-changelog.mjs</code> to populate release notes.
          </p>
        {:else if view.sections.length === 0}
          <p>No changelog entries were found.</p>
        {:else if filteredSections.length === 0}
          <p>No changelog entries match "{filterQuery.trim()}".</p>
        {:else}
          <div class="changelog-list">
            {#each filteredSections as section (section.heading)}
              <article class="docs-card">
                <h3>{section.heading}</h3>
                <ul>
                  {#each section.items as item, index (`${section.heading}-${index}`)}
                    <li>{item}</li>
                  {/each}
                </ul>
              </article>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <div id="panel-quick-ref" role="tabpanel" aria-labelledby="tab-quick-ref" class="docs-panel">
      <div class="ref-grid">
        {#each QUICK_REFERENCE as group (group.title)}
          <article class="docs-card">
            <h3>{group.title}</h3>
            <ul>
              {#each group.items as item (item)}
                <li>{item}</li>
              {/each}
            </ul>
          </article>
        {/each}
      </div>
    </div>
  {/if}
</section>

<style>
  .docs-tabs { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.875rem; }
  .docs-panel { margin-top: 1rem; display: grid; gap: 0.875rem; min-width: 0; }
  .docs-filter { max-width: 26rem; }
  .changelog-list,
  .ref-grid { display: grid; gap: 0.75rem; min-width: 0; }
  .ref-grid { grid-template-columns: repeat(auto-fit, minmax(min(18rem, 100%), 1fr)); }
  .docs-card {
    padding: 0.875rem 1rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface);
    min-width: 0;
  }
  .docs-card ul { margin: 0.5rem 0 0; padding-left: 1.25rem; display: grid; gap: 0.375rem; }
  .docs-card li { color: var(--text); overflow-wrap: anywhere; }
</style>
