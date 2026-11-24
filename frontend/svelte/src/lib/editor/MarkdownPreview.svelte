<script lang="ts">
  import { baseName } from "./editor-api.ts";
  import { parseMarkdownBlocks, type MdInline } from "./editor-markdown.ts";

  let {
    path,
    content,
  }: {
    path: string;
    content: string;
  } = $props();

  let blocks = $derived(parseMarkdownBlocks(content));
</script>

{#snippet renderInlines(inlines: MdInline[])}
  {#each inlines as item, idx (idx)}
    {#if item.kind === "code"}
      <code class="md-inline-code">{item.text}</code>
    {:else if item.kind === "bold"}
      <strong>{item.text}</strong>
    {:else if item.kind === "italic"}
      <em>{item.text}</em>
    {:else if item.kind === "link"}
      <a href={item.href} target="_blank" rel="noopener noreferrer">{item.text}</a>
    {:else}
      {item.text}
    {/if}
  {/each}
{/snippet}

<section class="md-preview" aria-label={`Markdown preview for ${baseName(path)}`}>
  <header class="md-head">
    <span>Preview: {baseName(path)}</span>
  </header>
  <div class="md-body">
    {#if blocks.length === 0}
      <p class="md-empty">Empty Markdown document.</p>
    {:else}
      {#each blocks as block, bIdx (bIdx)}
        {#if block.kind === "heading"}
          {#if block.level === 1}<h1>{@render renderInlines(block.inlines)}</h1>
          {:else if block.level === 2}<h2>{@render renderInlines(block.inlines)}</h2>
          {:else if block.level === 3}<h3>{@render renderInlines(block.inlines)}</h3>
          {:else if block.level === 4}<h4>{@render renderInlines(block.inlines)}</h4>
          {:else if block.level === 5}<h5>{@render renderInlines(block.inlines)}</h5>
          {:else}<h6>{@render renderInlines(block.inlines)}</h6>{/if}
        {:else if block.kind === "paragraph"}
          <p>{@render renderInlines(block.inlines)}</p>
        {:else if block.kind === "code"}
          <div class="md-code-wrap">
            {#if block.lang}<span class="md-code-lang">{block.lang}</span>{/if}
            <pre class="md-code"><code>{block.text}</code></pre>
          </div>
        {:else if block.kind === "quote"}
          <blockquote>
            {#each block.lines as qLine, qIdx (qIdx)}
              <p>{@render renderInlines(qLine)}</p>
            {/each}
          </blockquote>
        {:else if block.kind === "list"}
          {#if block.ordered}
            <ol>
              {#each block.items as item, iIdx (iIdx)}
                <li>{@render renderInlines(item)}</li>
              {/each}
            </ol>
          {:else}
            <ul>
              {#each block.items as item, iIdx (iIdx)}
                <li>{@render renderInlines(item)}</li>
              {/each}
            </ul>
          {/if}
        {:else if block.kind === "hr"}
          <hr />
        {/if}
      {/each}
    {/if}
  </div>
</section>

<style>
  .md-preview {
    display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 0;
    border: 0; border-radius: 0; background: var(--panel-solid);
    -webkit-backdrop-filter: none; backdrop-filter: none;
  }
  .md-head {
    padding: 0.35rem 0.65rem; border-bottom: 1px solid var(--border);
    background: var(--panel); font-size: 0.74rem; font-weight: 600; color: var(--muted);
  }
  .md-body {
    flex: 1 1 auto; overflow: auto; padding: 0.85rem 1rem; color: var(--text);
    font-size: 0.88rem; line-height: 1.6; overflow-wrap: anywhere;
  }
  .md-body h1 { font-size: 1.35rem; margin: 0 0 0.6rem; border-bottom: 1px solid var(--border); padding-bottom: 0.25rem; }
  .md-body h2 { font-size: 1.15rem; margin: 1rem 0 0.45rem; }
  .md-body h3 { font-size: 1rem; margin: 0.85rem 0 0.35rem; }
  .md-body h4, .md-body h5, .md-body h6 { font-size: 0.9rem; margin: 0.75rem 0 0.3rem; }
  .md-body p { margin: 0.45rem 0; color: var(--text); }
  .md-body ul, .md-body ol { margin: 0.45rem 0; padding-left: 1.35rem; }
  .md-body li { margin: 0.2rem 0; }
  .md-body blockquote {
    margin: 0.6rem 0; padding: 0.35rem 0.75rem;
    border-left: 3px solid var(--accent); background: var(--panel); border-radius: 0 0.375rem 0.375rem 0;
  }
  .md-body hr { border: 0; border-top: 1px solid var(--border); margin: 0.9rem 0; }
  .md-body a { color: var(--accent); text-decoration: underline; }
  .md-inline-code {
    font-family: var(--font-mono); font-size: 0.82em; padding: 0.1rem 0.3rem;
    border-radius: 0.25rem; background: var(--surface); border: 1px solid var(--border);
  }
  .md-code-wrap {
    margin: 0.6rem 0; border: 1px solid var(--border); border-radius: 0.5rem;
    overflow: hidden; background: var(--surface);
  }
  .md-code-lang {
    display: block; padding: 0.2rem 0.55rem; font-size: 0.7rem; font-family: var(--font-mono);
    color: var(--muted); border-bottom: 1px solid var(--border); background: var(--panel);
  }
  .md-code {
    margin: 0; padding: 0.65rem; overflow: auto; font-family: var(--font-mono);
    font-size: 0.8rem; line-height: 1.45;
  }
  .md-empty { color: var(--muted); font-style: italic; }
</style>
