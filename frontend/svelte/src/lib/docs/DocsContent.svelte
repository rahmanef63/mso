<script lang="ts">
  import type { DocsGroup } from "./docs-sections.ts";

  let {
    groups, query, emptyMessage, onChange,
  }: {
    groups: readonly DocsGroup[];
    query: string;
    emptyMessage: string;
    onChange: (value: string) => void;
  } = $props();
</script>

<div class="docs-groups">
  {#if groups.length === 0}
    <p class="docs-note">{emptyMessage}</p>
  {:else}
    {#each groups as group (group.title)}
      <article class="docs-card">
        <h3>{group.title}</h3>
        <dl>
          {#each group.entries as entry, index (`${group.title}-${index}`)}
            <div class="docs-entry">
              <dt>{entry.title}</dt>
              {#if entry.body}<dd>{entry.body}</dd>{/if}
            </div>
          {/each}
        </dl>
      </article>
    {/each}
  {/if}
  {#if query.trim() && groups.length > 0}
    <p class="docs-note">Filtered by "{query.trim()}". Clear the search to see every entry.</p>
  {:else if onChange && groups.length === 0 && query.trim()}
    <button type="button" class="docs-clear" onclick={() => onChange("")}>Clear search</button>
  {/if}
</div>

<style>
  .docs-groups { display: grid; gap: 0.625rem; min-width: 0; }
  .docs-note { margin: 0; font-size: 0.8125rem; color: var(--muted); }
  .docs-card { padding: 0.75rem 0.875rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--surface); min-width: 0; }
  .docs-card h3 { margin: 0 0 0.5rem; font-size: 0.8125rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); }
  dl { display: grid; gap: 0.5rem; margin: 0; }
  .docs-entry { display: grid; gap: 0.125rem; min-width: 0; }
  dt { font-size: 0.8125rem; font-weight: 600; overflow-wrap: anywhere; }
  dd { margin: 0; font-size: 0.8125rem; color: var(--muted); overflow-wrap: anywhere; }
  .docs-clear { justify-self: start; font-size: 0.75rem; padding: 0.1875rem 0.5rem; }
</style>
