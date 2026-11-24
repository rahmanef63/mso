<script lang="ts">
  import { parseMarkdown, type Block } from "./markdown.ts";
  import NoteInline from "./NoteInline.svelte";

  let { content, resolve, onopen }: {
    content: string;
    resolve?: (target: string, wiki: boolean) => string | undefined;
    onopen?: (path: string) => void;
  } = $props();

  // Structured Markdown only: blocks render as markup, HTML in the note stays text.
  let blocks = $derived<Block[]>(parseMarkdown(content));
</script>

<div class="note-preview">
  {#each blocks as block, index (index)}
    {#if block.kind === "heading"}
      {#if block.level === 1}
        <h1><NoteInline inline={block.inline} {resolve} {onopen} /></h1>
      {:else if block.level === 2}
        <h2><NoteInline inline={block.inline} {resolve} {onopen} /></h2>
      {:else if block.level === 3}
        <h3><NoteInline inline={block.inline} {resolve} {onopen} /></h3>
      {:else}
        <h4><NoteInline inline={block.inline} {resolve} {onopen} /></h4>
      {/if}
    {:else if block.kind === "paragraph"}
      <p><NoteInline inline={block.inline} {resolve} {onopen} /></p>
    {:else if block.kind === "code"}
      <figure class="nt-code">
        {#if block.lang}<figcaption>{block.lang}</figcaption>{/if}
        <pre><code>{block.code}</code></pre>
      </figure>
    {:else if block.kind === "list"}
      {#if block.ordered}
        <ol>{#each block.items as item, i (i)}<li><NoteInline inline={item} {resolve} {onopen} /></li>{/each}</ol>
      {:else}
        <ul>{#each block.items as item, i (i)}<li><NoteInline inline={item} {resolve} {onopen} /></li>{/each}</ul>
      {/if}
    {:else if block.kind === "quote"}
      <blockquote><NoteInline inline={block.inline} {resolve} {onopen} /></blockquote>
    {:else}
      <hr />
    {/if}
  {/each}
</div>

<style>
  .note-preview { display: grid; gap: 0.75rem; font-size: 0.9375rem; line-height: 1.6; color: var(--text); overflow-wrap: anywhere; }
  .note-preview :global(h1) { font-size: 1.25rem; }
  .note-preview :global(h2) { font-size: 1.0625rem; }
  .note-preview :global(h3), .note-preview :global(h4) { font-size: 0.9375rem; }
  .note-preview :global(p) { margin: 0; color: var(--text); white-space: pre-wrap; }
  .note-preview :global(ul), .note-preview :global(ol) { margin: 0; padding-left: 1.25rem; display: grid; gap: 0.2rem; }
  .note-preview :global(blockquote) { margin: 0; padding-left: 0.75rem; border-left: 3px solid var(--border); color: var(--muted); }
  .note-preview :global(hr) { border: 0; border-top: 1px solid var(--border); margin: 0.25rem 0; }
  .note-preview :global(code) { font-family: var(--font-mono); font-size: 0.8125rem; background: color-mix(in srgb, var(--muted) 14%, transparent); padding: 0.05rem 0.3rem; border-radius: 0.25rem; overflow-wrap: anywhere; }
  .nt-code { margin: 0; border: 1px solid var(--border); border-radius: 0.375rem; background: var(--panel); overflow-x: auto; }
  .nt-code figcaption { padding: 0.2rem 0.5rem; font-size: 0.7rem; color: var(--muted); border-bottom: 1px solid var(--border); text-transform: lowercase; }
  .nt-code pre { margin: 0; padding: 0.625rem; max-width: 100%; overflow-x: auto; }
  .nt-code pre code { background: none; padding: 0; white-space: pre; }
  .note-preview :global(.nt-link) { min-height: 0; padding: 0; border: 0; background: none; color: var(--accent); text-decoration: underline; text-underline-offset: 2px; font: inherit; text-align: left; overflow-wrap: anywhere; }
  .note-preview :global(.nt-unresolved) { color: var(--muted); text-decoration: underline dotted; text-underline-offset: 2px; }
  .note-preview :global(.nt-image) { font-size: 0.8125rem; color: var(--muted); }
  .note-preview :global(a) { color: var(--accent); text-underline-offset: 2px; overflow-wrap: anywhere; }
</style>
