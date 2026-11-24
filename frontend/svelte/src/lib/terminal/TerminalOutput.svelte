<script lang="ts">
  // Safe ANSI renderer: every run becomes a <span>, so no markup from the PTY
  // is ever interpreted as HTML.
  import { ansiColorCss, highlightRuns, parseAnsiRuns, type RenderRun } from "./term-ansi";

  let {
    text,
    query = "",
    activeMatch = -1,
    fontSize = 13,
    placeholder = "No terminal output yet.",
    outputEl = $bindable<HTMLPreElement | undefined>(undefined),
  }: {
    text: string;
    query?: string;
    activeMatch?: number;
    fontSize?: number;
    placeholder?: string;
    outputEl?: HTMLPreElement | undefined;
  } = $props();

  let runs = $derived.by<RenderRun[]>(() => highlightRuns(parseAnsiRuns(text), query, activeMatch));
</script>

<pre
  bind:this={outputEl}
  class="term-output"
  style:font-size={`${fontSize}px`}
  role="log"
  aria-live="polite"
  aria-label="Terminal output"
>{#if text}{#each runs as run, index (index)}<span
      class="run"
      class:hit={run.hit === "match"}
      class:active-hit={run.hit === "active"}
      class:bold={run.bold}
      class:dim={run.dim}
      class:italic={run.italic}
      class:underline={run.underline}
      style:color={ansiColorCss(run.fg)}
      style:background-color={ansiColorCss(run.bg)}
    >{run.text}</span>{/each}{:else}{placeholder}{/if}</pre>

<style>
  .term-output {
    margin: 0; padding: 0.75rem; flex: 1 1 auto; min-height: 8rem; min-width: 0; width: 100%; max-width: 100%;
    overflow: auto; border: 1px solid var(--border); border-radius: 0.5rem;
    background: var(--surface); color: var(--text);
    font-family: var(--font-mono); line-height: 1.45;
    white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word;
  }
  /* ANSI palette: readable on the light surface, brightened for dark. Only SGR
     colours reach these vars, so no PTY byte can inject a style value. */
  .term-output {
    --t-ansi-black: #24242b; --t-ansi-red: #a01d2b; --t-ansi-green: #14653a;
    --t-ansi-yellow: #7a5200; --t-ansi-blue: #1f4fa8; --t-ansi-magenta: #8b1f87;
    --t-ansi-cyan: #0b5f6b; --t-ansi-white: #4a4a55;
    --t-ansi-bright-black: #52525b; --t-ansi-bright-red: #c62828;
    --t-ansi-bright-green: #166534; --t-ansi-bright-yellow: #92400e;
    --t-ansi-bright-blue: #1d4ed8; --t-ansi-bright-magenta: #a21caf;
    --t-ansi-bright-cyan: #0e7490; --t-ansi-bright-white: #1c1c1f;
  }
  :global(:root[data-theme="dark"]) .term-output,
  :global(:root:not([data-theme="light"])) .term-output {
    --t-ansi-black: #8f8f9c; --t-ansi-red: #f87171; --t-ansi-green: #86efac;
    --t-ansi-yellow: #fcd34d; --t-ansi-blue: #93b4ff; --t-ansi-magenta: #f0a6f2;
    --t-ansi-cyan: #7dd3e0; --t-ansi-white: #e4e4ea;
    --t-ansi-bright-black: #9c9caa; --t-ansi-bright-red: #fca5a5;
    --t-ansi-bright-green: #bbf7d0; --t-ansi-bright-yellow: #fde68a;
    --t-ansi-bright-blue: #bcd0ff; --t-ansi-bright-magenta: #f5c6f7;
    --t-ansi-bright-cyan: #a5e8f2; --t-ansi-bright-white: #ffffff;
  }
  @media (prefers-color-scheme: light) {
    :global(:root:not([data-theme="dark"])) .term-output {
      --t-ansi-black: #24242b; --t-ansi-red: #a01d2b; --t-ansi-green: #14653a;
      --t-ansi-yellow: #7a5200; --t-ansi-blue: #1f4fa8; --t-ansi-magenta: #8b1f87;
      --t-ansi-cyan: #0b5f6b; --t-ansi-white: #4a4a55;
      --t-ansi-bright-black: #52525b; --t-ansi-bright-red: #c62828;
      --t-ansi-bright-green: #166534; --t-ansi-bright-yellow: #92400e;
      --t-ansi-bright-blue: #1d4ed8; --t-ansi-bright-magenta: #a21caf;
      --t-ansi-bright-cyan: #0e7490; --t-ansi-bright-white: #1c1c1f;
    }
  }
  .run { white-space: pre-wrap; }
  .bold { font-weight: 700; }
  .dim { opacity: 0.72; }
  .italic { font-style: italic; }
  .underline { text-decoration: underline; }
  .hit { background: var(--warn-bg); color: var(--warn); border-radius: 2px; }
  .active-hit { background: var(--accent); color: var(--accent-text); border-radius: 2px; }
</style>
