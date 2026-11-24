<script lang="ts">
  import { parseMarkdown, type InlineSegment } from "./markdown-blocks";

  let { text }: { text: string } = $props();

  let blocks = $derived(parseMarkdown(text));
  let copiedBlock = $state<number | null>(null);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  async function copyCode(code: string, index: number) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
        copiedBlock = index;
        if (copyTimer) clearTimeout(copyTimer);
        copyTimer = setTimeout(() => { copiedBlock = null; }, 1600);
      }
    } catch {
      copiedBlock = null;
    }
  }
</script>

{#snippet inlineNodes(segments: InlineSegment[])}
  {#each segments as seg, i (i)}
    {#if seg.kind === "code"}
      <code class="md-inline-code">{seg.text}</code>
    {:else if seg.kind === "strong"}
      <strong>{seg.text}</strong>
    {:else if seg.kind === "em"}
      <em>{seg.text}</em>
    {:else if seg.kind === "link"}
      <a class="md-link" href={seg.href} target="_blank" rel="noopener noreferrer">{seg.label}</a>
    {:else}
      {seg.text}
    {/if}
  {/each}
{/snippet}

<div class="md-root">
  {#each blocks as block, idx (idx)}
    {#if block.kind === "heading"}
      {#if block.level === 1}
        <h3 class="md-h1">{@render inlineNodes(block.segments)}</h3>
      {:else if block.level === 2}
        <h4 class="md-h2">{@render inlineNodes(block.segments)}</h4>
      {:else}
        <h5 class="md-h3">{@render inlineNodes(block.segments)}</h5>
      {/if}
    {:else if block.kind === "code"}
      <div class="md-code-block">
        <div class="md-code-head">
          <span class="md-lang">{block.lang || "code"}</span>
          <button
            type="button"
            class="md-copy-btn"
            onclick={() => void copyCode(block.code, idx)}
          >
            {copiedBlock === idx ? "Copied" : "Copy"}
          </button>
        </div>
        <pre class="md-pre"><code>{block.code}</code></pre>
      </div>
    {:else if block.kind === "list"}
      {#if block.ordered}
        <ol class="md-list">
          {#each block.items as item, itemIdx (itemIdx)}
            <li>{@render inlineNodes(item)}</li>
          {/each}
        </ol>
      {:else}
        <ul class="md-list">
          {#each block.items as item, itemIdx (itemIdx)}
            <li>{@render inlineNodes(item)}</li>
          {/each}
        </ul>
      {/if}
    {:else if block.kind === "blockquote"}
      <blockquote class="md-quote">{@render inlineNodes(block.segments)}</blockquote>
    {:else}
      <p class="md-para">{@render inlineNodes(block.segments)}</p>
    {/if}
  {/each}
</div>

<style>
  .md-root {
    display: grid;
    gap: 0.5rem;
    min-width: 0;
    max-width: 100%;
    color: var(--text);
    font-size: 0.9375rem;
    line-height: 1.55;
  }
  .md-h1, .md-h2, .md-h3 {
    margin: 0.25rem 0 0;
    color: var(--text);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .md-h1 { font-size: 1.0625rem; }
  .md-h2 { font-size: 0.98rem; }
  .md-h3 { font-size: 0.92rem; }
  .md-para {
    margin: 0;
    color: var(--text);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .md-list {
    margin: 0;
    padding-left: 1.25rem;
    display: grid;
    gap: 0.25rem;
    color: var(--text);
  }
  .md-list li { overflow-wrap: anywhere; }
  .md-quote {
    margin: 0;
    padding: 0.35rem 0.65rem;
    border-left: 3px solid var(--accent);
    background: var(--surface);
    color: var(--muted);
    border-radius: 0 0.375rem 0.375rem 0;
    overflow-wrap: anywhere;
  }
  .md-inline-code {
    font-family: var(--font-mono);
    font-size: 0.84em;
    padding: 0.1rem 0.35rem;
    border-radius: 0.25rem;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .md-link {
    color: var(--accent);
    text-decoration: underline;
    overflow-wrap: anywhere;
  }
  .md-code-block {
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface);
    overflow: hidden;
    min-width: 0;
    max-width: 100%;
  }
  .md-code-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.25rem 0.6rem;
    border-bottom: 1px solid var(--border);
    background: var(--panel-solid);
  }
  .md-lang {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .md-copy-btn {
    min-height: 1.75rem;
    padding: 0.15rem 0.55rem;
    font-size: 0.75rem;
  }
  .md-pre {
    margin: 0;
    padding: 0.65rem 0.75rem;
    overflow-x: auto;
    max-width: 100%;
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--text);
  }
</style>
