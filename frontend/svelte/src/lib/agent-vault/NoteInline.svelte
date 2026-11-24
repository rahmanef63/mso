<script lang="ts">
  import type { Inline } from "./markdown.ts";
  import { safeExternalLink } from "./note-links.ts";

  let { inline, resolve, onopen }: {
    inline: Inline[];
    resolve?: (target: string, wiki: boolean) => string | undefined;
    onopen?: (path: string) => void;
  } = $props();
</script>

{#each inline as part, i (i)}
  {#if part.kind === "text"}{part.text}
  {:else if part.kind === "code"}<code>{part.text}</code>
  {:else if part.kind === "strong"}<strong>{part.text}</strong>
  {:else if part.kind === "em"}<em>{part.text}</em>
  {:else if part.kind === "image"}<span class="nt-image">[image: {part.alt}]</span>
  {:else if part.kind === "link"}
    {@const path = resolve?.(part.target, part.wiki)}
    {#if path && onopen}
      <button type="button" class="nt-link" onclick={() => onopen?.(path)}>{part.label}</button>
    {:else if !part.wiki && safeExternalLink(part.target)}
      <a href={safeExternalLink(part.target)} target="_blank" rel="noopener noreferrer">{part.label}</a>
    {:else}
      <span class="nt-unresolved" title="This link does not resolve to a note in this snapshot">{part.label}</span>
    {/if}
  {/if}
{/each}
